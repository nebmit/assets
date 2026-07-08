import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { signal, signalDefinition } from '../db/schema.js';
import { idList, loadLatestPrices } from '../feed/queries.js';
import {
	parseInsiderComponents,
	parseRelativeValueComponents,
	type InsiderComponentsView,
	type RelativeValueComponentsView
} from '../feed/rationale.js';
import { METRICS } from '../fundamentals/metrics.js';
import { INSIDER_WINDOW_DAYS } from '../signals/context.js';
import {
	COUNTED_INSTRUMENT_TYPE,
	ROLE_WEIGHTS,
	insiderConvictionSignal,
	publicationDecay
} from '../signals/definitions/insiderConviction.js';
import { relativeValueSignal } from '../signals/definitions/relativeValue.js';
import { superSector } from '../signals/sectors.js';
import type { InsiderTx } from '../signals/types.js';
import { addDays } from '../util.js';

/**
 * Query-time enrichment for the MCP report: fundamentals snapshot, per-insider
 * dealing detail, news summary, severity sub-components and sector
 * concentration per surfaced row. Everything is bounded by the run date
 * (no lookahead), mirroring the engine's own discipline in context.ts.
 */

export interface FundamentalsSnapshot {
	price: number | null;
	priceDate: string | null;
	ytdReturn: number | null;
	high52w: number | null;
	low52w: number | null;
	marketCap: number | null;
	epsBasic: number | null;
	peTrailing: number | null;
	dividendYield: number | null;
}

export async function loadFundamentalsSnapshots(
	db: Db,
	rows: { instrumentId: number; issuerId: number }[],
	runDate: string
): Promise<Map<number, FundamentalsSnapshot>> {
	if (rows.length === 0) return new Map();
	const instrumentIds = [...new Set(rows.map((r) => r.instrumentId))];
	const issuerIds = [...new Set(rows.map((r) => r.issuerId))];

	// YTD reference: last close of the prior calendar year (bounded lookback
	// so thin listings don't produce ancient references).
	const priorYearEnd = `${Number(runDate.slice(0, 4)) - 1}-12-31`;
	const [latest, ytdRefs, fundamentals] = await Promise.all([
		loadLatestPrices(db, instrumentIds, runDate),
		db.execute(sql`
			select distinct on (instrument_id) instrument_id, close
			from eod_price
			where instrument_id in (${idList(instrumentIds)})
				and trade_date <= ${priorYearEnd}
				and trade_date > ${addDays(priorYearEnd, -30)}
			order by instrument_id, trade_date desc
		`) as unknown as Promise<{ instrument_id: number; close: string }[]>,
		db.execute(sql`
			select distinct on (issuer_id, metric) issuer_id, metric, value
			from fundamental
			where issuer_id in (${idList(issuerIds)})
				and published_date <= ${runDate}
				and metric in (${METRICS.epsBasic}, ${METRICS.marketCap}, ${METRICS.dividendPerShare})
			order by issuer_id, metric, published_date desc, period_end desc
		`) as unknown as Promise<{ issuer_id: number; metric: string; value: string }[]>
	]);
	const ytdRefByInstrument = new Map(ytdRefs.map((r) => [r.instrument_id, Number(r.close)]));
	const fundamentalByIssuer = new Map<string, number>();
	for (const row of fundamentals) {
		fundamentalByIssuer.set(`${row.issuer_id}:${row.metric}`, Number(row.value));
	}

	const out = new Map<number, FundamentalsSnapshot>();
	for (const { instrumentId, issuerId } of rows) {
		const price = latest.get(instrumentId);
		const close = price?.close ?? null;
		const ytdRef = ytdRefByInstrument.get(instrumentId) ?? null;
		const eps = fundamentalByIssuer.get(`${issuerId}:${METRICS.epsBasic}`) ?? null;
		const dps = fundamentalByIssuer.get(`${issuerId}:${METRICS.dividendPerShare}`) ?? null;
		out.set(instrumentId, {
			price: close,
			priceDate: price?.tradeDate ?? null,
			ytdReturn: close !== null && ytdRef !== null && ytdRef > 0 ? close / ytdRef - 1 : null,
			high52w: price?.hi52 ?? null,
			low52w: price?.lo52 ?? null,
			marketCap: fundamentalByIssuer.get(`${issuerId}:${METRICS.marketCap}`) ?? null,
			epsBasic: eps,
			peTrailing: close !== null && eps !== null && eps > 0 ? close / eps : null,
			dividendYield: close !== null && close > 0 && dps !== null ? dps / close : null
		});
	}
	return out;
}

