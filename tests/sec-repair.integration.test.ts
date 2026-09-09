import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import { issuer, sourceFiling, newsItem } from '../src/lib/server/db/schema.js';
import { persistNews, SEC_NEWS_VERSION } from '../src/lib/server/sources/sec/store.js';
import { repairNews } from '../src/lib/server/sources/sec/jobs.js';
import type { JobContext } from '../src/lib/server/pipeline/types.js';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('SEC migrated news repair', () => {
	let handle: DbHandle, ctx: JobContext;
	let target: typeof sourceFiling.$inferSelect;
	const evidence = { hash: 'archived', path: 'tests/fixtures/sec/intel-companyfacts.json', url: 'https://www.sec.gov/fixture', observedAt: '2026-08-02T00:00:00Z' };
	beforeAll(async () => {
		handle = createDb(url!);
		await handle.db.execute(sql`drop schema public cascade; create schema public; drop schema if exists drizzle cascade`);
		await migrateDb(handle.db);
		const [entity, outside] = await handle.db.insert(issuer).values([
			{ name: 'Intel test', cik: '0000050863', secMetadata: { status: 'included' } },
			{ name: 'Outside', cik: '0000000002', secMetadata: { status: 'included' } }
		]).returning();
		ctx = { db: handle.db, runDate: '2026-09-08', cik: entity.cik!, log: () => {} };
		const base = { source: 'sec', form: '8-K', status: 'processed', filedDate: '2026-08-01', acceptedAt: new Date('2026-08-01T20:00:00Z'), url: evidence.url, metadata: { documents: [evidence], currentHash: evidence.hash } };
		[target] = await handle.db.insert(sourceFiling).values({ ...base, issuerId: entity.id, externalId: '0000050863-26-000999' }).returning();
		const [other] = await handle.db.insert(sourceFiling).values({ ...base, issuerId: outside.id, externalId: '0000000002-26-000999' }).returning();
		const [ownership] = await handle.db.insert(sourceFiling).values({ ...base, form: '4', issuerId: entity.id, externalId: '0000050863-26-000998' }).returning();
		for (const f of [target, other, ownership]) {
			await persistNews(ctx, { ...f, form: '8-K' }, evidence);
			await handle.db.update(newsItem).set({ qualification: 'unqualified', qualificationReason: 'requires_normalization', observedAt: new Date('2026-08-02'), raw: {} }).where(eq(newsItem.filingId, f.id));
		}
	});
	afterAll(async () => { await handle?.sql.end(); });
	it('repairs only processed financial news in the selected issuer scope', async () => {
		expect(await repairNews(ctx)).toEqual({ repaired: 1, failed: 0 });
		const rows = await handle.db.select().from(newsItem);
		expect(rows.filter((n) => n.qualification === 'qualified')).toHaveLength(1);
		const news = rows.find((n) => n.filingId === target.id)!;
		expect(news.qualificationReason).toBeNull();
		expect(news.publishedAt.toISOString()).toBe('2026-08-01T20:00:00.000Z');
		expect(news.observedAt!.getTime()).toBeGreaterThan(new Date('2026-08-02').getTime());
		expect(news.raw).toMatchObject({ normalizationVersion: SEC_NEWS_VERSION });
		expect(await handle.db.select().from(newsItem).where(and(eq(newsItem.qualification, 'qualified'), sql`${newsItem.observedAt} <= '2026-08-02'`))).toHaveLength(0);
	});
	it('is idempotent and leaves the filing queue processed', async () => {
		expect(await repairNews(ctx)).toEqual({ repaired: 0, failed: 0 });
		expect(await handle.db.select().from(newsItem)).toHaveLength(3);
		const [f] = await handle.db.select().from(sourceFiling).where(eq(sourceFiling.id, target.id));
		expect(f.status).toBe('processed');
	});
});
