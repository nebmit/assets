/**
 * Shared (server → client) payload types for the surfaced feed. Everything
 * here must stay JSON-serializable: it crosses the SvelteKit load boundary.
 */

import type { FeedViewOption } from './views.js';

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

/** Why an asset was surfaced: one fired signal with its evidence one-liner. */
export interface ReasonView {
	signal: string;
	/** Calibrated severity in [0,1] on an absolute scale. */
	severity: number;
	/** Factual one-liner, e.g. "2 insiders bought €1.2M in 30d". */
	headline: string;
}

/** Day-over-day state of a surfaced asset relative to the previous run. */
export type LifecycleState = 'new' | 'strengthening' | 'persisting' | 'fading';

/** Everything one asset card renders. Missing data degrades to null/[] — never omitted keys. */
export interface CardData {
	instrumentId: number;
	isin: string;
	wkn: string | null;
	name: string;
	sector: string | null;
	/** Feed rank — drives grid order only, never rendered (we surface, we don't recommend). */
	rank: number;
	/** Fired signals with evidence one-liners (why this asset is here). */
	reasons: ReasonView[];
	/** Day-over-day state vs the previous run; null when no previous run exists. */
	lifecycle: LifecycleState | null;
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
	/** Up to 5, newest first. */
	insiders: InsiderRowView[];
	/** Up to 2, newest first. */
	news: NewsRowView[];
}

export interface FeedPayload {
	/** Signal-run date (yyyy-mm-dd) all card data is point-in-time consistent with. */
	runDate: string;
	universeSize: number | null;
	view: FeedViewOption;
	views: FeedViewOption[];
	/** Assets surfaced by the selected view, in rank order. */
	cards: CardData[];
}
