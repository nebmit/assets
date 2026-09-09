import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import { indexMembership, insiderTransaction, instrument, issuer, listing, shortPositionSnapshot } from '../src/lib/server/db/schema.js';
import { loadShortSellerAnalysis } from '../src/lib/server/shortSellers/queries.js';
import { runSignals } from '../src/lib/server/signals/engine.js';
import { loadFeed } from '../src/lib/server/feed/queries.js';
import { enrichedSignalReport } from '../src/lib/server/mcp/report.js';
import { issuerDetail } from '../src/lib/server/issuer/detail.js';
import type { ParsedShortPosition } from '../src/lib/server/sources/bundesanzeiger/parse.js';

const url = process.env.TEST_DATABASE_URL;
const RUN_DATE = '2026-09-05';
const isins = ['DE0005158703', 'DE0005419105', 'DE0008303504'];
const row: ParsedShortPosition = {
	holderNameRaw: 'Test Fund', issuerNameRaw: 'Test 1', isin: isins[0], positionPct: 0.7,
	positionDate: '2020-01-01', naturalKeyHash: 'fixture', raw: {}
};

describe.skipIf(!url)('short seller snapshots through engine, feed and MCP', () => {
	let handle: DbHandle;
	let issuerIds: number[];
	let assetIds: string[];
	beforeAll(async () => {
		handle = createDb(url!);
		await handle.db.execute(sql`drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`);
		await migrateDb(handle.db);
		issuerIds = []; assetIds = [];
		for (const [i, isin] of isins.entries()) {
			const [iss] = await handle.db.insert(issuer).values({ name: `Test ${i + 1}` }).returning();
			issuerIds.push(iss.id);
			const [inst] = await handle.db.insert(instrument).values({ issuerId: iss.id, isin, shortDisclosureSource: 'bundesanzeiger', firstSeen: RUN_DATE, lastSeen: RUN_DATE }).returning();
			assetIds.push(inst.assetId);
			await handle.db.insert(listing).values({ instrumentId: inst.id, symbol: `T${i}`, mic: 'XETR', currency: 'EUR', source: 'boerse_frankfurt', validFrom: '2026-01-01' });
			await handle.db.insert(indexMembership).values({ instrumentId: inst.id, indexName: 'DAX', validFrom: '2026-01-01' });
			if (i < 2) await handle.db.insert(insiderTransaction).values({
				issuerId: iss.id, issuerNameRaw: `Test ${i + 1}`, partyName: 'Director', partyRole: 'executive_board',
				side: 'buy', instrumentType: 'common_share', currency: 'EUR', amount: '1000000', transactionDate: RUN_DATE,
				publishedDate: RUN_DATE, naturalKeyHash: `buy-${i}`
			});
		}
	});
	beforeEach(async () => {
		await handle.db.execute(sql`truncate short_position_snapshot, signal_run cascade`);
	});
	afterAll(async () => { await handle?.sql.end(); });

	async function snapshot(capturedAt = '2026-09-05T06:00:00Z', rows = [row]) {
		await handle.db.insert(shortPositionSnapshot).values({
			source: 'bundesanzeiger', capturedAt: new Date(capturedAt), rows,
			diagnostics: { complete: true, unidentifiableRows: 0, duplicatesCollapsed: 0 }
		});
	}

	it('selects snapshots by Berlin day, including DST, and excludes future observations', async () => {
		await snapshot('2026-09-05T21:59:59Z');
		await snapshot('2026-09-05T22:00:00Z', [{ ...row, positionPct: 0.9 }]);
		expect((await loadShortSellerAnalysis(handle.db, RUN_DATE)).get(issuerIds[0])?.totalDisclosedPct).toBe(0.7);
		expect((await loadShortSellerAnalysis(handle.db, '2026-09-06')).get(issuerIds[0])?.totalDisclosedPct).toBe(0.9);
		expect((await loadShortSellerAnalysis(handle.db, '2026-09-04')).get(issuerIds[0])?.status).toBe('unknown');
		await snapshot('2026-12-01T22:59:59Z');
		await snapshot('2026-12-01T23:00:00Z', [{ ...row, positionPct: 1.1 }]);
		expect((await loadShortSellerAnalysis(handle.db, '2026-12-01', new Date('2026-12-02'))).get(issuerIds[0])?.totalDisclosedPct).toBe(0.7);
	});

	it('keeps card, watchlist and MCP evidence identical after newer ingestion', async () => {
		await snapshot();
		await runSignals(handle.db, RUN_DATE);
		await snapshot('2026-09-05T10:00:00Z', [{ ...row, positionPct: 0.49 }]);
		const feed = (await loadFeed(handle.db))!;
		expect(feed.cardsByView.surfaced).toHaveLength(2);
		expect(feed.shortSellersByAssetId[assetIds[2]].status).toBe('none_disclosed');
		expect(feed.cardsByView.surfaced.some((c) => c.isin === isins[2])).toBe(false);
		const card = feed.cardsByView.surfaced.find((c) => c.isin === isins[0])!;
		expect(card.shortSellers).toEqual(feed.shortSellersByAssetId[assetIds[0]]);
		expect(card.shortSellers.totalDisclosedPct).toBe(0.7);
		const report = (await enrichedSignalReport(handle.db, 'surfaced', RUN_DATE, 10))!;
		expect(report.top.find((r) => r.isin === card.isin)?.shortSellers).toEqual(card.shortSellers);
		expect((await issuerDetail(handle.db, card.assetId, RUN_DATE))?.shortSellers).toEqual(card.shortSellers);
		expect(feed.cardsByView.surfaced[0].isin).toBe(isins[1]);
		// Explicit regeneration replaces evidence atomically.
		await runSignals(handle.db, RUN_DATE);
		expect((await loadFeed(handle.db))?.shortSellersByAssetId[assetIds[0]].status).toBe('none_disclosed');
	});

	it('returns watchlist analysis even when the discovery feed is empty', async () => {
		await snapshot('2026-09-04T06:00:00Z');
		await runSignals(handle.db, '2026-09-04');
		const feed = (await loadFeed(handle.db))!;
		expect(feed.cardsByView.surfaced).toEqual([]);
		expect(Object.keys(feed.shortSellersByAssetId)).toHaveLength(3);
	});

	it('handles no coverage and pre-feature signal rows without inventing absence', async () => {
		await runSignals(handle.db, RUN_DATE);
		let feed = (await loadFeed(handle.db))!;
		expect(feed.shortSellersByAssetId[assetIds[0]].status).toBe('unknown');
		await handle.db.execute(sql`delete from signal where screen_id = (select id from screen where slug = 'no_disclosed_shorts')`);
		feed = (await loadFeed(handle.db))!;
		expect(Object.keys(feed.shortSellersByAssetId)).toHaveLength(3);
		expect(feed.cardsByView.surfaced[0].shortSellers.status).toBe('unknown');
	});
});