/**
 * Transaction nature at the granularity the BaFin CSV export offers ("Art des
 * Geschäfts" carries only Kauf/Verkauf/Sonstiges): option exercises, RSU and
 * performance-share settlements land in `settlement_or_award`, but cannot be
 * told apart from each other.
 */
export type DealingType = 'open_market_purchase' | 'sale' | 'settlement_or_award';

const DEALING_TYPE: Record<InsiderTx['side'], DealingType> = {
	buy: 'open_market_purchase',
	sell: 'sale',
	other: 'settlement_or_award'
};

export interface InsiderDealingView {
	party: string | null;
	role: InsiderTx['partyRole'];
	/** Role weight the signal applies to this party's buys. */
	roleWeight: number;
	side: InsiderTx['side'];
	dealingType: DealingType;
	instrumentType: string | null;
	/** Whether this dealing entered the severity (share dealings with a positive amount only). */
	countedInSignal: boolean;
	amountEur: number | null;
	price: number | null;
	transactionDate: string;
	publishedDate: string;
	/** Role-weighted, publication-decayed EUR the signal credited; null for non-counted or sell rows. */
	decayedWeightEur: number | null;
}

interface DealingRow {
	issuer_id: number;
	party_name: string | null;
	party_role: InsiderTx['partyRole'];
	side: InsiderTx['side'];
	instrument_type: string | null;
	amount: string | null;
	price: string | null;
	transaction_date: string;
	published_date: string;
}

/** Pure mapper so tests can exercise the classification without a database. */
export function toDealingView(row: DealingRow, runDate: string): InsiderDealingView {
	const amount = row.amount === null ? null : Number(row.amount);
	const counted =
		row.instrument_type === COUNTED_INSTRUMENT_TYPE &&
		(row.side === 'buy' || row.side === 'sell') &&
		amount !== null &&
		amount > 0;
	return {
		party: row.party_name,
		role: row.party_role,
		roleWeight: ROLE_WEIGHTS[row.party_role],
		side: row.side,
		dealingType: DEALING_TYPE[row.side],
		instrumentType: row.instrument_type,
		countedInSignal: counted,
		amountEur: amount,
		price: row.price === null ? null : Number(row.price),
		transactionDate: row.transaction_date,
		publishedDate: row.published_date,
		decayedWeightEur:
			counted && row.side === 'buy'
				? (amount as number) *
					ROLE_WEIGHTS[row.party_role] *
					publicationDecay(row.published_date, runDate)
				: null
	};
}

/** All dealings in the signal's window per issuer (any side), newest first. */
export async function loadInsiderDetails(
	db: Db,
	issuerIds: number[],
	runDate: string
): Promise<Map<number, InsiderDealingView[]>> {
	if (issuerIds.length === 0) return new Map();
	const windowStart = addDays(runDate, -INSIDER_WINDOW_DAYS);
	const rows = (await db.execute(sql`
		select issuer_id, party_name, party_role, side, instrument_type,
			amount, price, transaction_date, published_date
		from insider_transaction
		where issuer_id in (${idList(issuerIds)})
			and transaction_date > ${windowStart} and transaction_date <= ${runDate}
			and published_date <= ${runDate}
		order by issuer_id, transaction_date desc, published_date desc
	`)) as unknown as DealingRow[];

	const byIssuer = new Map<number, InsiderDealingView[]>();
	for (const row of rows) {
		const list = byIssuer.get(row.issuer_id) ?? [];
		list.push(toDealingView(row, runDate));
		byIssuer.set(row.issuer_id, list);
	}
	return byIssuer;
}

export interface NewsSummaryView {
	/** News items in the signal window (last 30 days up to the run date). */
	windowCount: number;
	latest: { headline: string; publishedAt: string }[];
}

const NEWS_HEADLINE_LIMIT = 3;

