import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { accession, cik, date } from './parse.js';
import type { Metric } from '../../fundamentals/metrics.js';
import { hash } from './client.js';

export const conceptMappings = [
	['eps_basic', 'EarningsPerShareBasic', 'basic'],
	['eps_diluted', 'EarningsPerShareDiluted', 'diluted'],
	['dividend_per_share', 'CommonStockDividendsPerShareDeclared', 'declared_common'],
	['dividend_per_share', 'CommonStockDividendsPerShareCashPaid', 'paid_common'],
	['shares_outstanding', 'EntityCommonStockSharesOutstanding', 'common_outstanding'],
	['shares_outstanding', 'CommonStockSharesOutstanding', 'common_outstanding'],
	['weighted_average_shares_basic', 'WeightedAverageNumberOfSharesOutstandingBasic', 'basic'],
	['weighted_average_shares_diluted', 'WeightedAverageNumberOfDilutedSharesOutstanding', 'diluted'],
	['equity', 'StockholdersEquity', 'parent'],
	['equity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest', 'including_noncontrolling'],
	['revenue', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'excluding_assessed_tax'],
	['revenue', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'including_assessed_tax'],
	['revenue', 'Revenues', 'reported_total'],
	['revenue', 'SalesRevenueNet', 'net_sales'],
	['net_income', 'NetIncomeLoss', 'reported_net_income'],
	['operating_cash_flow', 'NetCashProvidedByUsedInOperatingActivities', 'reported_operating_cash_flow']
] as const satisfies readonly (readonly [Metric, string, string])[];
const factSchema = z.object({
	val: z.union([z.number().finite(), z.string()]), start: date.optional(), end: date,
	accn: accession, form: z.string(), filed: date, fy: z.number().nullish(), fp: z.string().nullish(), frame: z.string().optional()
});
export interface NormalizedFact {
	metric: string; value: string; currency: string | null; unit: string;
	periodStart: string | null; periodEnd: string; periodType: string; reportingBasis: string;
	accession: string; filedDate: string; sourceRecordId: string; metadata: Record<string, unknown>;
}
export interface FactResult { facts: NormalizedFact[]; issues: Record<string, number> }

/** Retain period-specific facts, never synthesize TTM or quarterly EPS from YTD. */
export function normalizeFacts(input: unknown, issuerCik: string, payloadHash: string, cutoff: string): FactResult {
	const doc = z.object({ cik: z.union([z.number(), z.string()]), facts: z.record(z.record(z.object({ units: z.record(z.array(z.unknown())) }))) }).parse(input);
	if (cik(doc.cik) !== issuerCik) throw new Error('Company Facts CIK mismatch');
	const result: FactResult = { facts: [], issues: {} };
	const issue = (reason: string) => { result.issues[reason] = (result.issues[reason] ?? 0) + 1; };
	const groups = new Map<string, NormalizedFact[]>();
	for (const [metric, concept, basis] of conceptMappings) {
		const taxonomy = concept === 'EntityCommonStockSharesOutstanding' ? 'dei' : 'us-gaap';
		const entry = doc.facts[taxonomy]?.[concept];
		if (!entry) { issue(`missing:${concept}`); continue; }
		for (const [unit, values] of Object.entries(entry.units)) {
			const isShares = metric.includes('shares');
			const perShare = metric.startsWith('eps_') || metric === 'dividend_per_share';
			if (!(isShares ? unit === 'shares' : perShare ? /^[A-Z]{3}\/shares$/.test(unit) : /^[A-Z]{3}$/.test(unit))) { issue(`invalid_unit:${concept}`); continue; }
			for (const value of values) {
				const f = factSchema.parse(value);
				if (!/^(10-K|10-Q)(\/A)?$/.test(f.form) || f.end < cutoff) continue;
				if (typeof f.val === 'number' && Number.isInteger(f.val) && !Number.isSafeInteger(f.val)) { issue(`unsafe_numeric_precision:${concept}`); continue; }
				const decimal = new Decimal(f.val); if (!decimal.isFinite()) throw new Error('nonfinite financial value');
				const instant = ['shares_outstanding', 'equity'].includes(metric);
				if (instant === Boolean(f.start)) { issue(`invalid_period:${concept}`); continue; }
				let periodType = 'INSTANT';
				if (f.start) {
					const days = (Date.parse(f.end) - Date.parse(f.start)) / 86400000 + 1;
					periodType = days >= 350 && days <= 380 ? 'FY' : days >= 70 && days <= 110 ? 'Q' : days >= 150 && days <= 210 ? 'YTD_6M' : days >= 240 && days <= 300 ? 'YTD_9M' : 'UNSUPPORTED';
					if (periodType === 'UNSUPPORTED') { issue(`ambiguous_duration:${concept}`); continue; }
				}
				const identity = [issuerCik, payloadHash, f.accn, taxonomy, concept, unit, f.start ?? '', f.end, basis, decimal.toString()];
				const normalized: NormalizedFact = {
					metric, value: decimal.toString(), currency: isShares ? null : unit.slice(0, 3), unit,
					periodStart: f.start ?? null, periodEnd: f.end, periodType, reportingBasis: basis,
					accession: f.accn, filedDate: f.filed, sourceRecordId: hash(JSON.stringify(identity)),
					metadata: { taxonomy, concept, normalizationVersion: 1, payloadHash, form: f.form, fy: f.fy, fp: f.fp, frame: f.frame, comparisonStatus: 'unqualified_share_and_split_basis' }
				};
				// Group concepts competing for the same semantic output; preserve distinct bases.
				const key = JSON.stringify([metric, basis, f.accn, f.start, f.end]);
				const list = groups.get(key) ?? []; list.push(normalized); groups.set(key, list);
			}
		}
	}
	for (const candidates of groups.values()) {
		if (new Set(candidates.map((f) => `${f.unit}:${f.value}`)).size > 1) { issue(`conflicting_facts:${candidates[0].metric}`); continue; }
		// Mapping order is deterministic; exact repeats and semantically equivalent tags collapse.
		result.facts.push(candidates[0]);
	}
	return result;
}
