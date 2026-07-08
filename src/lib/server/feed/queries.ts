import { and, desc, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, signal, signalDefinition, signalRun } from '../db/schema.js';
import { addDays } from '../util.js';
import { DEFAULT_VIEW_SLUG, FEED_VIEWS, type FeedViewSlug } from '../../feed/views.js';
import type {
	CardData,
	InsiderRowView,
	LifecycleState,
	NewsRowView,
	PricePoint,
	ReasonView,
	FeedPayload
} from '../../feed/types.js';
import { assembleCards, type LatestPriceView, type PasserRow } from './assemble.js';
import {
	parseHeadline,
	parseMarketCap,
	parseReasons,
	parseRelativeValueRationale,
	type RelativeValueView
} from './rationale.js';

const RELATIVE_VALUE_SLUG = 'relative_value';
const INSIDER_CONVICTION_SLUG = 'insider_conviction';

/** `in (…)` list for raw SQL — drizzle's template expands arrays as tuples, not pg arrays. */
function idList(ids: number[]) {
	return sql.join(
		ids.map((id) => sql`${id}`),
		sql`, `
	);
}

/** Build the per-view card map in FEED_VIEWS order with precise keys. */
function buildCardsByView(
	build: (slug: FeedViewSlug) => CardData[]
): Record<FeedViewSlug, CardData[]> {
	const out = {} as Record<FeedViewSlug, CardData[]>;
	for (const view of FEED_VIEWS) out[view.slug] = build(view.slug);
	return out;
}

/** Series window: 1Y of weekly closes needs a hair over 52 weeks of days. */
const SERIES_WINDOW_DAYS = 371;
const HI_LO_WINDOW_DAYS = 365;

/**
 * Load everything the feed renders — all views at once — point-in-time
 * consistent with the latest signal run (all price/insider/news reads are
 * bounded by the run date, mirroring the engine's own no-lookahead discipline
 * in context.ts). The surfaced view is the union of fired signals, so the
 * facet views add only their small per-signal fields on top of data the
 * union already needs; the heavy per-instrument maps are shared across views.
 * Returns null when no run exists yet.
 */
export async function loadFeed(db: Db): Promise<FeedPayload | null> {
	// Latest run + the one before it (for lifecycle) in a single query.
	const [runs, definitions] = await Promise.all([
		db.select().from(signalRun).orderBy(desc(signalRun.runDate)).limit(2),
		db
			.select({ id: signalDefinition.id, slug: signalDefinition.slug })
			.from(signalDefinition)
			.where(inArray(signalDefinition.slug, FEED_VIEWS.map((s) => s.slug)))
	]);
	const [run, previousRun] = runs;
	if (!run) return null;
	const runDate = run.runDate;
	const definitionIdBySlug = new Map(definitions.map((s) => [s.slug, s.id]));
	const slugByDefinitionId = new Map(definitions.map((s) => [s.id, s.slug as FeedViewSlug]));
	const feedDefinitionIds = [...definitionIdBySlug.values()];

	const emptyPayload = (): FeedPayload => ({
		runDate,
		universeSize: run.universeSize,
		views: [...FEED_VIEWS],
		cardsByView: buildCardsByView(() => [])
	});
	if (feedDefinitionIds.length === 0) return emptyPayload();

	// Current passers for every view plus the previous run's severities.
	const [passerRows, previousRows] = await Promise.all([
		db
			.select({
				definitionId: signal.definitionId,
				instrumentId: signal.instrumentId,
				issuerId: instrument.issuerId,
				rank: signal.rank,
				score: signal.score,
				rationale: signal.rationale,
				isin: instrument.isin,
				wkn: instrument.wkn,
				name: issuer.name,
				sector: issuer.sector
			})
			.from(signal)
			.innerJoin(instrument, eq(instrument.id, signal.instrumentId))
			.innerJoin(issuer, eq(issuer.id, instrument.issuerId))
			.where(
				and(
					eq(signal.runId, run.id),
					inArray(signal.definitionId, feedDefinitionIds),
					eq(signal.passedGate, true)
				)
			)
			.orderBy(signal.definitionId, signal.rank),
		previousRun === undefined
			? Promise.resolve([])
			: db
					.select({
						definitionId: signal.definitionId,
						instrumentId: signal.instrumentId,
						score: signal.score
					})
					.from(signal)
					.where(
						and(
							eq(signal.runId, previousRun.id),
							inArray(signal.definitionId, feedDefinitionIds),
							eq(signal.passedGate, true)
						)
					)
	]);
	const hasPreviousRun = previousRun !== undefined;
	const previousScoresByDefinition = new Map<number, Map<number, number | null>>();
	for (const row of previousRows) {
		const scores = previousScoresByDefinition.get(row.definitionId) ?? new Map();
		scores.set(row.instrumentId, row.score === null ? null : Number(row.score));
		previousScoresByDefinition.set(row.definitionId, scores);
	}

	const passersBySlug = new Map<FeedViewSlug, PasserRow[]>(FEED_VIEWS.map((v) => [v.slug, []]));
	for (const r of passerRows) {
		const slug = slugByDefinitionId.get(r.definitionId);
		if (slug === undefined) continue;
		const severity = r.score === null ? null : Number(r.score);
		const previousScores = previousScoresByDefinition.get(r.definitionId);
		passersBySlug.get(slug)?.push({
			instrumentId: r.instrumentId,
			issuerId: r.issuerId,
			rank: r.rank ?? 0,
			isin: r.isin,
			wkn: r.wkn,
			name: r.name,
			sector: r.sector,
			reasons: reasonsFor(slug, severity, r.rationale),
			lifecycle: lifecycleFor(severity, previousScores?.get(r.instrumentId) ?? null, hasPreviousRun)
		});
	}
	if (passerRows.length === 0) return emptyPayload();

	const instrumentIds = [...new Set(passerRows.map((p) => p.instrumentId))];
	const issuerIds = [...new Set(passerRows.map((p) => p.issuerId))];

	const [enrichment, series, latest, insiders, news] = await Promise.all([
		loadSignalEnrichment(
			db,
			run.id,
			definitionIdBySlug.get(RELATIVE_VALUE_SLUG),
			definitionIdBySlug.get(INSIDER_CONVICTION_SLUG),
			instrumentIds
		),
		loadWeeklySeries(db, instrumentIds, runDate),
		loadLatestPrices(db, instrumentIds, runDate),
		loadInsiders(db, issuerIds, runDate),
		loadNews(db, issuerIds, runDate)
	]);

	return {
		runDate,
		universeSize: run.universeSize,
		views: [...FEED_VIEWS],
		cardsByView: buildCardsByView((slug) =>
			assembleCards(
				passersBySlug.get(slug) ?? [],
				enrichment.valuation,
				enrichment.marketCap,
				series,
				latest,
				insiders,
				news
			)
		)
	};
}

