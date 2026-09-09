import { and, desc, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { eodPrice } from '../db/schema.js';
import { fingerprint } from './evidence.js';

/** Ignore identical re-observations, but retain every correction, including a return to an earlier value. */
export async function storePrices(db: Db, rows: (typeof eodPrice.$inferInsert)[]): Promise<number> {
	if (!rows.length) return 0;
	const existing = await db.select().from(eodPrice).where(and(inArray(eodPrice.listingId, [...new Set(rows.map((r) => r.listingId))]), inArray(eodPrice.tradeDate, [...new Set(rows.map((r) => r.tradeDate))]))).orderBy(sql`${eodPrice.observedAt} desc nulls last`, desc(eodPrice.id));
	const key = (r: typeof eodPrice.$inferInsert) => `${r.listingId}:${r.tradeDate}:${r.source}:${r.feed}:${r.adjustment ?? 'raw'}`;
	const latest = new Map<string, typeof eodPrice.$inferInsert>();
	for (const row of existing) if (!latest.has(key(row))) latest.set(key(row), row);
	const signature = (r: typeof eodPrice.$inferInsert) => fingerprint([r.close, r.open ?? null, r.high ?? null, r.low ?? null, r.volume ?? null, r.currency]);
	const changed: (typeof eodPrice.$inferInsert)[] = [];
	for (const row of rows) {
		const before = latest.get(key(row));
		if (before && (signature(before) === signature(row) || (row.open == null && row.close === before.close && row.currency === before.currency))) continue;
		const observedAt = row.observedAt ?? new Date();
		changed.push({ ...row, observedAt, sourceRecordId: fingerprint([key(row), signature(row), observedAt.toISOString()]) });
		latest.set(key(row), row);
	}
	for (let i = 0; i < changed.length; i += 500) await db.insert(eodPrice).values(changed.slice(i, i + 500)).onConflictDoNothing();
	return changed.length;
}
