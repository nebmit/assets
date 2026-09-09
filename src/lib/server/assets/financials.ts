import { blocksShareAdjustment } from './adjustments.js';
import { Decimal } from 'decimal.js';
import type { fundamental, corporateAction } from '../db/schema.js';
import { addDays, daysBetween } from '../util.js';
export type Fact = typeof fundamental.$inferSelect;
export type Action = typeof corporateAction.$inferSelect;
export type CoverageState = 'qualified' | 'missing' | 'stale' | 'conflicting' | 'unqualified' | 'unavailable';
export interface MetricValue {
	value: number | null; currency: string | null; unit: string; state: CoverageState; reason: string | null;
	periodStart: string | null; periodEnd: string | null; inputIds: number[];
}
export interface Financials { eps: MetricValue; marketCap: MetricValue; dividend: MetricValue; pb: MetricValue }
const missing = (reason: string, currency: string | null, unit: string, state: CoverageState = 'missing'): MetricValue => ({ value: null, currency, unit, state, reason, periodStart: null, periodEnd: null, inputIds: [] });
const value = (n: Decimal.Value, rows: Fact[], currency: string | null, unit: string, start: string | null = null, end: string | null = null): MetricValue => ({ value: new Decimal(n).toNumber(), currency, unit, state: 'qualified', reason: null, periodStart: start, periodEnd: end ?? rows[0]?.periodEnd ?? null, inputIds: [...new Set(rows.flatMap((r) => [r.id, ...((r.metadata?.reconciledInputIds ?? []) as number[])]))] });
const duration = (f: Fact) => f.periodStart ? daysBetween(f.periodStart, f.periodEnd) + 1 : 0;
const samePeriod = (a: Fact, b: Fact) => a.periodStart === b.periodStart && a.periodEnd === b.periodEnd;

/** Company Facts omits precision; monetary reconciliation is exact unless inline XBRL supplies it. */
function roundingError(f: Fact): Decimal {
	const decimals = f.metadata?.decimals;
	if (typeof decimals === 'number' && Number.isInteger(decimals) && Math.abs(decimals) <= 18) return new Decimal(10).pow(-decimals).div(2);
	return new Decimal(0);
}
const periodOrder = (a: Fact, b: Fact) => b.periodEnd.localeCompare(a.periodEnd) || duration(b) - duration(a);
const sameStatement = (a: Fact, b: Fact) => samePeriod(a, b) && a.filingId === b.filingId;

/** Collapse repeated observations, retaining the newest public revision of each semantic period. */
export function selectFacts(rows: Fact[]): Fact[] {
	const groups = new Map<string, Fact[]>();
	for (const row of rows) {
		const key = JSON.stringify([row.source, row.instrumentId, row.metric, row.periodStart, row.periodEnd, row.reportingBasis, row.currency, row.unit]);
		const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
	}
	const order = (a: Fact, b: Fact) => b.publishedDate.localeCompare(a.publishedDate) || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || (b.observedAt?.getTime() ?? 0) - (a.observedAt?.getTime() ?? 0) || b.id - a.id;
	return [...groups.values()].map((group) => {
		const newest = [...group].sort(order)[0];
		if (newest.metric === 'shares_outstanding') {
			// Inline observations supersede earlier normalizations of the same concept.
			const concepts = new Map<unknown, Fact>();
			for (const row of [...group].sort(order)) if (row.filingId === newest.filingId && row.publishedDate === newest.publishedDate && !concepts.has(row.metadata?.concept)) concepts.set(row.metadata?.concept, row);
			const candidates = [...concepts.values()];
			const reported = (f: Fact) => typeof f.metadata?.decimals === 'number' || f.metadata?.decimals === 'INF';
			if (candidates.length > 1 && candidates.every((f) => reported(f) && f.qualification !== 'conflicting')) {
				const precise = [...candidates].sort((a, b) => roundingError(a).cmp(roundingError(b)) || order(a, b))[0];
				if (candidates.every((f) => new Decimal(f.value).minus(precise.value).abs().lte(roundingError(f).add(roundingError(precise))))) return { ...precise, metadata: { ...precise.metadata, reconciledInputIds: candidates.map((f) => f.id) } };
			}
		}
		const conflict = group.some((r) => r.filingId === newest.filingId && r.publishedDate === newest.publishedDate && r.metadata?.concept !== newest.metadata?.concept && !new Decimal(r.value).eq(newest.value));
		return conflict ? { ...newest, qualification: 'conflicting', qualificationReason: 'Competing concepts disagree' } : newest;
	}).sort(order);
}

