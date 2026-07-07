import { and, desc, eq, max, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, signal, signalDefinition, signalRun } from '../db/schema.js';

export interface ReportRow {
	rank: number;
	ticker: string | null;
	isin: string;
	name: string;
	score: number;
	percentile: number;
	rationale: Record<string, unknown>;
}

export interface SignalReport {
	signal: string;
	runDate: string;
	universeSize: number | null;
	passed: number;
	top: ReportRow[];
}

export async function latestRunDate(db: Db): Promise<string | null> {
	const [row] = await db.select({ runDate: max(signalRun.runDate) }).from(signalRun);
	return row?.runDate ?? null;
}

export async function signalReport(
	db: Db,
	slug: string,
	runDate: string,
	top: number
): Promise<SignalReport | null> {
	const [run] = await db.select().from(signalRun).where(eq(signalRun.runDate, runDate));
	if (!run) return null;
	const [definition] = await db.select().from(signalDefinition).where(eq(signalDefinition.slug, slug));
	if (!definition) return null;

	const rows = await db
		.select({
			rank: signal.rank,
			score: signal.score,
			percentile: signal.percentile,
			rationale: signal.rationale,
			ticker: instrument.ticker,
			isin: instrument.isin,
			name: issuer.name
		})
		.from(signal)
		.innerJoin(instrument, eq(instrument.id, signal.instrumentId))
		.innerJoin(issuer, eq(issuer.id, instrument.issuerId))
		.where(
			and(eq(signal.runId, run.id), eq(signal.definitionId, definition.id), eq(signal.passedGate, true))
		)
		.orderBy(signal.rank);

	return {
		signal: slug,
		runDate,
		universeSize: run.universeSize,
		passed: rows.length,
		top: rows.slice(0, top).map((r) => ({
			rank: r.rank as number,
			ticker: r.ticker,
			isin: r.isin,
			name: r.name,
			score: Number(r.score),
			percentile: Number(r.percentile),
			rationale: (r.rationale ?? {}) as Record<string, unknown>
		}))
	};
}

/** One-line rationale summary per signal for terminal output. */
export function summarizeRationale(slug: string, rationale: Record<string, unknown>): string {
	if (Array.isArray(rationale.reasons)) {
		const headlines = (rationale.reasons as { headline?: unknown }[])
			.map((r) => (typeof r.headline === 'string' ? r.headline : null))
			.filter((h): h is string => h !== null);
		if (headlines.length > 0) return headlines.join(' · ');
	}
	if (typeof rationale.headline === 'string') return rationale.headline;
	const num = (key: string) => (typeof rationale[key] === 'number' ? (rationale[key] as number) : null);
	if (slug === 'insider_conviction') {
		const buys = num('buy_value_eur');
		const buyers = num('buyer_count');
		return `buys ${buys === null ? '?' : Math.round(buys).toLocaleString('en-US')} EUR by ${buyers ?? '?'} insider(s)`;
	}
	if (slug === 'relative_value') {
		const pe = num('pe');
		const peerMedian = num('peer_median_pe');
		const group = rationale.peer_group;
		return `P/E ${pe?.toFixed(1)} vs ${peerMedian?.toFixed(1)} median of ${String(group ?? '?')}`;
	}
	return '';
}

export interface PerformanceSummaryRow {
	signal: string;
	horizonDays: number;
	n: number;
	/** Mean simple forward return of surfaced signals over the horizon. */
	avgReturn: number;
	/** Mean return over the equal-weight universe benchmark; null before benchmarks exist. */
	avgExcess: number | null;
	/** Share of surfaced signals beating the universe benchmark. */
	hitRate: number | null;
}

/**
 * Measured forward returns of past surfaced signals — the feedback loop
 * that turns "interesting to acquire" into a number instead of a hope.
 */
export async function performanceSummary(db: Db): Promise<PerformanceSummaryRow[]> {
	const rows = (await db.execute(sql`
		select sc.slug, sp.horizon_days,
			count(*)::int as n,
			avg(sp.fwd_return)::float8 as avg_return,
			avg(sp.fwd_return - sp.universe_fwd_return)::float8 as avg_excess,
			avg((sp.fwd_return > sp.universe_fwd_return)::int)::float8 as hit_rate
		from signal_performance sp
		join signal s on s.id = sp.signal_id
		join screen sc on sc.id = s.screen_id
		group by sc.slug, sp.horizon_days
		order by sc.slug, sp.horizon_days
	`)) as unknown as {
		slug: string;
		horizon_days: number;
		n: number;
		avg_return: number;
		avg_excess: number | null;
		hit_rate: number | null;
	}[];
	return rows.map((r) => ({
		signal: r.slug,
		horizonDays: r.horizon_days,
		n: r.n,
		avgReturn: r.avg_return,
		avgExcess: r.avg_excess,
		hitRate: r.hit_rate
	}));
}
