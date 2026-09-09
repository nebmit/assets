/**
 * Fixed vocabulary for `fundamental.metric`. Raw inputs only — ratios like
 * P/E are derived in the signal engine, never stored.
 */
export const METRICS = {
	epsBasic: 'eps_basic',
	epsDiluted: 'eps_diluted',
	weightedAverageSharesBasic: 'weighted_average_shares_basic',
	weightedAverageSharesDiluted: 'weighted_average_shares_diluted',
	equity: 'equity',
	revenue: 'revenue',
	netIncome: 'net_income',
	netIncomeCommon: 'net_income_common',
	commonEquity: 'common_equity',
	commonCapital: 'common_capital',
	commonStockValue: 'common_stock_value',
	additionalPaidInCapital: 'additional_paid_in_capital',
	retainedEarnings: 'retained_earnings',
	otherComprehensiveIncome: 'other_comprehensive_income',
	treasuryStock: 'treasury_stock',
	preferredSharesIssued: 'preferred_shares_issued',
	preferredEquity: 'preferred_equity',
	operatingCashFlow: 'operating_cash_flow',
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
