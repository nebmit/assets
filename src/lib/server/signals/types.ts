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
	/** Buy/sell/other dealings with transactionDate in the window and publishedDate <= runDate. */
	insiderTx: InsiderTx[];
}

export interface UniverseContext {
	runDate: string;
	instruments: UniverseInstrument[];
}

export interface ScreenResult {
	passedGate: boolean;
	/** Raw score; only compared within one screen and run (percentile-ranked). */
	score: number | null;
	/** Raw inputs behind the score — persisted to signal.rationale. */
	rationale: Record<string, unknown>;
}

export interface ScreenDefinition {
	slug: string;
	name: string;
	version: number;
	params: Record<string, unknown>;
	evaluate(instrument: UniverseInstrument, ctx: UniverseContext): ScreenResult;
}

/** ScreenResult after percentile ranking within the run's gate-passers. */
export interface RankedResult extends ScreenResult {
	instrumentId: number;
	percentile: number | null;
	rank: number | null;
}
