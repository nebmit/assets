import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { signal, signalDefinition, signalRun } from '../db/schema.js';
import type { Job, JobStats } from '../pipeline/types.js';
import { buildContext } from './context.js';
import { insiderConvictionSignal } from './definitions/insiderConviction.js';
import { relativeValueSignal } from './definitions/relativeValue.js';
import { percentileRanks } from './stats.js';
import type { RankedResult, SignalDefinition, UniverseContext } from './types.js';

export const SURFACED_SLUG = 'surfaced';
export const signalDefinitions: SignalDefinition[] = [insiderConvictionSignal, relativeValueSignal];

/**
 * The headline feed: the *union* of fired signals, not an intersection of
 * gates. Any single signal clearing its absolute materiality floor surfaces
 * the asset; additional fired signals are confirmations that raise the
 * combined severity (noisy-or), never a requirement. Empty days are empty.
 */
export const surfacedMeta = {
	slug: SURFACED_SLUG,
	name: 'Surfaced',
	version: 1,
	params: {
		components: signalDefinitions.map((s) => s.slug),
		combination: 'noisy-or',
		severity_scale: '1 − Π(1 − component severity); components are absolute [0,1] severities'
	}
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

/** Evaluate all signals over a prebuilt context (pure given the context). */
export function evaluateSignals(ctx: UniverseContext): Map<string, RankedResult[]> {
	const bySlug = new Map<string, RankedResult[]>();
	for (const def of signalDefinitions) {
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

	const componentResults = signalDefinitions.map((def) => {
		const byInstrument = new Map<number, RankedResult>();
		for (const result of bySlug.get(def.slug) ?? []) byInstrument.set(result.instrumentId, result);
		return { slug: def.slug, byInstrument };
	});
	const surfaced = ctx.instruments.map((instrument) => {
		const fired = componentResults
			.map(({ slug, byInstrument }) => ({ slug, result: byInstrument.get(instrument.instrumentId) }))
			.filter(
				(c): c is { slug: string; result: RankedResult } =>
					c.result !== undefined && c.result.passedGate && c.result.score !== null
			);
		const rationale: Record<string, unknown> = Object.fromEntries(
			componentResults.map(({ slug, byInstrument }) => [
				`${slug}_severity`,
				byInstrument.get(instrument.instrumentId)?.score ?? null
			])
		);
		if (fired.length === 0) {
			return { instrumentId: instrument.instrumentId, passedGate: false, score: null, rationale };
		}
		// noisy-or: confirmations add with diminishing returns, never gate
		const score = 1 - fired.reduce((left, c) => left * (1 - (c.result.score as number)), 1);
		const eventDates = fired
			.map((c) => c.result.eventDate ?? null)
			.filter((d): d is string => d !== null);
		rationale.reasons = fired.map((c) => ({
			signal: c.slug,
			severity: c.result.score,
			headline: typeof c.result.rationale.headline === 'string' ? c.result.rationale.headline : c.slug
		}));
		rationale.event_date = eventDates.length > 0 ? eventDates.sort().at(-1) : null;
		return { instrumentId: instrument.instrumentId, passedGate: true, score, rationale };
	});
	bySlug.set(SURFACED_SLUG, rankResults(surfaced));
	return bySlug;
}

async function definitionIds(db: Db): Promise<Map<string, number>> {
	const defs = [...signalDefinitions, surfacedMeta];
	const ids = new Map<string, number>();
	for (const def of defs) {
		const [row] = await db
			.insert(signalDefinition)
			.values({ slug: def.slug, name: def.name, version: def.version, params: def.params })
			.onConflictDoUpdate({
				target: signalDefinition.slug,
				set: { name: def.name, version: def.version, params: def.params }
			})
			.returning({ id: signalDefinition.id });
		ids.set(def.slug, row.id);
	}
	return ids;
}

/**
 * Run the engine for a date and persist one signal row per definition and
 * universe instrument (fired and not-fired, so the surfacing layer can
 * explain both). Re-running a date replaces its signal_run atomically.
 */
export async function runSignals(db: Db, runDate: string): Promise<JobStats> {
	const ctx = await buildContext(db, runDate);
	if (ctx.instruments.length === 0) throw new Error(`universe is empty on ${runDate} — run ingestion first`);
	const results = evaluateSignals(ctx);
	const ids = await definitionIds(db);

	// signals cascade-delete with the run; re-runs of the same date are atomic
	await db.transaction(async (tx) => {
		await tx.delete(signalRun).where(eq(signalRun.runDate, runDate));
		const [run] = await tx
			.insert(signalRun)
			.values({ runDate, status: 'running', universeSize: ctx.instruments.length })
			.returning({ id: signalRun.id });

		for (const [slug, ranked] of results) {
			const definitionId = ids.get(slug) as number;
			await tx.insert(signal).values(
				ranked.map((r) => ({
					runId: run.id,
					definitionId,
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
