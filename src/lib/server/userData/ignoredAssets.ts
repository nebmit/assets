/**
 * Data access for the user's ignored assets. Plaintext by design — unlike
 * the encrypted watchlist, this list must be readable server-side so the
 * MCP signal tools can filter surfaced results for the calling account.
 * Rows are idempotent per (user, isin): re-adding refreshes the name
 * snapshot but keeps the original addedAt.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { userIgnoredAsset } from '../db/schema.js';

export interface IgnoredAsset {
	isin: string;
	name: string;
	addedAt: Date;
}

export async function listIgnoredAssets(db: Db, userUuid: string): Promise<IgnoredAsset[]> {
	return db
		.select({
			isin: userIgnoredAsset.isin,
			name: userIgnoredAsset.name,
			addedAt: userIgnoredAsset.addedAt
		})
		.from(userIgnoredAsset)
		.where(eq(userIgnoredAsset.userUuid, userUuid))
		.orderBy(userIgnoredAsset.addedAt);
}

export async function listIgnoredIsins(db: Db, userUuid: string): Promise<Set<string>> {
	const rows = await db
		.select({ isin: userIgnoredAsset.isin })
		.from(userIgnoredAsset)
		.where(eq(userIgnoredAsset.userUuid, userUuid));
	return new Set(rows.map((r) => r.isin));
}

export async function addIgnoredAsset(
	db: Db,
	userUuid: string,
	isin: string,
	name: string
): Promise<IgnoredAsset> {
	const [row] = await db
		.insert(userIgnoredAsset)
		.values({ userUuid, isin, name })
		.onConflictDoUpdate({
			target: [userIgnoredAsset.userUuid, userIgnoredAsset.isin],
			set: { name: sql`excluded.name` }
		})
		.returning({
			isin: userIgnoredAsset.isin,
			name: userIgnoredAsset.name,
			addedAt: userIgnoredAsset.addedAt
		});
	return row;
}

/** Returns whether a row was actually removed (idempotent otherwise). */
export async function removeIgnoredAsset(db: Db, userUuid: string, isin: string): Promise<boolean> {
	const deleted = await db
		.delete(userIgnoredAsset)
		.where(and(eq(userIgnoredAsset.userUuid, userUuid), eq(userIgnoredAsset.isin, isin)))
		.returning({ isin: userIgnoredAsset.isin });
	return deleted.length > 0;
}