/** Windowed news count plus the most recent headlines per issuer. */
export async function loadNewsSummaries(
	db: Db,
	issuerIds: number[],
	runDate: string
): Promise<Map<number, NewsSummaryView>> {
	if (issuerIds.length === 0) return new Map();
	const windowStart = addDays(runDate, -INSIDER_WINDOW_DAYS);
	const rows = (await db.execute(sql`
		select issuer_id, headline, published_at, window_count
		from (
			select issuer_id, headline, published_at,
				row_number() over (partition by issuer_id order by published_at desc, id desc) as rn,
				count(*) over (partition by issuer_id) as window_count
			from news_item
			where issuer_id in (${idList(issuerIds)})
				and published_date > ${windowStart} and published_date <= ${runDate}
		) ranked
		where rn <= ${NEWS_HEADLINE_LIMIT}
		order by issuer_id, published_at desc
	`)) as unknown as {
		issuer_id: number;
		headline: string;
		published_at: string | Date;
		window_count: string | number;
	}[];

	const byIssuer = new Map<number, NewsSummaryView>();
	for (const row of rows) {
		const summary = byIssuer.get(row.issuer_id) ?? { windowCount: Number(row.window_count), latest: [] };
		summary.latest.push({
			headline: row.headline,
			publishedAt: new Date(row.published_at).toISOString()
		});
		byIssuer.set(row.issuer_id, summary);
	}
	return byIssuer;
}

export interface SectorConcentration {
	/** Coarse sector bucket (signals/sectors.ts); null when the BF sector doesn't match any bucket. */
	superSector: string | null;
	/** Other issuers in the same bucket passing the same signal in this run; null without a bucket. */
	peersFiring: number | null;
}

/**
 * Sector concentration over the run's FULL passer set (before ignore-list
 * filtering and truncation — how crowded a sector is, is a market fact, not a
 * per-account view). Keyed by ISIN.
 */
export function sectorConcentration(
	passers: { isin: string; issuerId: number; sector: string | null }[]
): Map<string, SectorConcentration> {
	const issuersByBucket = new Map<string, Set<number>>();
	const bucketByIsin = new Map<string, string | null>();
	for (const row of passers) {
		const bucket = superSector(row.sector);
		bucketByIsin.set(row.isin, bucket);
		if (bucket === null) continue;
		const set = issuersByBucket.get(bucket) ?? new Set<number>();
		set.add(row.issuerId);
		issuersByBucket.set(bucket, set);
	}
	const out = new Map<string, SectorConcentration>();
	for (const row of passers) {
		const bucket = bucketByIsin.get(row.isin) ?? null;
		out.set(row.isin, {
			superSector: bucket,
			peersFiring: bucket === null ? null : (issuersByBucket.get(bucket)?.size ?? 1) - 1
		});
	}
	return out;
}

export interface ComponentBreakdown {
	insiderConviction:
		| ({ fired: boolean; severity: number | null } & InsiderComponentsView)
		| null;
	relativeValue:
		| ({ fired: boolean; severity: number | null } & RelativeValueComponentsView)
		| null;
}

/**
 * Severity sub-components per instrument, read from the run's component-signal
 * rows (persisted for the whole universe, fired or not — so a row surfaced by
 * one signal still shows the other's inputs). Fields from engine versions
 * that predate a sub-score degrade to null.
 */
export async function loadComponentBreakdowns(
	db: Db,
	runId: number,
	instrumentIds: number[]
): Promise<Map<number, ComponentBreakdown>> {
	if (instrumentIds.length === 0) return new Map();
	const slugs = [insiderConvictionSignal.slug, relativeValueSignal.slug];
	const definitions = await db
		.select({ id: signalDefinition.id, slug: signalDefinition.slug })
		.from(signalDefinition)
		.where(inArray(signalDefinition.slug, slugs));
	const slugById = new Map(definitions.map((d) => [d.id, d.slug]));
	if (definitions.length === 0) return new Map();

	const rows = await db
		.select({
			definitionId: signal.definitionId,
			instrumentId: signal.instrumentId,
			passedGate: signal.passedGate,
			score: signal.score,
			rationale: signal.rationale
		})
		.from(signal)
		.where(
			and(
				eq(signal.runId, runId),
				inArray(signal.definitionId, definitions.map((d) => d.id)),
				inArray(signal.instrumentId, instrumentIds)
			)
		);

	const out = new Map<number, ComponentBreakdown>();
	for (const row of rows) {
		const breakdown = out.get(row.instrumentId) ?? { insiderConviction: null, relativeValue: null };
		const base = {
			fired: row.passedGate,
			severity: row.score === null ? null : Number(row.score)
		};
		if (slugById.get(row.definitionId) === insiderConvictionSignal.slug) {
			breakdown.insiderConviction = { ...base, ...parseInsiderComponents(row.rationale) };
		} else {
			breakdown.relativeValue = { ...base, ...parseRelativeValueComponents(row.rationale) };
		}
		out.set(row.instrumentId, breakdown);
	}
	return out;
}
