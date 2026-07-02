import { and, desc, eq, max } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, screen, signal, signalRun } from '../db/schema.js';

export interface ReportRow {
	rank: number;
	ticker: string | null;
	isin: string;
	name: string;
	score: number;
	percentile: number;
	rationale: Record<string, unknown>;
}

export interface ScreenReport {
	screen: string;
	runDate: string;
	universeSize: number | null;
	passed: number;
	top: ReportRow[];
}

export async function latestRunDate(db: Db): Promise<string | null> {
	const [row] = await db.select({ runDate: max(signalRun.runDate) }).from(signalRun);
	return row?.runDate ?? null;
}

export async function screenReport(
	db: Db,
	slug: string,
	runDate: string,
	top: number
): Promise<ScreenReport | null> {
	const [run] = await db.select().from(signalRun).where(eq(signalRun.runDate, runDate));
	if (!run) return null;
	const [screenRow] = await db.select().from(screen).where(eq(screen.slug, slug));
	if (!screenRow) return null;

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
			and(eq(signal.runId, run.id), eq(signal.screenId, screenRow.id), eq(signal.passedGate, true))
		)
		.orderBy(signal.rank);

	return {
		screen: slug,
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

/** One-line rationale summary per screen for terminal output. */
export function summarizeRationale(slug: string, rationale: Record<string, unknown>): string {
	const num = (key: string) => (typeof rationale[key] === 'number' ? (rationale[key] as number) : null);
	if (slug === 'insider_conviction') {
		const net = num('net_buy_value_eur');
		const buyers = num('buyer_count');
		return `net buys ${net === null ? '?' : Math.round(net).toLocaleString('en-US')} EUR by ${buyers ?? '?'} insider(s)`;
	}
	if (slug === 'relative_value') {
		const pe = num('pe');
		const peerMedian = num('peer_median_pe');
		const group = rationale.peer_group;
		return `P/E ${pe?.toFixed(1)} vs ${peerMedian?.toFixed(1)} median of ${String(group ?? '?')}`;
	}
	const parts = Object.entries(rationale)
		.filter(([k, v]) => k.endsWith('_percentile') && typeof v === 'number')
		.map(([k, v]) => `${k.replace('_percentile', '')} p${Math.round((v as number) * 100)}`);
	return parts.join(', ');
}
