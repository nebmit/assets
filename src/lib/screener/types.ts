/**
 * Shared (server → client) payload types for the screener screen. Everything
 * here must stay JSON-serializable: it crosses the SvelteKit load boundary.
 */

export type PartyRole = 'executive_board' | 'supervisory_board' | 'related_party' | 'other';
export type TransactionSide = 'buy' | 'sell' | 'other';

/** One point of the (weekly-downsampled) trailing price series. */
export interface PricePoint {
	/** ISO date (yyyy-mm-dd) of the sampled close. */
	date: string;
	close: number;
}

export interface InsiderRowView {
	partyName: string | null;
	partyRole: PartyRole;
	side: TransactionSide;
	/** Transaction value in EUR, when reported. */
	amount: number | null;
	/** ISO date (yyyy-mm-dd). */
	transactionDate: string;
}

export interface NewsRowView {
	headline: string;
	/** Source-native type vocabulary (free text), e.g. "Ad-hoc". */
	newsType: string | null;
	/** ISO timestamp. */
	publishedAt: string;
}

/** Everything one asset card renders. Missing data degrades to null/[] — never omitted keys. */
export interface CardData {
	instrumentId: number;
	isin: string;
	wkn: string | null;
	name: string;
	sector: string | null;
	/** Composite rank — drives grid order only, never rendered (we surface, we don't recommend). */
	rank: number;
	/** Latest EOD close ≤ run date. */
	price: number | null;
	priceDate: string | null;
	/** Trailing ~1Y weekly closes, ascending by date. */
	series: PricePoint[];
	hi52: number | null;
	lo52: number | null;
	pe: number | null;
	peerMedianPe: number | null;
	/** (pe − peer median) / peer median × 100; positive = premium (a caution, not a gain). */
	peDeltaPct: number | null;
	/** Basic EPS (ttm), EUR. */
	eps: number | null;
	/** Market capitalization, EUR. */
	marketCap: number | null;
	/** Up to 3, newest first. */
	insiders: InsiderRowView[];
	/** Up to 2, newest first. */
	news: NewsRowView[];
}

export interface ScreenerPayload {
	/** Signal-run date (yyyy-mm-dd) all card data is point-in-time consistent with. */
	runDate: string;
	universeSize: number | null;
	/** Composite gate-passers in rank order. */
	cards: CardData[];
}
