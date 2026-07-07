export interface InsiderTx {
	partyName: string | null;
	partyRole: 'executive_board' | 'supervisory_board' | 'related_party' | 'other';
	side: 'buy' | 'sell' | 'other';
	instrumentType: string | null;
	amount: number | null;
	transactionDate: string;
	publishedDate: string;
}

export interface UniverseInstrument {
	instrumentId: number;
	issuerId: number;
	isin: string;
	ticker: string | null;
	name: string;
	sector: string | null;
	indexName: 'DAX' | 'MDAX' | 'SDAX';
	/** Latest close on or before runDate (null if no price stored). */
	close: number | null;
	closeDate: string | null;
	/** Latest values with publishedDate <= runDate (point-in-time, no lookahead). */
	epsBasic: number | null;
	marketCap: number | null;
	dividendPerShare: number | null;
	/** Trailing ~3-month price return (vs the closest close ≤ runDate − 91d). */
	return3m: number | null;
	/** Trailing ~6-month price return (vs the closest close ≤ runDate − 182d). */
	return6m: number | null;
	/** close / trailing-52w high − 1 (≤ 0; −0.3 = 30% below the high). */
	drawdown52w: number | null;
	/** close / trailing-52w low − 1 (≥ 0; 0.05 = 5% above the low). */
	above52wLow: number | null;
	/** Buy/sell/other dealings with transactionDate in the window and publishedDate <= runDate. */
	insiderTx: InsiderTx[];
}

export interface UniverseContext {
	runDate: string;
	instruments: UniverseInstrument[];
}

export interface SignalResult {
	passedGate: boolean;
	/**
	 * Calibrated severity in [0, 1] on an absolute scale (documented in the
	 * definition's params): ~0.2 barely clears the materiality floor, ~0.5 is
	 * strong, ~1 is exceptional. Comparable across runs — an empty day stays
	 * empty instead of grading the survivors on a curve.
	 */
	score: number | null;
	/**
	 * Publication date of the newest triggering event for event-driven
	 * signals (insider filings); null for state signals (valuation).
	 */
	eventDate?: string | null;
	/** Raw inputs behind the score — persisted to signal.rationale. */
	rationale: Record<string, unknown>;
}

export interface SignalDefinition {
	slug: string;
	name: string;
	version: number;
	params: Record<string, unknown>;
	evaluate(instrument: UniverseInstrument, ctx: UniverseContext): SignalResult;
}

/** SignalResult after percentile ranking within the run's gate-passers. */
export interface RankedResult extends SignalResult {
	instrumentId: number;
	percentile: number | null;
	rank: number | null;
}
