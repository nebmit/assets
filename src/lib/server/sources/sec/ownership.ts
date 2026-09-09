import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Decimal } from 'decimal.js';
import { cik, date, ownershipForm, acceptanceTime } from './parse.js';
import { hash } from './client.js';

type Node = Record<string, unknown>;
function object(v: unknown): Node { return v && typeof v === 'object' && !Array.isArray(v) ? v as Node : {}; }
function array(v: unknown): unknown[] { return v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]; }
function text(v: unknown): string | null {
	if (typeof v === 'string' || typeof v === 'number') return String(v) || null;
	const node = object(v), nested = node.value ?? node['#text']; return nested === undefined ? null : text(nested);
}
function flag(v: unknown): boolean { return ['1', 'true'].includes(String(v).toLowerCase()); }
function decimal(v: unknown): string | null {
	const s = text(v); if (s === null) return null;
	if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) throw new Error('invalid ownership decimal');
	return new Decimal(s).toString();
}
/** XML Schema dates may carry a timezone; dealings retain the stated calendar day. */
function ownershipDate(value: unknown): string {
	const raw = text(value);
	const match = raw?.match(/^(\d{4}-\d{2}-\d{2})(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?$/);
	if (!match) throw new Error(`invalid ownership date: ${raw}`);
	return date.parse(match[1]);
}
export interface Owner { cik: string; name: string; director: boolean; officer: boolean; tenPercentOwner: boolean; other: boolean; title: string | null }
export interface OwnershipTransaction {
	sourceRecordId: string; partyName: string | null; partyRole: 'executive_board' | 'other';
	side: 'buy' | 'sell' | 'other'; instrumentType: string; transactionDate: string;
	price: string | null; volume: string | null; amount: string | null; currency: string | null;
	raw: Record<string, unknown>;
}
export interface OwnershipResult {
	issuerCik: string; issuerName: string; form: string; owners: Owner[];
	originalSubmissionDate: string | null; acceptedAt: string | null;
	transactions: OwnershipTransaction[]; metadata: Record<string, unknown>;
}
export function parseOwnership(source: string, acc: string, revision: string): OwnershipResult {
	const match = /<ownershipDocument\b[\s\S]*?<\/ownershipDocument\s*>/i.exec(source);
	if (!match) throw new Error('missing ownership XML');
	// SGML submissions can contain unrelated HTML exhibits with legitimate doctypes.
	// Validate declarations only in the ownership document and submission preamble.
	const documents = [...source.matchAll(/<DOCUMENT>[\s\S]*?<\/DOCUMENT\s*>/gi)];
	const document = documents.find((entry) => entry.index! <= match.index && entry.index! + entry[0].length > match.index);
	const declarationScope = document ? source.slice(0, documents[0].index) + document[0] : source;
	if (/<!DOCTYPE|<!ENTITY/i.test(declarationScope)) throw new Error('XML declarations with entities are forbidden');
	const xml = match[0];
	if (XMLValidator.validate(xml) !== true) throw new Error('malformed ownership XML');
	const root = object(new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true }).parse(xml).ownershipDocument);
	const form = text(root.documentType) ?? ''; if (!ownershipForm.test(form)) throw new Error('unsupported ownership form');
	const issuer = object(root.issuer);
	const issuerName = text(issuer.issuerName); if (!issuerName) throw new Error('missing ownership issuer name');
	const owners = array(root.reportingOwner).map((v): Owner => {
		const node = object(v), id = object(node.reportingOwnerId), role = object(node.reportingOwnerRelationship);
		const name = text(id.rptOwnerName); if (!name) throw new Error('missing reporting owner name');
		return { cik: cik(text(id.rptOwnerCik)), name, director: flag(role.isDirector), officer: flag(role.isOfficer), tenPercentOwner: flag(role.isTenPercentOwner), other: flag(role.isOther), title: text(role.officerTitle) };
	});
	if (!owners.length) throw new Error('no reporting owners');
	const footnotes = object(root.footnotes);
	const transactions: OwnershipTransaction[] = [];
	for (const [tableName, rowName, derivative] of [['nonDerivativeTable', 'nonDerivativeTransaction', false], ['derivativeTable', 'derivativeTransaction', true]] as const) {
		const rows = array(object(root[tableName])[rowName]);
		if (form.startsWith('3') && rows.length) throw new Error('Form 3 contains transaction rows');
		rows.forEach((v, ordinal) => {
			const row = object(v), coding = object(row.transactionCoding), amounts = object(row.transactionAmounts);
			const code = text(coding.transactionCode), disposition = text(amounts.transactionAcquiredDisposedCode);
			const side = code === 'P' && disposition === 'A' ? 'buy' : code === 'S' && disposition === 'D' ? 'sell' : 'other';
			const price = decimal(amounts.transactionPricePerShare), volume = decimal(amounts.transactionShares);
			if ((price !== null && new Decimal(price).isNegative()) || (volume !== null && new Decimal(volume).isNegative())) throw new Error('negative ownership quantity or price');
			// XML has no required ISO currency. Preserve the raw value; don't guess from a US listing.
			const currency: string | null = null;
			transactions.push({
				sourceRecordId: hash(JSON.stringify([acc, revision, tableName, ordinal])),
				partyName: owners.length === 1 ? owners[0].name : null,
				partyRole: owners.length === 1 && owners[0].officer ? 'executive_board' : 'other',
				side, instrumentType: derivative ? 'derivative' : 'non_derivative', transactionDate: ownershipDate(row.transactionDate),
				price, volume, amount: null, currency,
				raw: { row, owners, footnotes, transactionCode: code, acquiredDisposedCode: disposition, securityTitle: text(row.securityTitle), derivative,
					currencyStatus: 'requires_filing_currency_review', unqualifiedPriceTimesShares: price !== null && volume !== null ? new Decimal(price).mul(volume).toString() : null,
					aff10b5One: flag(root.aff10b5One), ordinal, tableName }
			});
		});
	}
	const accepted = /<ACCEPTANCE-DATETIME>(\d{14})/.exec(source)?.[1];
	const original = text(root.dateOfOriginalSubmission);
	return { issuerCik: cik(text(issuer.issuerCik)), issuerName, form, owners,
		originalSubmissionDate: original ? ownershipDate(original) : null, acceptedAt: accepted ? acceptanceTime(accepted) : null, transactions,
		metadata: { owners, footnotes, holdings: { nonDerivative: object(root.nonDerivativeTable).nonDerivativeHolding ?? [], derivative: object(root.derivativeTable).derivativeHolding ?? [] },
			originalSubmissionDate: original, schemaVersion: root.schemaVersion, aff10b5One: flag(root.aff10b5One) }
	};
}
