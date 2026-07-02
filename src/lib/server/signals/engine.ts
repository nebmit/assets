import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { screen, signal, signalRun } from '../db/schema.js';
import type { Job, JobStats } from '../pipeline/types.js';
import { buildContext } from './context.js';
import { insiderConvictionScreen } from './screens/insiderConviction.js';
import { relativeValueScreen } from './screens/relativeValue.js';
import { percentileRanks } from './stats.js';
import type { RankedResult, ScreenDefinition, UniverseContext } from './types.js';

export const COMPOSITE_SLUG = 'value_insider_composite';
export const baseScreens: ScreenDefinition[] = [insiderConvictionScreen, relativeValueScreen];

export const compositeMeta = {
	slug: COMPOSITE_SLUG,
	name: 'Value × Insider Composite',
	version: 1,
	// equal weights until backtest history exists to tune them
	params: { components: baseScreens.map((s) => s.slug), weights: 'equal' }
};

/** Percentile-rank gate-passers within the run; rank 1 = strongest. */
export function rankResults(
	results: { instrumentId: number; passedGate: boolean; score: number | null; rationale: Record<string, unknown> }[]
): RankedResult[] {
	const passers = results.filter((r) => r.passedGate && r.score !== null);
	const percentiles = percentileRanks(passers.map((r) => r.score as number));
	const ranked = new Map<number, { percentile: number; rank: number }>();
	passers
		.map((r, i) => ({ r, percentile: percentiles[i] }))
		.sort((a, b) => b.percentile - a.percentile || a.r.instrumentId - b.r.instrumentId)
		.forEach((entry, i) => ranked.set(entry.r.instrumentId, { percentile: entry.percentile, rank: i + 1 }));

	return results.map((r) => ({
		...r,
		percentile: ranked.get(r.instrumentId)?.percentile ?? null,
		rank: ranked.get(r.instrumentId)?.rank ?? null
	}));
}

/** Evaluate all screens over a prebuilt context (pure given the context). */
export function evaluateScreens(ctx: UniverseContext): Map<string, RankedResult[]> {
	const bySlug = new Map<string, RankedResult[]>();
	for (const def of baseScreens) {
		bySlug.set(
			def.slug,
			rankResults(
				ctx.instruments.map((instrument) => ({
					instrumentId: instrument.instrumentId,
					...def.evaluate(instrument, ctx)
				}))
			)
		);
	}

	const componentResults = baseScreens.map((def) => {
		const byInstrument = new Map<number, RankedResult>();
		for (const result of bySlug.get(def.slug) ?? []) byInstrument.set(result.instrumentId, result);
		return { slug: def.slug, byInstrument };
	});
	const composite = ctx.instruments.map((instrument) => {
		const components = componentResults.map(({ slug, byInstrument }) => {
			const result = byInstrument.get(instrument.instrumentId);
			return { slug, percentile: result?.percentile ?? null };
		});
		const rationale: Record<string, unknown> = Object.fromEntries(
			components.map((c) => [`${c.slug}_percentile`, c.percentile])
		);
		const passedGate = components.every((c) => c.percentile !== null);
		return {
			instrumentId: instrument.instrumentId,
			passedGate,
			score: passedGate
				? components.reduce((sum, c) => sum + (c.percentile as number), 0) / components.length
				: null,
			rationale
		};
	});
	bySlug.set(COMPOSITE_SLUG, rankResults(composite));
	return bySlug;
}

async function screenIds(db: Db): Promise<Map<string, number>> {
	const defs = [...baseScreens, compositeMeta];
	const ids = new Map<string, number>();
	for (const def of defs) {
		const [row] = await db
			.insert(screen)
			.values({ slug: def.slug, name: def.name, version: def.version, params: def.params })
			.onConflictDoUpdate({
				target: screen.slug,
				set: { name: def.name, version: def.version, params: def.params }
			})
			.returning({ id: screen.id });
		ids.set(def.slug, row.id);
	}
	return ids;
}

/**
 * Run the engine for a date and persist one signal row per screen and
 * universe instrument (passers and non-passers, so the surfacing layer can
 * explain both). Re-running a date replaces its signal_run atomically.
 */
export async function runSignals(db: Db, runDate: string): Promise<JobStats> {
	const ctx = await buildContext(db, runDate);
	if (ctx.instruments.length === 0) throw new Error(`universe is empty on ${runDate} — run ingestion first`);
	const results = evaluateScreens(ctx);
	const ids = await screenIds(db);

	// signals cascade-delete with the run; re-runs of the same date are atomic
	await db.transaction(async (tx) => {
		await tx.delete(signalRun).where(eq(signalRun.runDate, runDate));
		const [run] = await tx
			.insert(signalRun)
			.values({ runDate, status: 'running', universeSize: ctx.instruments.length })
			.returning({ id: signalRun.id });

		for (const [slug, ranked] of results) {
			const screenId = ids.get(slug) as number;
			await tx.insert(signal).values(
				ranked.map((r) => ({
					runId: run.id,
					screenId,
					instrumentId: r.instrumentId,
					passedGate: r.passedGate,
					score: r.score?.toString(),
					percentile: r.percentile?.toString(),
					rank: r.rank,
					rationale: r.rationale
				}))
			);
		}
		await tx
			.update(signalRun)
			.set({ status: 'success', finishedAt: new Date() })
			.where(eq(signalRun.id, run.id));
	});

	const stats: JobStats = { universe: ctx.instruments.length };
	for (const [slug, ranked] of results) {
		stats[`${slug}_passed`] = ranked.filter((r) => r.passedGate).length;
	}
	return stats;
}

export const signalsJob: Job = {
	name: 'signals',
	source: 'engine',
	run: (ctx) => runSignals(ctx.db, ctx.runDate)
};
