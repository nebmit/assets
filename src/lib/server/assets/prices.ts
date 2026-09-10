import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { assetSnapshot, signalRun } from '../db/schema.js';
import type { PricePoint } from '../../feed/types.js';

/** Performance consumes the same frozen split-consistent series as charts and follow-through. */
export async function adjustedPriceHistory(db: Db, instrumentIds: number[], through: string, observedThrough = through) {
	const out = new Map<number, { series: PricePoint[]; currency: string; sourceRunId: number }>();
	if (!instrumentIds.length) return out;
	const rows = await db.selectDistinctOn([assetSnapshot.instrumentId], { instrumentId: assetSnapshot.instrumentId, sourceRunId: assetSnapshot.runId,
		series: sql<PricePoint[]>`${assetSnapshot.payload}->'series'`, currency: sql<string>`${assetSnapshot.payload}->>'currency'` })
		.from(assetSnapshot).innerJoin(signalRun, eq(signalRun.id, assetSnapshot.runId))
		.where(and(inArray(assetSnapshot.instrumentId, instrumentIds), and(eq(signalRun.status, 'success'), eq(signalRun.isCurrent, true)), lte(signalRun.runDate, observedThrough)))
		.orderBy(assetSnapshot.instrumentId, desc(signalRun.runDate), desc(signalRun.id));
	for (const row of rows) if (!out.has(row.instrumentId)) out.set(row.instrumentId, { series: row.series.filter((p) => p.date <= through), currency: row.currency, sourceRunId: row.sourceRunId });
	return out;
}
