import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import { userBlob, userIgnoredAsset, userKeyWrap } from '../src/lib/server/db/schema.js';
import {
	addIgnoredAsset,
	listIgnoredAssets,
	listIgnoredIsins,
	removeIgnoredAsset
} from '../src/lib/server/userData/ignoredAssets.js';
import {
	getBlob,
	insertKeyWrap,
	listKeyWraps,
	putBlob
} from '../src/lib/server/userData/repo.js';

/**
 * Requires a Postgres at TEST_DATABASE_URL (dropped/recreated content!).
 * Skipped when the variable is unset so unit runs stay DB-free.
 */
const url = process.env.TEST_DATABASE_URL;

const USER = '00000000-0000-4000-8000-000000000001';
const OTHER_USER = '00000000-0000-4000-8000-000000000002';
const PURPOSE = 'assets-user-data';
const IV = 'AAAAAAAAAAAAAAAA';
const WRAP_A = `v1.${IV}.d3JhcEE`;
const WRAP_B = `v1.${IV}.d3JhcEI`;
const DOC_1 = `v1.${IV}.ZG9jMQ`;
const DOC_2 = `v1.${IV}.ZG9jMg`;
const DOC_3 = `v1.${IV}.ZG9jMw`;

describe.skipIf(!url)('userData repo (integration)', () => {
	let handle: DbHandle;

	beforeAll(async () => {
		handle = createDb(url as string);
		await handle.db.execute(sql`drop schema public cascade; create schema public;`);
		await handle.db.execute(sql`drop schema if exists drizzle cascade;`);
		await migrateDb(handle.db);
	});

	beforeEach(async () => {
		await handle.db.delete(userKeyWrap);
		await handle.db.delete(userBlob);
		await handle.db.delete(userIgnoredAsset);
	});

	afterAll(async () => {
		await handle?.sql.end();
	});

	describe('key wraps', () => {
		it('inserts and lists per user and purpose', async () => {
			const result = await insertKeyWrap(handle.db, {
				userUuid: USER,
				purpose: PURPOSE,
				credentialId: 'cred-1',
				wrappedDek: WRAP_A
			});
			expect(result).toEqual({ created: true, wrappedDek: WRAP_A });

			expect(await listKeyWraps(handle.db, USER, PURPOSE)).toEqual([
				{ credentialId: 'cred-1', wrappedDek: WRAP_A }
			]);
			expect(await listKeyWraps(handle.db, OTHER_USER, PURPOSE)).toEqual([]);
			expect(await listKeyWraps(handle.db, USER, 'other-purpose')).toEqual([]);
		});

		it('never overwrites: a conflicting insert returns the existing wrap', async () => {
			await insertKeyWrap(handle.db, {
				userUuid: USER,
				purpose: PURPOSE,
				credentialId: 'cred-1',
				wrappedDek: WRAP_A
			});
			// Second tab lost the bootstrap race and posts a wrap of its own DEK.
			const result = await insertKeyWrap(handle.db, {
				userUuid: USER,
				purpose: PURPOSE,
				credentialId: 'cred-1',
				wrappedDek: WRAP_B
			});
			expect(result).toEqual({ created: false, wrappedDek: WRAP_A });
			expect(await listKeyWraps(handle.db, USER, PURPOSE)).toEqual([
				{ credentialId: 'cred-1', wrappedDek: WRAP_A }
			]);
		});

		it('stores one wrap per credential', async () => {
			await insertKeyWrap(handle.db, {
				userUuid: USER,
				purpose: PURPOSE,
				credentialId: 'cred-1',
				wrappedDek: WRAP_A
			});
			await insertKeyWrap(handle.db, {
				userUuid: USER,
				purpose: PURPOSE,
				credentialId: 'cred-2',
				wrappedDek: WRAP_B
			});
			const wraps = await listKeyWraps(handle.db, USER, PURPOSE);
			expect(wraps).toHaveLength(2);
		});
	});

	describe('blobs', () => {
		it('creates at baseVersion 0 and reads back', async () => {
			const created = await putBlob(handle.db, USER, 'watchlist', DOC_1, 0);
			expect(created).toEqual({ ok: true, version: 1 });

			const blob = await getBlob(handle.db, USER, 'watchlist');
			expect(blob?.ciphertext).toBe(DOC_1);
			expect(blob?.version).toBe(1);
			expect(await getBlob(handle.db, OTHER_USER, 'watchlist')).toBeNull();
		});

		it('rejects a second create with the current row', async () => {
			await putBlob(handle.db, USER, 'watchlist', DOC_1, 0);
			const conflict = await putBlob(handle.db, USER, 'watchlist', DOC_2, 0);
			expect(conflict.ok).toBe(false);
			if (!conflict.ok) {
				expect(conflict.current?.ciphertext).toBe(DOC_1);
				expect(conflict.current?.version).toBe(1);
			}
		});

		it('CAS-updates on the matching version and bumps it', async () => {
			await putBlob(handle.db, USER, 'watchlist', DOC_1, 0);
			const updated = await putBlob(handle.db, USER, 'watchlist', DOC_2, 1);
			expect(updated).toEqual({ ok: true, version: 2 });
			expect((await getBlob(handle.db, USER, 'watchlist'))?.ciphertext).toBe(DOC_2);
		});

		it('a stale writer loses and receives the winning row', async () => {
			await putBlob(handle.db, USER, 'watchlist', DOC_1, 0); // v1
			await putBlob(handle.db, USER, 'watchlist', DOC_2, 1); // v2
			// Writer still on v1 tries to save.
			const stale = await putBlob(handle.db, USER, 'watchlist', DOC_3, 1);
			expect(stale.ok).toBe(false);
			if (!stale.ok) {
				expect(stale.current?.ciphertext).toBe(DOC_2);
				expect(stale.current?.version).toBe(2);
			}
			// Merge-and-retry against the returned version succeeds.
			const retry = await putBlob(handle.db, USER, 'watchlist', DOC_3, 2);
			expect(retry).toEqual({ ok: true, version: 3 });
		});

		it('reports a vanished row as missing on stale update', async () => {
			const gone = await putBlob(handle.db, USER, 'watchlist', DOC_1, 5);
			expect(gone).toEqual({ ok: false, current: null });
		});

		it('versions two documents of one user independently', async () => {
			await putBlob(handle.db, USER, 'watchlist', DOC_1, 0); // v1
			await putBlob(handle.db, USER, 'other-doc', DOC_2, 0); // v1
			await putBlob(handle.db, USER, 'watchlist', DOC_3, 1); // v2

			// Advancing the watchlist neither bumps nor conflicts the other doc.
			const otherBlob = await getBlob(handle.db, USER, 'other-doc');
			expect(otherBlob?.ciphertext).toBe(DOC_2);
			expect(otherBlob?.version).toBe(1);

			const stale = await putBlob(handle.db, USER, 'other-doc', DOC_3, 0);
			expect(stale.ok).toBe(false);
			const retry = await putBlob(handle.db, USER, 'other-doc', DOC_3, 1);
			expect(retry).toEqual({ ok: true, version: 2 });
		});
	});

	describe('ignored assets', () => {
		const SAP = 'DE0007164600';
		const ALLIANZ = 'DE0008404005';

		it('adds, lists per user and removes', async () => {
			await addIgnoredAsset(handle.db, USER, SAP, 'SAP SE');
			await addIgnoredAsset(handle.db, USER, ALLIANZ, 'Allianz SE');

			const entries = await listIgnoredAssets(handle.db, USER);
			expect(entries.map((e) => e.isin)).toEqual([SAP, ALLIANZ]);
			expect(await listIgnoredAssets(handle.db, OTHER_USER)).toEqual([]);
			expect(await listIgnoredIsins(handle.db, USER)).toEqual(new Set([SAP, ALLIANZ]));

			expect(await removeIgnoredAsset(handle.db, USER, SAP)).toBe(true);
			expect((await listIgnoredAssets(handle.db, USER)).map((e) => e.isin)).toEqual([ALLIANZ]);
		});

		it('re-adding refreshes the name but keeps the original addedAt', async () => {
			const first = await addIgnoredAsset(handle.db, USER, SAP, 'SAP SE');
			const again = await addIgnoredAsset(handle.db, USER, SAP, 'SAP SE (renamed)');
			expect(again.name).toBe('SAP SE (renamed)');
			expect(again.addedAt).toEqual(first.addedAt);
			expect(await listIgnoredAssets(handle.db, USER)).toHaveLength(1);
		});

		it('removing an absent row is an idempotent no-op', async () => {
			expect(await removeIgnoredAsset(handle.db, USER, SAP)).toBe(false);
		});
	});
});
