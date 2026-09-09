import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('populated shared-asset migration', () => {
	let handle: DbHandle, directory: string;
	beforeAll(async () => {
		handle = createDb(url!);
		await handle.db.execute(sql`drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`);
		directory = await mkdtemp(path.join(tmpdir(), 'assets-old-migrations-'));
		await mkdir(path.join(directory, 'meta'));
		const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
		journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 10);
		await writeFile(path.join(directory, 'meta/_journal.json'), JSON.stringify(journal));
		for (const entry of journal.entries) await cp(`drizzle/${entry.tag}.sql`, path.join(directory, `${entry.tag}.sql`));
		await migrate(handle.db, { migrationsFolder: directory });
	});
	afterAll(async () => { await handle?.sql.end(); if (directory) await rm(directory, { recursive: true }); });
	it('preserves instrument, prices, user data and unresolved identifiers transactionally', async () => {
		await handle.db.execute(sql`insert into issuer(id,name) values(42,'Legacy SE'); insert into instrument(id,issuer_id,isin,ticker,first_seen,last_seen) values(57,42,'DE0007164600','SAP','2020-01-01','2026-09-01'); insert into eod_price(instrument_id,trade_date,close) values(57,'2026-09-01',100); insert into index_membership(instrument_id,index_name,valid_from) values(57,'DAX','2020-01-01'); insert into user_ignored_asset(user_uuid,isin,name) values('user','DE0007164600','SAP'),('user','DE0000000099','Unresolved'); insert into user_blob(user_uuid,name,ciphertext,version) values('user','watchlist','unchanged-encrypted-document',7);`);
		await migrateDb(handle.db);
		const [identity] = await handle.db.execute(sql`select i.id,i.asset_id,l.id as listing_id,l.symbol,l.mic from instrument i join listing l on l.instrument_id=i.id where i.id=57`);
		expect(identity.id).toBe(57); expect(identity.asset_id).toMatch(/^[a-f0-9-]{36}$/); expect(identity.symbol).toBe('SAP'); expect(identity.mic).toBe('XETR');
		const [price] = await handle.db.execute(sql`select listing_id,close,observed_at,adjustment from eod_price`);
		expect(price.listing_id).toBe(identity.listing_id); expect(price.close).toBe('100'); expect(price.observed_at).toBeNull(); expect(price.adjustment).toBe('raw');
		const ignored = await handle.db.execute(sql`select asset_id from user_ignored_asset order by name`);
		expect(ignored.map((r) => r.asset_id)).toEqual([identity.asset_id, 'unresolved-isin:DE0000000099']);
		const [blob] = await handle.db.execute(sql`select ciphertext,version from user_blob`);
		expect(blob).toMatchObject({ ciphertext: 'unchanged-encrypted-document', version: 7 });
		await migrateDb(handle.db);
		expect((await handle.db.execute(sql`select asset_id from instrument where id=57`))[0].asset_id).toBe(identity.asset_id);
	});
});
