import type { MetricEvidence } from '$lib/server/assets/metricEvidence.js';
import type { Financials } from '../assets/financials.js';
import type { NewsRowView } from '../../feed/types.js';
import { savedSnapshots, resolveSnapshots, runCutoff } from '../assets/snapshot.js';
import { signalRun } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { type ShortSellerAnalysis } from '../../shortSellers.js';
import type { Db } from '../db/index.js';
import { toDealingView, type InsiderDealingView } from '../mcp/enrich.js';
import { addDays } from '../util.js';

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
	amount: number | null;
	currency: string | null;
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
	financials: Financials;
	coverage: Record<string, { state: string; reason: string | null } & Partial<MetricEvidence>>;
	shortSellers: ShortSellerAnalysis;
	assetId: string;
	isin: string | null;
	currency: string;
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
	news: NewsRowView[];
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
			amount: dealing.amount,
			currency: dealing.currency,
			fwdReturn91d: base !== null && base > 0 && forward !== null ? forward / base - 1 : null
		});
		byParty.set(dealing.party, entry);
	}
	return [...byParty.values()].sort((a, b) => b.buyCount - a.buyCount || a.party.localeCompare(b.party));
}

/** Full drill-down for one asset; null when it is absent from the selected universe. */
export async function issuerDetail(db: Db, assetId: string, runDate: string): Promise<IssuerDetail | null> {
	let snapshot = (await savedSnapshots(db, runDate, assetId)).find((s) => s.assetId === assetId);
	if (!snapshot) {
		const [run] = await db.select().from(signalRun).where(and(eq(signalRun.runDate, runDate), and(eq(signalRun.status, 'success'), eq(signalRun.isCurrent, true))));
		if (run) return null;
		snapshot = (await resolveSnapshots(db, runDate, runCutoff(runDate), true)).find((s) => s.assetId === assetId);
	}
	if (!snapshot) return null;
	const insiders = snapshot.insiderHistory.map((t) => toDealingView(t, runDate));
	const history = (metric: string) => {
		const periods = new Map<string, typeof snapshot.metricHistory[number]>();
		for (const row of [...snapshot.metricHistory].sort((a, b) => b.publishedDate.localeCompare(a.publishedDate) || b.inputId - a.inputId)) {
			if (row.metric !== metric) continue;
			const key = `${row.periodStart}:${row.periodEnd}:${row.currency}`;
			if (!periods.has(key)) periods.set(key, row);
		}
		return [...periods.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
	};
	return { assetId, isin: snapshot.isin, currency: snapshot.currency, ticker: snapshot.ticker, name: snapshot.name, sector: snapshot.sector, superSector: snapshot.sector, runDate,
		financials: snapshot.financials, coverage: snapshot.coverage, shortSellers: snapshot.shortSellers, monthlyCloses: downsampleMonthly(snapshot.series),
		epsBasicHistory: history('eps_basic'), marketCapHistory: history('market_cap'), dividendPerShareHistory: history('dividend_per_share'),
		insiderHistory: insiders.slice(0, INSIDER_HISTORY_LIMIT), insiderFollowThrough: computeFollowThrough(insiders, snapshot.series, runDate), news: snapshot.news.slice(0, NEWS_LIMIT) };
}
