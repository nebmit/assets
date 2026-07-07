import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, signal, signalDefinition, signalRun } from '../db/schema.js';
import { latestRunDate } from '../signals/report.js';
import { addDays } from '../util.js';
import {
	DEFAULT_VIEW_SLUG,
	FEED_VIEWS,
	feedViewBySlug,
	type FeedViewSlug
} from '../../feed/views.js';
import type {
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

/** Series window: 1Y of weekly closes needs a hair over 52 weeks of days. */
const SERIES_WINDOW_DAYS = 371;
const HI_LO_WINDOW_DAYS = 365;

/**
 * Load everything the feed renders, point-in-time consistent with
 * the latest signal run (all price/insider/news reads are bounded by the run
 * date, mirroring the engine's own no-lookahead discipline in context.ts).
 * Returns null when no run exists yet.
 */
export async function loadFeed(
	db: Db,
	selectedSlug: FeedViewSlug = DEFAULT_VIEW_SLUG
): Promise<FeedPayload | null> {
	const runDate = await latestRunDate(db);
	if (runDate === null) return null;
	const [run] = await db.select().from(signalRun).where(eq(signalRun.runDate, runDate));
	if (!run) return null;
	const selectedView = feedViewBySlug(selectedSlug);

	const definitions = await db
		.select({ id: signalDefinition.id, slug: signalDefinition.slug })
		.from(signalDefinition)
		.where(inArray(signalDefinition.slug, FEED_VIEWS.map((s) => s.slug)));
	const definitionIdBySlug = new Map(definitions.map((s) => [s.slug, s.id]));
	const selectedDefinitionId = definitionIdBySlug.get(selectedSlug);
	if (selectedDefinitionId === undefined) {
		return {
			runDate,
			universeSize: run.universeSize,
			view: selectedView,
			views: [...FEED_VIEWS],
			cards: []
		};
	}

	const passerRows = await db
		.select({
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
			and(eq(signal.runId, run.id), eq(signal.definitionId, selectedDefinitionId), eq(signal.passedGate, true))
		)
		.orderBy(signal.rank);
	const previousScores = await previousRunScores(db, runDate, selectedDefinitionId);
	const passers: PasserRow[] = passerRows.map((r) => {
		const severity = r.score === null ? null : Number(r.score);
		return {
			instrumentId: r.instrumentId,
			issuerId: r.issuerId,
			rank: r.rank ?? 0,
			isin: r.isin,
			wkn: r.wkn,
			name: r.name,
			sector: r.sector,
			reasons: reasonsFor(selectedSlug, severity, r.rationale),
			lifecycle: lifecycleFor(severity, previousScores?.get(r.instrumentId) ?? null, previousScores !== null)
		};
	});
	if (passers.length === 0) {
		return {
			runDate,
			universeSize: run.universeSize,
			view: selectedView,
			views: [...FEED_VIEWS],
			cards: []
		};
	}

	const instrumentIds = passers.map((p) => p.instrumentId);
	const issuerIds = [...new Set(passers.map((p) => p.issuerId))];

	const [valuation, marketCap, series, latest, insiders, news] = await Promise.all([
		loadValuation(db, run.id, definitionIdBySlug.get(RELATIVE_VALUE_SLUG), instrumentIds),
		loadMarketCap(db, run.id, definitionIdBySlug.get(INSIDER_CONVICTION_SLUG), instrumentIds),
		loadWeeklySeries(db, instrumentIds, runDate),
		loadLatestPrices(db, instrumentIds, runDate),
		loadInsiders(db, issuerIds, runDate),
		loadNews(db, issuerIds, runDate)
	]);

	return {
		runDate,
		universeSize: run.universeSize,
		view: selectedView,
		views: [...FEED_VIEWS],
		cards: assembleCards(passers, valuation, marketCap, series, latest, insiders, news)
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

/** Fired-signal severities of the previous run's same view (null = no previous run). */
async function previousRunScores(
	db: Db,
	runDate: string,
	definitionId: number
): Promise<Map<number, number | null> | null> {
	const [previous] = await db
		.select({ id: signalRun.id })
		.from(signalRun)
		.where(lt(signalRun.runDate, runDate))
		.orderBy(desc(signalRun.runDate))
		.limit(1);
	if (!previous) return null;
	const rows = await db
		.select({ instrumentId: signal.instrumentId, score: signal.score })
		.from(signal)
		.where(
			and(eq(signal.runId, previous.id), eq(signal.definitionId, definitionId), eq(signal.passedGate, true))
		);
	return new Map(rows.map((r) => [r.instrumentId, r.score === null ? null : Number(r.score)]));
}

async function loadValuation(
	db: Db,
	runId: number,
	definitionId: number | undefined,
	instrumentIds: number[]
): Promise<Map<number, RelativeValueView>> {
	if (definitionId === undefined) return new Map();
	const rows = await db
		.select({ instrumentId: signal.instrumentId, rationale: signal.rationale })
		.from(signal)
		.where(
			and(
				eq(signal.runId, runId),
				eq(signal.definitionId, definitionId),
				inArray(signal.instrumentId, instrumentIds)
			)
		);
	return new Map(rows.map((r) => [r.instrumentId, parseRelativeValueRationale(r.rationale)]));
}

async function loadMarketCap(
	db: Db,
	runId: number,
	definitionId: number | undefined,
	instrumentIds: number[]
): Promise<Map<number, number | null>> {
	if (definitionId === undefined) return new Map();
	const rows = await db
		.select({ instrumentId: signal.instrumentId, rationale: signal.rationale })
		.from(signal)
		.where(
			and(
				eq(signal.runId, runId),
				eq(signal.definitionId, definitionId),
				inArray(signal.instrumentId, instrumentIds)
			)
		);
	return new Map(rows.map((r) => [r.instrumentId, parseMarketCap(r.rationale)]));
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
