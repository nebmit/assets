import { sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { toDealingView, type InsiderDealingView } from '../mcp/enrich.js';
import { METRICS } from '../fundamentals/metrics.js';
import { superSector } from '../signals/sectors.js';
import { addDays } from '../util.js';
import { subtractYears } from '../../date.js';

/**
 * Drill-down payload behind the `issuer_detail` MCP tool: the history that is
 * too heavy for the per-row feed — price and fundamentals trajectories, the
 * full stored insider record and per-party follow-through. All reads are
 * bounded by the run date (no lookahead). History goes back only as far as
 * ingestion does: prices ~3 years, dealings accumulate beyond BaFin's rolling
 * 12-month export the longer the pipeline runs.
 */

const INSIDER_HISTORY_LIMIT = 50;
const NEWS_LIMIT = 10;
/** Follow-through horizon: forward return measured ~3 months after a buy. */
const FOLLOW_THROUGH_DAYS = 91;
/** A close counts as "at" a date when it is at most this many days older. */
const CLOSE_LOOKBACK_DAYS = 14;

export interface PricePoint {
	date: string;
	close: number;
}

export interface MetricPoint {
	value: number;
	periodEnd: string;
	publishedDate: string;
}

export interface FollowThroughBuy {
	transactionDate: string;
	amountEur: number | null;
	/** Simple price return over ~91 days after the buy; null when the horizon has not elapsed or closes are missing. */
	fwdReturn91d: number | null;
}

export interface PartyFollowThrough {
	party: string;
	role: InsiderDealingView['role'];
	buyCount: number;
	buys: FollowThroughBuy[];
}

export interface IssuerDetail {
	isin: string;
	ticker: string | null;
	name: string;
	sector: string | null;
	superSector: string | null;
	runDate: string;
	/** Last close per calendar month, ascending, ~36 months. */
	monthlyCloses: PricePoint[];
	epsBasicHistory: MetricPoint[];
	marketCapHistory: MetricPoint[];
	dividendPerShareHistory: MetricPoint[];
	/** Stored dealings (any side), newest first, capped. */
	insiderHistory: InsiderDealingView[];
	/** Per named insider: their counted share buys and what the price did afterwards. */
	insiderFollowThrough: PartyFollowThrough[];
	news: { headline: string; publishedAt: string }[];
}

/** Last close per calendar month (input ascending by date). */
export function downsampleMonthly(closes: PricePoint[]): PricePoint[] {
	const byMonth = new Map<string, PricePoint>();
	for (const point of closes) byMonth.set(point.date.slice(0, 7), point);
	return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Latest close at most CLOSE_LOOKBACK_DAYS before `date` (input ascending). */
function closeAt(closes: PricePoint[], date: string): number | null {
	const floor = addDays(date, -CLOSE_LOOKBACK_DAYS);
	let found: PricePoint | null = null;
	for (const point of closes) {
		if (point.date > date) break;
		if (point.date > floor) found = point;
	}
	return found?.close ?? null;
}

/**
 * Group counted share buys by named insider and measure the forward return
 * after each one. Unnamed filings can't prove identity, so they are excluded.
 */
export function computeFollowThrough(
	dealings: InsiderDealingView[],
	closes: PricePoint[],
	runDate: string
): PartyFollowThrough[] {
	const byParty = new Map<string, PartyFollowThrough>();
	for (const dealing of dealings) {
		if (dealing.party === null || dealing.side !== 'buy' || !dealing.countedInSignal) continue;
		const horizonDate = addDays(dealing.transactionDate, FOLLOW_THROUGH_DAYS);
		const base = closeAt(closes, dealing.transactionDate);
		const forward = horizonDate > runDate ? null : closeAt(closes, horizonDate);
		const entry = byParty.get(dealing.party) ?? {
			party: dealing.party,
			role: dealing.role,
			buyCount: 0,
			buys: []
		};
		entry.buyCount += 1;
		entry.buys.push({
			transactionDate: dealing.transactionDate,
			amountEur: dealing.amountEur,
			fwdReturn91d: base !== null && base > 0 && forward !== null ? forward / base - 1 : null
		});
		byParty.set(dealing.party, entry);
	}
	return [...byParty.values()].sort((a, b) => b.buyCount - a.buyCount || a.party.localeCompare(b.party));
}

/** Full drill-down for one ISIN; null when the ISIN is not in the universe. */
export async function issuerDetail(db: Db, isin: string, runDate: string): Promise<IssuerDetail | null> {
	const [target] = (await db.execute(sql`
		select i.id as instrument_id, i.issuer_id, i.isin, i.ticker, s.name, s.sector
		from instrument i
		join issuer s on s.id = i.issuer_id
		where i.isin = ${isin}
		limit 1
	`)) as unknown as {
		instrument_id: number;
		issuer_id: number;
		isin: string;
		ticker: string | null;
		name: string;
		sector: string | null;
	}[];
	if (!target) return null;

	const [closeRows, fundamentalRows, dealingRows, newsRows] = await Promise.all([
		db.execute(sql`
			select trade_date, close
			from eod_price
			where instrument_id = ${target.instrument_id}
				and trade_date <= ${runDate} and trade_date >= ${subtractYears(runDate, 3)}
			order by trade_date
		`) as unknown as Promise<{ trade_date: string; close: string }[]>,
		db.execute(sql`
			select metric, value, period_end, published_date
			from fundamental
			where issuer_id = ${target.issuer_id}
				and published_date <= ${runDate}
				and metric in (${METRICS.epsBasic}, ${METRICS.marketCap}, ${METRICS.dividendPerShare})
			order by metric, period_end
		`) as unknown as Promise<{
			metric: string;
			value: string;
			period_end: string;
			published_date: string;
		}[]>,
		db.execute(sql`
			select issuer_id, party_name, party_role, side, instrument_type,
				amount, price, transaction_date, published_date
			from insider_transaction
			where issuer_id = ${target.issuer_id} and published_date <= ${runDate}
			order by transaction_date desc, published_date desc, id desc
			limit ${INSIDER_HISTORY_LIMIT}
		`) as unknown as Promise<Parameters<typeof toDealingView>[0][]>,
		db.execute(sql`
			select headline, published_at
			from news_item
			where issuer_id = ${target.issuer_id} and published_date <= ${runDate}
			order by published_at desc, id desc
			limit ${NEWS_LIMIT}
		`) as unknown as Promise<{ headline: string; published_at: string | Date }[]>
	]);

	const closes: PricePoint[] = closeRows.map((r) => ({ date: r.trade_date, close: Number(r.close) }));
	const metricHistory = (metric: string): MetricPoint[] =>
		fundamentalRows
			.filter((r) => r.metric === metric)
			.map((r) => ({ value: Number(r.value), periodEnd: r.period_end, publishedDate: r.published_date }));
	const insiderHistory = dealingRows.map((row) => toDealingView(row, runDate));

	return {
		isin: target.isin,
		ticker: target.ticker,
		name: target.name,
		sector: target.sector,
		superSector: superSector(target.sector),
		runDate,
		monthlyCloses: downsampleMonthly(closes),
		epsBasicHistory: metricHistory(METRICS.epsBasic),
		marketCapHistory: metricHistory(METRICS.marketCap),
		dividendPerShareHistory: metricHistory(METRICS.dividendPerShare),
		insiderHistory,
		insiderFollowThrough: computeFollowThrough(insiderHistory, closes, runDate),
		news: newsRows.map((r) => ({
			headline: r.headline,
			publishedAt: new Date(r.published_at).toISOString()
		}))
	};
}
