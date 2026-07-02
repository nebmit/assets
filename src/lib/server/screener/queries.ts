import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, screen, signal, signalRun } from '../db/schema.js';
import { latestRunDate } from '../signals/report.js';
import { addDays } from '../util.js';
import {
	DEFAULT_SCREEN_SLUG,
	SCREENER_SCREENS,
	screenerScreenBySlug,
	type ScreenerScreenSlug
} from '../../screener/screens.js';
import type { InsiderRowView, NewsRowView, PricePoint, ScreenerPayload } from '../../screener/types.js';
import { assembleCards, type LatestPriceView, type PasserRow } from './assemble.js';
import { parseMarketCap, parseRelativeValueRationale, type RelativeValueView } from './rationale.js';

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
 * Load everything the screener screen renders, point-in-time consistent with
 * the latest signal run (all price/insider/news reads are bounded by the run
 * date, mirroring the engine's own no-lookahead discipline in context.ts).
 * Returns null when no run exists yet.
 */
export async function loadScreener(
	db: Db,
	selectedSlug: ScreenerScreenSlug = DEFAULT_SCREEN_SLUG
): Promise<ScreenerPayload | null> {
	const runDate = await latestRunDate(db);
	if (runDate === null) return null;
	const [run] = await db.select().from(signalRun).where(eq(signalRun.runDate, runDate));
	if (!run) return null;
	const selectedScreen = screenerScreenBySlug(selectedSlug);

	const screens = await db
		.select({ id: screen.id, slug: screen.slug })
		.from(screen)
		.where(inArray(screen.slug, SCREENER_SCREENS.map((s) => s.slug)));
	const screenIdBySlug = new Map(screens.map((s) => [s.slug, s.id]));
	const selectedScreenId = screenIdBySlug.get(selectedSlug);
	if (selectedScreenId === undefined) {
		return {
			runDate,
			universeSize: run.universeSize,
			screen: selectedScreen,
			screens: [...SCREENER_SCREENS],
			cards: []
		};
	}

	const passerRows = await db
		.select({
			instrumentId: signal.instrumentId,
			issuerId: instrument.issuerId,
			rank: signal.rank,
			isin: instrument.isin,
			wkn: instrument.wkn,
			name: issuer.name,
			sector: issuer.sector
		})
		.from(signal)
		.innerJoin(instrument, eq(instrument.id, signal.instrumentId))
		.innerJoin(issuer, eq(issuer.id, instrument.issuerId))
		.where(
			and(eq(signal.runId, run.id), eq(signal.screenId, selectedScreenId), eq(signal.passedGate, true))
		)
		.orderBy(signal.rank);
	const passers: PasserRow[] = passerRows.map((r) => ({ ...r, rank: r.rank ?? 0 }));
	if (passers.length === 0) {
		return {
			runDate,
			universeSize: run.universeSize,
			screen: selectedScreen,
			screens: [...SCREENER_SCREENS],
			cards: []
		};
	}

	const instrumentIds = passers.map((p) => p.instrumentId);
	const issuerIds = [...new Set(passers.map((p) => p.issuerId))];

	const [valuation, marketCap, series, latest, insiders, news] = await Promise.all([
		loadValuation(db, run.id, screenIdBySlug.get(RELATIVE_VALUE_SLUG), instrumentIds),
		loadMarketCap(db, run.id, screenIdBySlug.get(INSIDER_CONVICTION_SLUG), instrumentIds),
		loadWeeklySeries(db, instrumentIds, runDate),
		loadLatestPrices(db, instrumentIds, runDate),
		loadInsiders(db, issuerIds, runDate),
		loadNews(db, issuerIds, runDate)
	]);

	return {
		runDate,
		universeSize: run.universeSize,
		screen: selectedScreen,
		screens: [...SCREENER_SCREENS],
		cards: assembleCards(passers, valuation, marketCap, series, latest, insiders, news)
	};
}

async function loadValuation(
	db: Db,
	runId: number,
	screenId: number | undefined,
	instrumentIds: number[]
): Promise<Map<number, RelativeValueView>> {
	if (screenId === undefined) return new Map();
	const rows = await db
		.select({ instrumentId: signal.instrumentId, rationale: signal.rationale })
		.from(signal)
		.where(
			and(
				eq(signal.runId, runId),
				eq(signal.screenId, screenId),
				inArray(signal.instrumentId, instrumentIds)
			)
		);
	return new Map(rows.map((r) => [r.instrumentId, parseRelativeValueRationale(r.rationale)]));
}

async function loadMarketCap(
	db: Db,
	runId: number,
	screenId: number | undefined,
	instrumentIds: number[]
): Promise<Map<number, number | null>> {
	if (screenId === undefined) return new Map();
	const rows = await db
		.select({ instrumentId: signal.instrumentId, rationale: signal.rationale })
		.from(signal)
		.where(
			and(
				eq(signal.runId, runId),
				eq(signal.screenId, screenId),
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
