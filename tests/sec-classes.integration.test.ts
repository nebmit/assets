import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import { fundamental, instrument, issuer, listing, sourceFiling } from '../src/lib/server/db/schema.js';
import { persistFacts } from '../src/lib/server/sources/sec/store.js';
import { SEC_NORMALIZATION_VERSION } from '../src/lib/server/sources/sec/facts.js';
import { resolveFinancials } from '../src/lib/server/assets/financials.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('SEC cover-page class attribution', () => {
	let h: DbHandle;
	beforeAll(async () => {
		h = createDb(url!);
		await h.db.execute(sql`drop schema public cascade; create schema public; drop schema if exists drizzle cascade`);
		await migrateDb(h.db);
	});
	afterAll(async () => { await h?.sql.end(); });
	it.each([
		{ symbol: 'MA', cik: '0001141391', path: 'class-cover-10q.txt', member: 'us-gaap:CommonClassAMember', shares: '869464115' },
		{ symbol: 'F', cik: '0000037996', path: 'ford-class-cover-10q.txt', member: 'us-gaap:CommonStockMember', shares: '3916743591' }
	])('persists only the listed class for $symbol when the directory title omits its class', async ({ symbol, cik, path, member, shares }) => {
		const [entity] = await h.db.insert(issuer).values({ name: `${symbol} class fixture`, cik }).returning();
		const [asset] = await h.db.insert(instrument).values({ issuerId: entity.id, securityClass: `${symbol} Common Stock`, firstSeen: '2026-09-01', lastSeen: '2026-09-09' }).returning();
		await h.db.insert(listing).values({ instrumentId: asset.id, source: 'alpaca', symbol, currency: 'USD', mic: 'XNYS', validFrom: '2026-09-01' });
		const evidence = { hash: 'class-cover', path: `tests/fixtures/sec/${path}`, url: 'https://www.sec.gov/fixture', observedAt: '2026-09-01T00:00:00Z' };
		const [filing] = await h.db.insert(sourceFiling).values({ issuerId: entity.id, source: 'sec', externalId: `${cik}-26-000999`, form: '10-Q', status: 'processed', filedDate: '2026-07-30', reportDate: '2026-06-30', url: evidence.url, metadata: { currentHash: evidence.hash, documents: [evidence] } }).returning();
		const ctx = { db: h.db, runDate: '2026-09-09', log: () => {} };
		const input = { cik: Number(cik), facts: {} };
		await h.db.update(sourceFiling).set({ metadata: {} }).where(eq(sourceFiling.id, filing.id));
		expect(await persistFacts(ctx, entity, input, { ...evidence, hash: 'companyfacts' }, '2022-01-01')).toEqual({ missingFilings: 1 });
		const [pending] = await h.db.select().from(issuer).where(eq(issuer.id, entity.id));
		expect(pending.secMetadata?.factsStatus).toBe('pending_filings');
		await h.db.update(sourceFiling).set({ metadata: filing.metadata }).where(eq(sourceFiling.id, filing.id));
		await persistFacts(ctx, entity, input, { ...evidence, hash: 'companyfacts' }, '2022-01-01');
		await persistFacts(ctx, entity, input, { ...evidence, hash: 'companyfacts' }, '2022-01-01');
		const rows = await h.db.select().from(fundamental).where(eq(fundamental.issuerId, entity.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ instrumentId: asset.id, value: shares, metadata: { classMember: member, decimals: 'INF', normalizationVersion: SEC_NORMALIZATION_VERSION } });
		const result = resolveFinancials({ facts: rows, instrumentId: asset.id, singleClass: false, currency: 'USD', close: 20, runDate: ctx.runDate, actions: [], actionsComplete: true });
		expect(result.marketCap.value).toBe(Number(shares) * 20);
		const [updated] = await h.db.select().from(sourceFiling).where(eq(sourceFiling.id, filing.id));
		expect(updated.metadata.reportedShareClasses).toHaveLength(2);
	});
});
