/**
 * Fixed vocabulary for `fundamental.metric`. Raw inputs only — ratios like
 * P/E are derived in the signal engine, never stored.
 */
export const METRICS = {
	epsBasic: 'eps_basic',
	/** Not populated by the BF snapshot; arrives with the ESEF pipeline. */
	sharesOutstanding: 'shares_outstanding',
	marketCap: 'market_cap',
	dividendPerShare: 'dividend_per_share',
	/**
	 * Price-to-book. Börse Frankfurt supplies this ratio directly and we have no
	 * book-value-per-share to derive it from, so unlike P/E it is stored as-is —
	 * a deliberate exception to the "raw inputs only" rule above.
	 */
	priceToBook: 'price_book'
} as const;

export type Metric = (typeof METRICS)[keyof typeof METRICS];