/** Shares grow and historical per-share prices shrink by the same split factor. */
export function splitFactor(actions: Action[], from: string, through: string): Decimal {
	return actions.filter((a) => a.qualification === 'qualified' && a.ratio !== null && a.exDate > from && a.exDate <= through).reduce((n, a) => n.mul(a.ratio!), new Decimal(1));
}

export function resolveFinancials(input: { facts: Fact[]; instrumentId: number; singleClass: boolean; currency: string; close: number | null; priceDate?: string; runDate: string; actions: Action[]; actionsComplete: boolean; adjustmentSymbol?: string | null }): Financials {
	const { currency, runDate, close, actions } = input;
	const priceBasisDate = input.priceDate ?? runDate;
	const ambiguousActions = (from: string) => actions.some((a) => a.exDate > from && a.exDate <= priceBasisDate && blocksShareAdjustment(a, input.adjustmentSymbol ?? null));
	const result: Financials = { eps: missing('No comparable trailing earnings', currency, `${currency}/shares`), marketCap: missing('No qualified outstanding share count', currency, currency), dividend: missing('Paid dividend coverage unavailable', currency, `${currency}/shares`), pb: missing('Common equity allocation unavailable', null, 'pure') };
	const facts = selectFacts(input.facts).filter((f) => f.periodEnd <= runDate && (f.instrumentId === input.instrumentId || (f.instrumentId === null && input.singleClass)));
	// BF is a dated provider snapshot, not a reconstructed SEC fiscal period.
	for (const [key, metric] of [['eps', 'eps_basic'], ['marketCap', 'market_cap'], ['dividend', 'dividend_per_share'], ['pb', 'price_book']] as const) {
		const row = facts.find((f) => f.source === 'boerse_frankfurt' && f.metric === metric && f.qualification === 'qualified' && (key === 'pb' || f.currency === currency));
		if (row) result[key] = daysBetween(row.publishedDate, runDate) > 10 ? missing('Provider snapshot is stale', result[key].currency, result[key].unit, 'stale') : value(row.value, [row], result[key].currency, result[key].unit);
	}
	const sec = facts.filter((f) => f.source === 'sec' && f.qualification !== 'conflicting' && (f.currency === currency || f.unit === 'shares'));
	for (const [key, metric] of [['eps', 'net_income_common'], ['marketCap', 'shares_outstanding']] as const) if (facts.some((f) => f.metric === metric && f.qualification === 'conflicting')) result[key] = missing('Competing source facts disagree', currency, result[key].unit, 'conflicting');
	const shares = sec.filter((f) => f.metric === 'weighted_average_shares_basic');
	const earnings = sec.filter((f) => f.metric === 'net_income_common');
	const earningsEvidence = new Map<number, Fact[]>();
	if (input.singleClass) for (const parent of sec.filter((f) => f.metric === 'net_income')) {
		// Explicit common attribution (including conflicting observations) always wins.
		if (facts.some((f) => f.metric === 'net_income_common' && samePeriod(f, parent))) continue;
		const denominator = shares.find((f) => sameStatement(f, parent) && f.reportingBasis === 'basic');
		const reported = sec.find((f) => f.metric === 'eps_basic' && sameStatement(f, parent) && f.reportingBasis === 'basic');
		const preferred = facts.filter((f) => ['preferred_equity', 'preferred_shares_issued'].includes(f.metric) && f.periodEnd === parent.periodEnd && f.filingId === parent.filingId);
		if (!denominator || !reported || !new Decimal(denominator.value).gt(0) || preferred.some((f) => f.qualification === 'conflicting' || !new Decimal(f.value).isZero())) continue;
		const expected = new Decimal(reported.value).mul(denominator.value);
		const tolerance = roundingError(reported).mul(denominator.value).add(roundingError(parent)).add(roundingError(denominator).mul(new Decimal(reported.value).abs()));
		if (new Decimal(parent.value).minus(expected).abs().gt(tolerance)) continue;
		earnings.push(parent);
		earningsEvidence.set(parent.id, [reported, ...preferred]);
	}
	earnings.sort(periodOrder);
	if (!earnings.length && result.eps.value === null && result.eps.state !== 'conflicting') result.eps.reason = 'Missing common earnings or a matching EPS/share-count reconciliation';
	const annual = earnings.find((f) => f.periodType === 'FY');
	if (earnings.length) {
		const newest = earnings[0];
		let terms: { f: Fact; sign: number }[] = annual ? [{ f: annual, sign: 1 }] : [];
		if (annual && newest.periodEnd > annual.periodEnd) {
			const ytd = earnings.find((f) => f.periodStart === addDays(annual.periodEnd, 1) && f.periodEnd === newest.periodEnd);
			const previous = ytd && earnings.find((f) => f.periodStart === annual.periodStart && Math.abs(duration(f) - duration(ytd)) <= 8 && daysBetween(f.periodEnd, ytd.periodEnd) >= 350 && daysBetween(f.periodEnd, ytd.periodEnd) <= 380);
			terms = ytd && previous ? [...terms, { f: ytd, sign: 1 }, { f: previous, sign: -1 }] : [];
		}
		if (!terms.length) {
			// Four contiguous stand-alone quarters are additive; YTD EPS never is.
			let end = newest.periodEnd;
			for (let quarter = 0; quarter < 4; quarter++) {
				const row = earnings.find((f) => f.periodEnd === end && duration(f) >= 75 && duration(f) <= 105 && f.periodStart !== null);
				if (!row) { terms = []; break; }
				terms.push({ f: row, sign: 1 }); end = addDays(row.periodStart!, -1);
			}
		}
		const pairs = terms.map((term) => ({ ...term, shares: shares.find((s) => samePeriod(s, term.f) && s.reportingBasis === 'basic' && (term.f.metric !== 'net_income' || sameStatement(s, term.f))) }));
		const rows = pairs.flatMap((p) => [...(p.shares ? [p.f, p.shares] : [p.f]), ...(earningsEvidence.get(p.f.id) ?? [])]);
		const end = newest.periodEnd;
		const days = pairs.reduce((n, p) => n + duration(p.f) * p.sign, 0);
		const ambiguousBasis = rows.some((f) => actions.some((a) => a.ratio !== null && a.exDate > f.periodEnd && a.exDate <= f.publishedDate));
		if (pairs.length && pairs.every((p) => p.shares) && days >= 350 && days <= 380 && !ambiguousBasis && input.actionsComplete && !rows.some((f) => ambiguousActions(f.periodEnd))) {
			const numerator = pairs.reduce((n, p) => n.add(new Decimal(p.f.value).mul(p.sign)), new Decimal(0));
			const shareDays = pairs.reduce((n, p) => n.add(new Decimal(p.shares!.value).mul(duration(p.shares!)).mul(splitFactor(actions, String(p.shares!.metadata?.shareBasisDate ?? p.shares!.periodEnd), end)).mul(p.sign)), new Decimal(0));
			if (shareDays.gt(0)) result.eps = value(numerator.div(shareDays.div(days)).div(splitFactor(actions, end, priceBasisDate)), rows, currency, `${currency}/shares`, addDays(end, 1 - days), end);
		}
		if (result.eps.value === null && result.eps.state !== 'conflicting') result.eps.reason = !terms.length ? 'Missing comparable annual/YTD periods or four contiguous quarters' : !pairs.every((p) => p.shares) ? 'Missing matching basic weighted-average shares' : ambiguousBasis || rows.some((f) => ambiguousActions(f.periodEnd)) ? 'Ambiguous corporate action or split basis in reported earnings' : 'Incompatible trailing earnings/share periods';
		if (daysBetween(end, runDate) > 150) result.eps = missing('Trailing reporting period is stale', currency, `${currency}/shares`, 'stale');
	}
	const outstanding = facts.filter((f) => f.source === 'sec' && f.metric === 'shares_outstanding' && f.unit === 'shares').sort(periodOrder)[0];
	if (close !== null && outstanding && outstanding.qualification !== 'conflicting' && new Decimal(outstanding.value).gt(0) && input.actionsComplete && !ambiguousActions(outstanding.periodEnd) && daysBetween(outstanding.periodEnd, runDate) <= 150) {
		result.marketCap = value(new Decimal(outstanding.value).mul(splitFactor(actions, outstanding.periodEnd, priceBasisDate)).mul(close), [outstanding], currency, currency);
	}
	// Reconcile only one statement at a time; an absent preferred fact is not evidence of zero.
	let equity: Fact | undefined;
	let equityInputs: Fact[] = [];
	const equityCandidates = facts.filter((f) => f.source === 'sec' && f.currency === currency && (f.metric === 'common_equity' || (f.metric === 'equity' && f.reportingBasis === 'parent'))).sort((a, b) => periodOrder(a, b) || Number(b.metric === 'common_equity') - Number(a.metric === 'common_equity'));
	for (const candidate of equityCandidates) {
		if (candidate.qualification === 'conflicting') { result.pb = missing('Conflicting equity evidence', null, 'pure', 'conflicting'); break; }
		if (daysBetween(candidate.periodEnd, runDate) > 150) { result.pb = missing('Common equity reporting period is stale', null, 'pure', 'stale'); break; }
		if (candidate.metric === 'common_equity') { equity = candidate; equityInputs = [candidate]; break; }
		if (!input.singleClass) break;
		const statement = facts.filter((f) => f.source === 'sec' && sameStatement(f, candidate) && (f.currency === currency || f.unit === 'shares'));
		const preferred = statement.find((f) => f.metric === 'preferred_equity');
		const preferredShares = statement.find((f) => f.metric === 'preferred_shares_issued');
		const componentMetrics = ['common_capital', 'common_stock_value', 'additional_paid_in_capital', 'retained_earnings', 'other_comprehensive_income', 'treasury_stock', 'preferred_equity', 'preferred_shares_issued'];
		if (statement.some((f) => componentMetrics.includes(f.metric) && f.qualification === 'conflicting')) { result.pb = missing('Conflicting common-equity components', null, 'pure', 'conflicting'); break; }
		if (preferred && (new Decimal(preferred.value).lt(0) || (new Decimal(preferred.value).isZero() && preferredShares && new Decimal(preferredShares.value).gt(0)))) { result.pb = missing('Preferred capital contradicts the reported preferred share count', null, 'pure', 'conflicting'); break; }
		if (preferred) {
			equity = { ...candidate, value: new Decimal(candidate.value).minus(preferred.value).toString() };
			equityInputs = [candidate, preferred]; break;
		}
		if (preferredShares && !new Decimal(preferredShares.value).isZero()) { result.pb.reason = 'Preferred shares are outstanding but same-period preferred equity is missing'; break; }
		const capital = statement.find((f) => f.metric === 'common_capital');
		const par = statement.find((f) => f.metric === 'common_stock_value');
		const apic = statement.find((f) => f.metric === 'additional_paid_in_capital');
		const retained = statement.find((f) => f.metric === 'retained_earnings');
		const other = statement.find((f) => f.metric === 'other_comprehensive_income');
		const treasury = statement.find((f) => f.metric === 'treasury_stock');
		if (capital && par && apic && new Decimal(capital.value).minus(new Decimal(par.value).add(apic.value)).abs().gt(roundingError(capital).add(roundingError(par)).add(roundingError(apic)))) { result.pb = missing('Conflicting common-capital breakdown', null, 'pure', 'conflicting'); break; }
		const capitalInputs = capital ? [capital] : par && apic ? [par, apic] : [];
		if (!capitalInputs.length || !retained || !other) {
			const absent = [...(!capitalInputs.length ? ['common capital'] : []), ...(!retained ? ['retained earnings'] : []), ...(!other ? ['other comprehensive income'] : [])];
			result.pb.reason = `Missing same-statement ${absent.join(', ')} for common-equity reconciliation`; break;
		}
		const components = [...capitalInputs, retained, other, ...(treasury ? [treasury] : [])];
		const total = components.reduce((n, f) => n.add(new Decimal(f.value).mul(f.metric === 'treasury_stock' ? -1 : 1)), new Decimal(0));
		const tolerance = components.reduce((n, f) => n.add(roundingError(f)), roundingError(candidate));
		if (total.minus(candidate.value).abs().gt(tolerance)) { result.pb = missing('Common-equity components do not reconcile to parent equity within reported precision', null, 'pure', 'conflicting'); break; }
		equity = candidate; equityInputs = [candidate, ...components, ...(preferredShares ? [preferredShares] : [])]; break;
	}
	if (equity && (input.singleClass || equity.instrumentId === input.instrumentId) && result.marketCap.value !== null && new Decimal(equity.value).gt(0)) result.pb = value(new Decimal(result.marketCap.value).div(equity.value), [...equityInputs, ...sec.filter((f) => result.marketCap.inputIds.includes(f.id))], null, 'pure');
	else if (equity && !new Decimal(equity.value).gt(0)) result.pb.reason = 'Price/book is not meaningful for nonpositive common equity';
	else if (equity && result.marketCap.value === null) result.pb.reason = 'Market capitalization unavailable for price/book';
	else if (result.pb.state === 'missing' && result.pb.reason === 'Common equity allocation unavailable') result.pb.reason = 'Missing reconciled common-equity components or same-period preferred capital';
	if (input.facts.some((f) => f.source === 'sec')) {
		if (!input.singleClass) for (const key of ['eps', 'marketCap', 'pb'] as const) if (result[key].value === null) result[key].reason = 'Incompatible or unresolved share-class allocation';
		if (!input.actionsComplete) for (const key of ['eps', 'marketCap'] as const) if (result[key].value === null) result[key].reason = 'Corporate action coverage unavailable or unsupported';
		if (result.marketCap.value === null && input.actionsComplete && input.singleClass) {
			if (close === null) result.marketCap.reason = 'No completed daily close';
			else if (outstanding && daysBetween(outstanding.periodEnd, runDate) > 150) result.marketCap = missing('Outstanding share count is stale', currency, currency, 'stale');
			else if (outstanding && ambiguousActions(outstanding.periodEnd)) result.marketCap.reason = 'Unsupported corporate action since the outstanding share count';
			else if (outstanding && !new Decimal(outstanding.value).gt(0)) result.marketCap.reason = 'Outstanding share count is nonpositive';
		}
	}
	if (input.actionsComplete) {
		const cash = actions.filter((a) => a.type === 'cash_dividends' && (typeof a.metadata.payable_date !== 'string' || (a.metadata.payable_date > addDays(runDate, -365) && a.metadata.payable_date <= runDate)));
		if (cash.every((a) => a.qualification === 'qualified' && a.currency === currency && a.amount !== null && typeof a.metadata.payable_date === 'string' && a.metadata.payable_date <= runDate)) {
			const amount = cash.reduce((n, a) => n.add(new Decimal(a.amount!).div(splitFactor(actions, a.exDate, priceBasisDate))), new Decimal(0));
			result.dividend = value(amount, [], currency, `${currency}/shares`, addDays(runDate, -365), runDate);
		}
	}
	return result;
}