/**
 * Evidence badges: the feed carries the fired-signal list in its rationale;
 * a facet view synthesizes a single reason from its own headline.
 */
function reasonsFor(slug: FeedViewSlug, severity: number | null, rationale: unknown): ReasonView[] {
	if (slug === DEFAULT_VIEW_SLUG) return parseReasons(rationale);
	const headline = parseHeadline(rationale);
	if (headline === '' || severity === null) return [];
	return [{ signal: slug, severity, headline }];
}

/** Meaningful severity move day-over-day; below this it's just "persisting". */
const LIFECYCLE_DELTA = 0.05;

function lifecycleFor(
	severity: number | null,
	previousSeverity: number | null,
	hasPreviousRun: boolean
): LifecycleState | null {
	if (!hasPreviousRun) return null;
	if (previousSeverity === null) return 'new';
	if (severity === null) return 'persisting';
	const delta = severity - previousSeverity;
	if (delta >= LIFECYCLE_DELTA) return 'strengthening';
	if (delta <= -LIFECYCLE_DELTA) return 'fading';
	return 'persisting';
}

/**
 * Card enrichment mined from signal rationales (valuation from relative-value
 * rows, market cap from insider-conviction rows), gate-independent so cards in
 * every view can show them. One query for both definitions.
 */
async function loadSignalEnrichment(
	db: Db,
	runId: number,
	valuationDefinitionId: number | undefined,
	marketCapDefinitionId: number | undefined,
	instrumentIds: number[]
): Promise<{
	valuation: Map<number, RelativeValueView>;
	marketCap: Map<number, number | null>;
}> {
	const valuation = new Map<number, RelativeValueView>();
	const marketCap = new Map<number, number | null>();
	const definitionIds = [valuationDefinitionId, marketCapDefinitionId].filter(
		(id): id is number => id !== undefined
	);
	if (definitionIds.length === 0) return { valuation, marketCap };
	const rows = await db
		.select({
			definitionId: signal.definitionId,
			instrumentId: signal.instrumentId,
			rationale: signal.rationale
		})
		.from(signal)
		.where(
			and(
				eq(signal.runId, runId),
				inArray(signal.definitionId, definitionIds),
				inArray(signal.instrumentId, instrumentIds)
			)
		);
	for (const r of rows) {
		if (r.definitionId === valuationDefinitionId) {
			valuation.set(r.instrumentId, parseRelativeValueRationale(r.rationale));
		}
		if (r.definitionId === marketCapDefinitionId) {
			marketCap.set(r.instrumentId, parseMarketCap(r.rationale));
		}
	}
	return { valuation, marketCap };
}

