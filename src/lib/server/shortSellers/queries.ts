import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, shortPositionSnapshot, signal, signalDefinition } from '../db/schema.js';
import { analyzeShortSellers } from './analysis.js';
import { parseShortSellerRationale } from './rationale.js';

export async function loadShortSellerAnalysis(db: Db, runDate: string) {
	const [snapshots, identities] = await Promise.all([
		db.select().from(shortPositionSnapshot)
			.where(sql`${shortPositionSnapshot.capturedAt} < (${runDate}::date + interval '1 day') at time zone 'Europe/Berlin'`)
			.orderBy(desc(shortPositionSnapshot.capturedAt), desc(shortPositionSnapshot.id)).limit(1),
		db.select({ isin: instrument.isin, issuerId: instrument.issuerId }).from(instrument)
	]);
	return analyzeShortSellers(snapshots[0] ?? null, identities, runDate);
}

/** Read the exact evidence used by this signal run, including non-passers. */
export async function loadRunShortSellers(db: Db, runId: number) {
	const rows = await db.select({ isin: instrument.isin, rationale: signal.rationale })
		.from(signal).innerJoin(signalDefinition, eq(signal.definitionId, signalDefinition.id))
		.innerJoin(instrument, eq(signal.instrumentId, instrument.id))
		.where(and(eq(signal.runId, runId), eq(signalDefinition.slug, 'no_disclosed_shorts')));
	return Object.fromEntries(rows.map((r) => [r.isin, parseShortSellerRationale(r.rationale)]));
}
