/**
 * Fixed vocabulary for `fundamental.metric`. Raw inputs only — ratios like
 * P/E are derived in the signal engine, never stored.
 */
export const METRICS = {
	epsBasic: 'eps_basic',
	sharesOutstanding: 'shares_outstanding',
	marketCap: 'market_cap',
	dividendPerShare: 'dividend_per_share'
} as const;

export type Metric = (typeof METRICS)[keyof typeof METRICS];
