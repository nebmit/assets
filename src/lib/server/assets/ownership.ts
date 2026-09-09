import { Decimal } from 'decimal.js';
import type { insiderTransaction, sourceFiling, fxRate } from '../db/schema.js';
import type { InsiderTx } from '../signals/types.js';
import { daysBetween } from '../util.js';
import { fingerprint } from './evidence.js';
export interface SecurityIdentity { instrumentId: number; isin: string | null; securityClass: string | null; currency: string }
export interface OwnerView { id: string; name: string; roles: string[] }
export interface QualifiedDealing extends InsiderTx {
	fxRateEvidence: { date: string; currency: string; unitsPerEur: string; observedAt: string; evidence: Record<string, unknown> } | null;
	id: number; economicKey: string; owners: OwnerView[]; price: number | null; source: string;
	currencyStatus: 'explicit' | 'inferred_usd' | 'unknown' | 'conflicting';
	qualification: string; qualificationReason: string | null; url: string | null; filingId: number | null;
}
const classLabel = (text: string) => /class\s*([a-z0-9]+)/i.exec(text)?.[1]?.toLowerCase() ?? null;
export function matchShareClass(title: string, securities: SecurityIdentity[]): SecurityIdentity | null {
	if (!/common|ordinary|aktie|shares of beneficial interest/i.test(title) || /preferred|option|warrant|unit|note|bond/i.test(title)) return null;
	const label = classLabel(title);
	const matches = securities.filter((s) => label === classLabel(s.securityClass ?? ''));
	return matches.length === 1 ? matches[0] : null;
}
function selectedRate(currency: string, transactionDate: string, rates: (typeof fxRate.$inferSelect)[]) {
	return rates.filter((r) => r.currency === currency && r.date <= transactionDate && daysBetween(r.date, transactionDate) <= 7).sort((a, b) => b.date.localeCompare(a.date) || b.observedAt.getTime() - a.observedAt.getTime())[0];
}
export function euroAmount(amount: number | null, currency: string | null, transactionDate: string, rates: (typeof fxRate.$inferSelect)[]): number | null {
	if (amount === null || currency === null) return null;
	if (currency === 'EUR') return amount;
	const rate = selectedRate(currency, transactionDate, rates);
	return rate ? new Decimal(amount).div(rate.unitsPerEur).toNumber() : null;
}
export function qualifyDealings(rows: (typeof insiderTransaction.$inferSelect)[], filings: (typeof sourceFiling.$inferSelect)[], securities: SecurityIdentity[], rates: (typeof fxRate.$inferSelect)[], cutoff = new Date()): Map<number, QualifiedDealing[]> {
	const byFiling = new Map(filings.map((f) => [f.id, f]));
	const output = new Map<number, QualifiedDealing[]>();
	const selectedHashes = new Map(filings.map((f) => [f.id, ((f.metadata.documents ?? []) as { hash: string; observedAt: string }[]).filter((e) => e.observedAt <= cutoff.toISOString()).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]?.hash]));
	const versions = [...rows].filter((r) => { const hash = selectedHashes.get(r.filingId ?? -1); return !hash || (r.raw as Record<string, unknown> | null)?.payloadHash === hash; }).sort((a, b) => (b.observedAt?.getTime() ?? 0) - (a.observedAt?.getTime() ?? 0) || b.id - a.id);
	const superseded = new Set<number>(), resolvedAmendments = new Set<number>(), uncertainFilings = new Set<number>();
	const ownerKey = (row: typeof insiderTransaction.$inferSelect) => JSON.stringify(((row.raw as { owners?: { cik: string }[] } | null)?.owners ?? []).map((o) => o.cik).sort());
	const matchKey = (row: typeof insiderTransaction.$inferSelect) => {
		const raw = (row.raw ?? {}) as Record<string, unknown>;
		return JSON.stringify([ownerKey(row), row.transactionDate, raw.securityTitle, raw.transactionCode, raw.derivative, raw.directOrIndirectOwnership]);
	};
	const originalFiling = new Map(versions.map((r) => [r.id, r.filingId]));
	for (const amendment of filings.filter((f) => f.form.endsWith('/A')).sort((a, b) => a.filedDate.localeCompare(b.filedDate) || a.id - b.id)) {
		const changed = versions.filter((r) => r.filingId === amendment.id);
		const originalDate = (amendment.metadata.parsed as { originalSubmissionDate?: string } | undefined)?.originalSubmissionDate;
		const candidates = filings.filter((f) => f.issuerId === amendment.issuerId && f.form === amendment.form.replace('/A', '') && (originalDate ? f.filedDate === originalDate : ((amendment.metadata.amendmentCandidateIds ?? []) as number[]).includes(f.id)));
		const originals = versions.filter((r) => candidates.some((f) => f.id === originalFiling.get(r.id)) && !superseded.has(r.id));
		const replacements = changed.map((r) => ({ amended: r, matches: originals.filter((o) => matchKey(o) === matchKey(r)) }));
		if (changed.length && replacements.every((r) => r.matches.length === 1) && new Set(replacements.map((r) => r.matches[0].id)).size === changed.length) {
			for (const r of replacements) { superseded.add(r.matches[0].id); resolvedAmendments.add(r.amended.id); originalFiling.set(r.amended.id, originalFiling.get(r.matches[0].id) ?? null); }
		} else {
			uncertainFilings.add(amendment.id);
			for (const f of candidates) uncertainFilings.add(f.id);
			if (!candidates.length) for (const row of versions) if (row.issuerId === amendment.issuerId && changed.some((r) => ownerKey(r) === ownerKey(row)) && row.filingId) uncertainFilings.add(row.filingId);
		}
	}
	const seen = new Set<string>();
	for (const row of versions) {
		if (superseded.has(row.id)) continue;
		const raw = (row.raw ?? {}) as Record<string, unknown>, filing = row.filingId ? byFiling.get(row.filingId) : undefined;
		const economicKey = row.economicKey ?? (filing ? `${filing.externalId}:${raw.tableName}:${raw.ordinal}` : row.naturalKeyHash);
		if (seen.has(economicKey)) continue; seen.add(economicKey);
		// Select a whole observed source revision, including removal/reordering of transaction rows.

		const isSec = row.source === 'sec';
		const security = securities.find((s) => row.instrumentId === s.instrumentId || (row.isin !== null && row.isin === s.isin)) ?? (isSec ? matchShareClass(String(raw.securityTitle ?? ''), securities) : securities.length === 1 ? securities[0] : null);
		if (!security) continue;
		let reason: string | null = null;
		const owners: OwnerView[] = isSec ? ((raw.owners ?? []) as { cik: string; name: string; officer: boolean; director: boolean; tenPercentOwner: boolean }[]).map((o) => ({ id: o.cik, name: o.name, roles: [o.officer ? 'executive' : '', o.director ? 'director' : '', o.tenPercentOwner ? 'beneficial_owner' : ''].filter(Boolean) })) : row.partyName ? [{ id: fingerprint([row.issuerId, row.partyName]), name: row.partyName, roles: [row.partyRole === 'executive_board' ? 'executive' : row.partyRole === 'supervisory_board' ? 'director' : row.partyRole] }] : [];
		const roles = owners.flatMap((o) => o.roles);
		const partyRole = roles.includes('executive') ? 'executive' : roles.includes('director') ? 'director' : roles.includes('related_party') ? 'related_party' : 'other';
		const footnotes = JSON.stringify(raw.footnotes ?? {});
		const explicit = /\b(?:USD|U\.?S\.? dollars?)\b/i.test(footnotes) ? 'USD' : /\b(?:EUR|euros?)\b/i.test(footnotes) ? 'EUR' : /\b(?:CAD|Canadian dollars?)\b/i.test(footnotes) ? 'CAD' : null;
		const foreignEvidence = /\b(?:CAD|AUD|HKD|GBP|EUR|Canadian|Australian|Hong Kong|sterling|euros?)\b/i.test(footnotes);
		let currency = row.currency ?? explicit;
		let currencyStatus: QualifiedDealing['currencyStatus'] = currency ? 'explicit' : 'unknown';
		if (isSec && !currency && !foreignEvidence && security.currency === 'USD') { currency = 'USD'; currencyStatus = 'inferred_usd'; }
		if ((explicit && row.currency && explicit !== row.currency) || (currency === 'USD' && foreignEvidence)) { currency = null; currencyStatus = 'conflicting'; reason = 'Conflicting filing currency evidence'; }
		let amount = row.amount === null ? null : Number(row.amount);
		if (isSec && currency && row.price !== null && row.volume !== null) amount = new Decimal(row.price).mul(row.volume).toNumber();
		if (!currency) { amount = null; reason ??= 'Transaction currency is unknown'; }
		const instrumentType = isSec ? raw.derivative === false && matchShareClass(String(raw.securityTitle ?? ''), [security]) ? 'common_share' : 'other_security' : row.instrumentType;
		if (instrumentType !== 'common_share' || !['buy', 'sell'].includes(row.side)) reason ??= 'Not a common-share purchase or sale';
		// An unresolved amendment prevents counting both a correction and a possibly obsolete original.
		if ((row.filingId && uncertainFilings.has(row.filingId)) || (row.amendmentStatus === 'unresolved' && !resolvedAmendments.has(row.id))) reason = 'Unresolved amendment';
		const amountEur = euroAmount(amount, currency, row.transactionDate, rates);
		if (amount !== null && amountEur === null) reason ??= 'Dated FX rate unavailable';
		const rate = currency && currency !== 'EUR' ? selectedRate(currency, row.transactionDate, rates) : null;
		const fxRateEvidence = rate ? { ...rate, observedAt: rate.observedAt.toISOString() } : null;
		const tx: QualifiedDealing = { fxRateEvidence, id: row.id, economicKey, owners, partyName: owners.length ? owners.map((o) => o.name).join(' / ') : row.partyName, partyRole, side: row.side, instrumentType, amount, amountEur: reason ? null : amountEur, currency, transactionDate: row.transactionDate, publishedDate: row.publishedDate, price: row.price === null ? null : Number(row.price), source: row.source, currencyStatus, qualification: reason ? 'unqualified' : 'qualified', qualificationReason: reason, url: filing?.url ?? null, filingId: row.filingId, buyerKey: owners.map((o) => o.id).sort().join(',') };
		const list = output.get(security.instrumentId) ?? []; list.push(tx); output.set(security.instrumentId, list);
	}
	return output;
}
