import { reconstructStandardTotals } from './derive.js';
import { Decimal } from 'decimal.js';
import { conceptMappings } from '../facts.js';
import { hash } from '../client.js';
import { daysBetween } from '../../../util.js';
import type { XbrlArtifact, XbrlFact } from './types.js';
export interface Candidate {
	factId: string; sourceFactIds: string[]; metric: string; value: string; currency: string | null; unit: string;
	periodStart: string | null; periodEnd: string; periodType: string; reportingBasis: string;
	classId: string | null; scope: string; semanticKey: string; instrumentId: number | null;
	qualification: 'unqualified' | 'conflicting' | 'rejected'; reasonCode: string | null;
	decimals: number | 'INF' | null; concept: string; context: string; dimensions: unknown[];
}
export const localName = (name: string) => name.slice(name.indexOf('}') + 1);
const namespace = (name: string) => name.slice(1, name.indexOf('}'));
const gaap = (name: string) => /^https?:\/\/(?:fasb.org|xbrl.us)\/us-gaap\//.test(namespace(name));
const dei = (name: string) => /^https?:\/\/xbrl.sec.gov\/dei\//.test(namespace(name));
const classAxis = (name: string) => gaap(name) && localName(name) === 'StatementClassOfStockAxis';
const commonMember = (name: string) => gaap(name) && /^Common(?:Stock|Class[A-Z0-9]+)Member$/.test(localName(name));
const periodType = (start: string | null, end: string) => {
	const days = start ? daysBetween(start, end) + 1 : 0;
	return !days ? 'INSTANT' : days >= 350 && days <= 380 ? 'FY' : days >= 70 && days <= 110 ? 'Q' : days >= 150 && days <= 210 ? 'YTD_6M' : days >= 240 && days <= 300 ? 'YTD_9M' : 'UNSUPPORTED';
};
export function normalizeArtifact(artifact: XbrlArtifact, cik: string, listings: { instrumentId: number; symbol: string }[]) {
	const contexts = new Map(artifact.contexts.map((c) => [c.id, c]));
	const issues: Record<string, number> = {};
	const issue = (code: string) => { issues[code] = (issues[code] ?? 0) + 1; };
	const candidates: Candidate[] = [];
	const classSymbols = new Map<string, Set<string>>();
	const scopeOf = (fact: XbrlFact) => {
		const ctx = contexts.get(fact.context ?? '');
		const dimensions = ctx?.dimensions.filter((d) => !d.default) ?? [];
		if (dimensions.some((d) => !classAxis(d.axis) || !d.member)) return 'other';
		const member = dimensions.find((d) => classAxis(d.axis))?.member;
		return member ? commonMember(member) ? `common:${localName(member)}` : member : 'issuer';
	};
	for (const fact of artifact.facts) if (dei(fact.concept) && localName(fact.concept) === 'TradingSymbol' && fact.valid && fact.value) {
		const scope = scopeOf(fact); const symbols = classSymbols.get(scope) ?? new Set<string>(); symbols.add(fact.value.trim()); classSymbols.set(scope, symbols);
	}
	// The inventory is evidence, including unresolved members; no title-based class guessing.
	const countFacts = artifact.facts.filter((f) => (dei(f.concept) || gaap(f.concept)) && ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'].includes(localName(f.concept)) && f.valid && !f.nil);
	const latestCount = countFacts.map((f) => contexts.get(f.context ?? '')?.end ?? '').sort().at(-1);
	const currentCounts = countFacts.filter((f) => contexts.get(f.context ?? '')?.end === latestCount);
	const classes = [...new Set(currentCounts.map(scopeOf).filter((s) => s !== 'issuer' && s !== 'other'))].sort();
	const classInventory = classes.length ? classes : currentCounts.some((f) => scopeOf(f) === 'issuer') ? ['issuer'] : [];
	// A dimensionless cover count and symbol bind only when no separate class inventory exists.
	const bindings = new Map<string, number>();
	for (const classId of classInventory) {
		const symbols = classSymbols.get(classId);
		if (!symbols || symbols.size !== 1 || (classId !== 'issuer' && !classId.startsWith('common:'))) continue;
		const matches = listings.filter((l) => symbols.has(l.symbol));
		if (matches.length === 1) bindings.set(classId, matches[0].instrumentId);
	}
	const rejectedRefs = new Set(artifact.diagnostics.filter((d) => /error|fatal|inconsistency/i.test(d.severity)).flatMap((d) => d.refs));
	const reconstructed = reconstructStandardTotals(artifact);
	for (const fact of [...artifact.facts, ...reconstructed.facts]) {
		if (!gaap(fact.concept) && !dei(fact.concept)) { issue('unmapped_custom_concept'); continue; }
		const mapping = conceptMappings.find((m) => m[1] === localName(fact.concept) && (m[1] === 'EntityCommonStockSharesOutstanding' ? dei(fact.concept) : gaap(fact.concept)));
		if (!mapping) { issue('unmapped_standard_concept'); continue; }
		const ctx = contexts.get(fact.context ?? '');
		if (!ctx?.end || !/^https?:\/\/www.sec.gov\/CIK$/.test(ctx.scheme) || ctx.entity.replace(/^0+/, '') !== cik.replace(/^0+/, '')) { issue('invalid_entity_or_context'); continue; }
		if (fact.nil) { issue('nil_fact'); continue; }
		if (!fact.numeric || fact.value === null || !new Decimal(fact.value).isFinite()) { issue('invalid_numeric_fact'); continue; }
		const measures = artifact.units[fact.unit ?? ''];
		const num = measures?.numerator ?? [], den = measures?.denominator ?? [];
		const sharesUnit = '{http://www.xbrl.org/2003/instance}shares';
		const currency = num.length === 1 && /^\{http:\/\/www.xbrl.org\/2003\/iso4217\}[A-Z]{3}$/.test(num[0]) ? localName(num[0]) : null;
		const unit = num.length === 1 && num[0] === sharesUnit && !den.length ? 'shares' : currency && !den.length ? currency : currency && den.length === 1 && den[0] === sharesUnit ? `${currency}/shares` : '';
		const perShare = mapping[0].startsWith('eps_') || mapping[0] === 'dividend_per_share';
		if (mapping[0].includes('shares') ? unit !== 'shares' : perShare ? !unit.endsWith('/shares') : unit !== currency) { issue('invalid_unit'); continue; }
		const scope = scopeOf(fact), classId = scope === 'issuer' ? null : scope;
		const instant = ['shares_outstanding','equity','preferred_equity','common_capital','common_stock_value','additional_paid_in_capital','retained_earnings','other_comprehensive_income','treasury_stock','preferred_shares_issued','noncontrolling_equity','temporary_equity','additional_paid_in_capital_total'].includes(mapping[0]);
		const type = periodType(ctx.start, ctx.end);
		const reasonCode = !fact.valid || !ctx.valid ? 'invalid_fact_or_context' : rejectedRefs.has(fact.id) ? 'validation_conflict' : scope === 'other' ? 'unsupported_dimensions' : type === 'UNSUPPORTED' || instant !== ctx.instant ? 'unsupported_period' : classId && !bindings.has(classId) ? 'listed_class_unresolved' : null;
		const semanticKey = hash(JSON.stringify([mapping[0], ctx.entity, ctx.start, ctx.end, ctx.dimensions, unit, mapping[2]]));
		candidates.push({ factId: fact.id, sourceFactIds: reconstructed.inputs.get(fact.id) ?? [fact.id], metric: mapping[0], value: fact.value, currency, unit, periodStart: ctx.start, periodEnd: ctx.end, periodType: type, reportingBasis: mapping[2], classId, scope, semanticKey,
			instrumentId: bindings.get(scope) ?? null, qualification: reasonCode === 'validation_conflict' ? 'conflicting' : reasonCode && reasonCode !== 'listed_class_unresolved' ? 'rejected' : 'unqualified', reasonCode,
			decimals: fact.decimals === 'INF' ? 'INF' : fact.decimals !== null && /^-?\d+$/.test(fact.decimals) ? Number(fact.decimals) : null, concept: fact.concept, context: ctx.id, dimensions: ctx.dimensions });
		if (reasonCode) issue(reasonCode);
	}
	return { candidates, classInventory, bindings: Object.fromEntries(bindings), inventoryComplete: classInventory.length > 0 && classInventory.every((c) => c === 'issuer' || c.startsWith('common:')), issues };
}
