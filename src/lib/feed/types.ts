import type { MetricEvidence } from '$lib/server/assets/metricEvidence.js';
import type { AssetLinks } from '../externalLinks.js';
import type { ShortSellerAnalysis } from '../shortSellers.js';
/**
 * Shared (server → client) payload types for the surfaced feed. Everything
 * here must stay JSON-serializable: it crosses the SvelteKit load boundary.
 */

import type { FeedViewOption, FeedViewSlug } from './views.js';

export type PartyRole = 'executive' | 'director' | 'related_party' | 'other';
export type TransactionSide = 'buy' | 'sell' | 'other';

/** One point of the weekly-downsampled trailing three-year price series. */
export interface PricePoint {
	/** ISO date (yyyy-mm-dd) of the sampled close. */
	date: string;
	close: number;
}

export interface InsiderRowView {
	partyName: string | null;
	partyRole: PartyRole;
	side: TransactionSide;
	/** Transaction value in the reported currency, when available. */
	amount: number | null;
	currency: string | null;
	qualification: string;
	qualificationReason: string | null;
	currencyStatus: string;
	url: string | null;
	/** ISO date (yyyy-mm-dd). */
	transactionDate: string;
}

export interface NewsRowView {
	form: string | null;
	accession: string | null;
	headline: string;
	/** Source-native type vocabulary (free text), e.g. "Ad-hoc". */
	newsType: string | null;
	/** ISO timestamp. */
	publishedAt: string;
	source: string;
	url: string | null;
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
	shortSellers: ShortSellerAnalysis;
	instrumentId: number;
	assetId: string;
	isin: string | null;
	ticker: string | null;
	currency: string;
	mic: string;
	source: string;
	links: AssetLinks;
	coverage: Record<string, { state: string; reason: string | null } & Partial<MetricEvidence>>;
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
	/** Trailing three calendar years of weekly closes, ascending by date. */
	series: PricePoint[];
	hi52: number | null;
	lo52: number | null;
	pe: number | null;
	peerMedianPe: number | null;
	/** (pe − peer median) / peer median × 100; positive = premium (a caution, not a gain). */
	peDeltaPct: number | null;
	/** Qualified price-to-book ratio. */
	pb: number | null;
	/** Qualified trailing basic EPS, in the quote currency. */
	eps: number | null;
	/** Market capitalization, in the quote currency. */
	marketCap: number | null;
	/** Up to 5, newest first. */
	insiders: InsiderRowView[];
	/** Up to 2, newest first. */
	news: NewsRowView[];
}

export interface AssetCatalogEntry { assetId: string; isin: string | null; ticker: string | null; name: string; wkn: string | null; sector: string | null; currency: string; mic: string; links: AssetLinks }

export interface FeedPayload {
	catalog: AssetCatalogEntry[];
	shortSellersByAssetId: Record<string, ShortSellerAnalysis>;
	/** Signal-run date (yyyy-mm-dd) all card data is point-in-time consistent with. */
	runDate: string;
	universeSize: number | null;
	views: FeedViewOption[];
	/**
	 * Assets surfaced by each view, in rank order. All views ship in one
	 * payload so switching views never re-fetches; the heavy per-card arrays
	 * (series/insiders/news) are shared references across views, which the
	 * load serializer transfers only once.
	 */
	cardsByView: Record<FeedViewSlug, CardData[]>;
}
