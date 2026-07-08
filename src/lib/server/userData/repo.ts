/**
 * Data access for per-user encrypted storage: DEK wraps (one per enrolled
 * passkey) and named ciphertext documents. Concurrency rules live here so
 * every caller gets them for free:
 *
 * - Wraps are insert-only. Two tabs bootstrapping simultaneously both try
 *   to publish a wrap of their freshly generated DEK; exactly one insert
 *   wins and the loser reads the winner's wrap back and discards its own
 *   DEK. Overwriting instead would orphan whichever ciphertext the other
 *   key had already produced.
 * - Documents update via compare-and-swap on `version`, so a stale writer
 *   loses cleanly and can merge client-side.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { userBlob, userKeyWrap } from '../db/schema.js';

export interface KeyWrap {
	credentialId: string;
	wrappedDek: string;
}

export interface BlobRecord {
	ciphertext: string;
	version: number;
	updatedAt: Date;
}

export async function listKeyWraps(db: Db, userUuid: string, purpose: string): Promise<KeyWrap[]> {
	return db
		.select({ credentialId: userKeyWrap.credentialId, wrappedDek: userKeyWrap.wrappedDek })
		.from(userKeyWrap)
		.where(and(eq(userKeyWrap.userUuid, userUuid), eq(userKeyWrap.purpose, purpose)));
}

/**
 * Publishes a wrap unless one already exists for this passkey. Returns the
 * row that ended up authoritative: `created: false` carries the pre-existing
 * wrap so a racing client can adopt it in one round-trip.
 */
export async function insertKeyWrap(
	db: Db,
	row: { userUuid: string; purpose: string; credentialId: string; wrappedDek: string }
): Promise<{ created: boolean; wrappedDek: string }> {
	const inserted = await db
		.insert(userKeyWrap)
		.values(row)
		.onConflictDoNothing()
		.returning({ wrappedDek: userKeyWrap.wrappedDek });
	if (inserted.length > 0) {
		return { created: true, wrappedDek: inserted[0].wrappedDek };
	}
	const existing = await db
		.select({ wrappedDek: userKeyWrap.wrappedDek })
		.from(userKeyWrap)
		.where(
			and(
				eq(userKeyWrap.userUuid, row.userUuid),
				eq(userKeyWrap.purpose, row.purpose),
				eq(userKeyWrap.credentialId, row.credentialId)
			)
		);
	if (existing.length === 0) {
		// Conflict yet no row: only reachable if the row was deleted between
		// the two statements; the client will retry.
		throw new Error('user_key_wrap conflict raced with a delete');
	}
	return { created: false, wrappedDek: existing[0].wrappedDek };
}

export async function getBlob(db: Db, userUuid: string, name: string): Promise<BlobRecord | null> {
	const rows = await db
		.select({
			ciphertext: userBlob.ciphertext,
			version: userBlob.version,
			updatedAt: userBlob.updatedAt
		})
		.from(userBlob)
		.where(and(eq(userBlob.userUuid, userUuid), eq(userBlob.name, name)));
	return rows[0] ?? null;
}

export type PutBlobResult =
	| { ok: true; version: number }
	| { ok: false; current: BlobRecord | null };

/**
 * Creates (baseVersion 0) or CAS-updates (baseVersion = last seen version)
 * a document. A conflict returns the current server row so the client can
 * decrypt, merge and retry without an extra fetch.
 */
export async function putBlob(
	db: Db,
	userUuid: string,
	name: string,
	ciphertext: string,
	baseVersion: number
): Promise<PutBlobResult> {
	if (baseVersion === 0) {
		const inserted = await db
			.insert(userBlob)
			.values({ userUuid, name, ciphertext, version: 1 })
			.onConflictDoNothing()
			.returning({ version: userBlob.version });
		if (inserted.length > 0) {
			return { ok: true, version: inserted[0].version };
		}
		return { ok: false, current: await getBlob(db, userUuid, name) };
	}

	const updated = await db
		.update(userBlob)
		.set({ ciphertext, version: baseVersion + 1, updatedAt: new Date() })
		.where(
			and(
				eq(userBlob.userUuid, userUuid),
				eq(userBlob.name, name),
				eq(userBlob.version, baseVersion)
			)
		)
		.returning({ version: userBlob.version });
	if (updated.length > 0) {
		return { ok: true, version: updated[0].version };
	}
	return { ok: false, current: await getBlob(db, userUuid, name) };
}
