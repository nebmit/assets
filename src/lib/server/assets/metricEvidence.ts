export interface MetricEvidence {
	reasonCode: string | null;
	scope: 'company' | 'class';
	method: string | null;
	asOf: string | null;
	evidence: { facts: number[]; prices: number[]; actions: number[]; rules: string[]; documents?: { extractionId: number; factIds: string[] }[] };
}
/** Stable diagnostic categories independent of translated UI wording. */
export function reasonCode(reason: string | null): string | null {
	if (!reason) return null;
	if (/class.*unresolved|unresolved.*class/i.test(reason)) return 'listed_class_unresolved';
	if (/inventory/i.test(reason)) return 'class_inventory_incomplete';
	if (/unlisted class/i.test(reason)) return 'unlisted_class_valuation_unavailable';
	if (/latest reporting/i.test(reason)) return 'latest_period_missing';
	if (/stale/i.test(reason)) return 'stale';
	if (/conflict|disagree|contradict/i.test(reason)) return 'conflicting_evidence';
	if (/split|corporate action/i.test(reason)) return 'share_basis_unresolved';
	if (/annual|quarter|trailing|period/i.test(reason)) return 'incomplete_periods';
	if (/equity|capital|retained|comprehensive/i.test(reason)) return 'common_equity_incomplete';
	if (/close|price/i.test(reason)) return 'price_unavailable';
	if (/share/i.test(reason)) return 'shares_unavailable';
	if (/earnings|EPS/i.test(reason)) return 'earnings_unavailable';
	return 'source_unavailable';
}