/** Trailing ~1Y of closes downsampled to one point per ISO week (last close wins). */
async function loadWeeklySeries(
	db: Db,
	instrumentIds: number[],
	runDate: string
): Promise<Map<number, PricePoint[]>> {
	const rows = (await db.execute(sql`
		select distinct on (instrument_id, date_trunc('week', trade_date))
			instrument_id, trade_date, close
		from eod_price
		where instrument_id in (${idList(instrumentIds)})
			and trade_date <= ${runDate}
			and trade_date > ${addDays(runDate, -SERIES_WINDOW_DAYS)}
		order by instrument_id, date_trunc('week', trade_date), trade_date desc
	`)) as unknown as { instrument_id: number; trade_date: string; close: string }[];

	const byInstrument = new Map<number, PricePoint[]>();
	for (const row of rows) {
		const list = byInstrument.get(row.instrument_id) ?? [];
		list.push({ date: row.trade_date, close: Number(row.close) });
		byInstrument.set(row.instrument_id, list);
	}
	for (const list of byInstrument.values()) {
		list.sort((a, b) => a.date.localeCompare(b.date));
	}
	return byInstrument;
}

/** Latest close plus 52-week high/low per instrument, bounded by the run date. */
async function loadLatestPrices(
	db: Db,
	instrumentIds: number[],
	runDate: string
): Promise<Map<number, LatestPriceView>> {
	const rows = (await db.execute(sql`
		select distinct on (instrument_id)
			instrument_id, trade_date, close,
			min(close) over (partition by instrument_id) as lo52,
			max(close) over (partition by instrument_id) as hi52
		from eod_price
		where instrument_id in (${idList(instrumentIds)})
			and trade_date <= ${runDate}
			and trade_date > ${addDays(runDate, -HI_LO_WINDOW_DAYS)}
		order by instrument_id, trade_date desc
	`)) as unknown as {
		instrument_id: number;
		trade_date: string;
		close: string;
		lo52: string;
		hi52: string;
	}[];

	return new Map(
		rows.map((r) => [
			r.instrument_id,
			{
				close: Number(r.close),
				tradeDate: r.trade_date,
				hi52: Number(r.hi52),
				lo52: Number(r.lo52)
			}
		])
	);
}

/** Five most recent buy/sell insider transactions per issuer, published by the run date. */
async function loadInsiders(
	db: Db,
	issuerIds: number[],
	runDate: string
): Promise<Map<number, InsiderRowView[]>> {
	const rows = (await db.execute(sql`
		select issuer_id, party_name, party_role, side, amount, transaction_date
		from (
			select issuer_id, party_name, party_role, side, amount, transaction_date,
				row_number() over (
					partition by issuer_id
					order by transaction_date desc, id desc
				) as rn
			from insider_transaction
			where issuer_id in (${idList(issuerIds)})
				and published_date <= ${runDate}
				and side in ('buy', 'sell')
		) ranked
		where rn <= 5
		order by issuer_id, transaction_date desc
	`)) as unknown as {
		issuer_id: number;
		party_name: string | null;
		party_role: InsiderRowView['partyRole'];
		side: InsiderRowView['side'];
		amount: string | null;
		transaction_date: string;
	}[];

	const byIssuer = new Map<number, InsiderRowView[]>();
	for (const row of rows) {
		const list = byIssuer.get(row.issuer_id) ?? [];
		list.push({
			partyName: row.party_name,
			partyRole: row.party_role,
			side: row.side,
			amount: row.amount === null ? null : Number(row.amount),
			transactionDate: row.transaction_date
		});
		byIssuer.set(row.issuer_id, list);
	}
	return byIssuer;
}

/** Two most recent news items per issuer, published by the run date. */
async function loadNews(
	db: Db,
	issuerIds: number[],
	runDate: string
): Promise<Map<number, NewsRowView[]>> {
	const rows = (await db.execute(sql`
		select issuer_id, headline, news_type, published_at
		from (
			select issuer_id, headline, news_type, published_at,
				row_number() over (
					partition by issuer_id
					order by published_at desc, id desc
				) as rn
			from news_item
			where issuer_id in (${idList(issuerIds)}) and published_date <= ${runDate}
		) ranked
		where rn <= 2
		order by issuer_id, published_at desc
	`)) as unknown as {
		issuer_id: number;
		headline: string;
		news_type: string | null;
		published_at: string | Date;
	}[];

	const byIssuer = new Map<number, NewsRowView[]>();
	for (const row of rows) {
		const list = byIssuer.get(row.issuer_id) ?? [];
		list.push({
			headline: row.headline,
			newsType: row.news_type,
			publishedAt: new Date(row.published_at).toISOString()
		});
		byIssuer.set(row.issuer_id, list);
	}
	return byIssuer;
}
