import * as bfClient from '../src/lib/server/sources/boerseFrankfurt/client.js';
import { pricesJob } from '../src/lib/server/sources/boerseFrankfurt/prices.js';
import * as snapshotsModule from '../src/lib/server/assets/snapshot.js';
import { adjustedPriceHistory } from '../src/lib/server/assets/prices.js';
import * as alpacaClient from '../src/lib/server/sources/alpaca/client.js';
import { alpacaActionsJob } from '../src/lib/server/sources/alpaca/jobs.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/server/db/schema.js';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { applyListingRename } from '../src/lib/server/sources/alpaca/rename.js';
import { parseActions } from '../src/lib/server/sources/alpaca/parse.js';
import { storePrices } from '../src/lib/server/assets/observations.js';
import { eq, sql } from 'drizzle-orm';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import { issuer, instrument, listing, indexMembership, eodPrice, insiderTransaction, fxRate, corporateAction, providerIdentifier } from '../src/lib/server/db/schema.js';
import { publishSecMemberships } from '../src/lib/server/sources/sec/universe.js';
import { resolveSnapshots } from '../src/lib/server/assets/snapshot.js';
import { bfMembers } from '../src/lib/server/assets/listings.js';
import { runSignals } from '../src/lib/server/signals/engine.js';
import { loadFeed } from '../src/lib/server/feed/queries.js';
import { enrichedSignalReport } from '../src/lib/server/mcp/report.js';
import { issuerDetail } from '../src/lib/server/issuer/detail.js';
import type { IndexSnapshot } from '../src/lib/server/sources/sec/indices.js';
const url = process.env.TEST_DATABASE_URL;
const date = '2026-07-01';
const cutoff = new Date('2026-07-01T12:00:00Z');
const tickers = ['TEST.A', 'TEST.B'].map((ticker) => ({ ticker, cik: '0000000001', name: 'Test US', exchange: 'NYSE' }));
const snapshot = (index: string, symbols = ['TEST.A', 'TEST.B']): IndexSnapshot => ({ index, fund: 'fixture', basis: 'etf_holdings_proxy', asOf: '2026-06-30', holdings: symbols.map((ticker) => ({ ticker, name: 'Fixture' })), evidence: { hash: 'fixture', url: 'https://example.com/holdings', path: '/fixture', observedAt: cutoff.toISOString() } });
describe.skipIf(!url)('combined asset identity and immutable product projections', () => {
	let handle: DbHandle;
	beforeAll(async () => {
		handle = createDb(url!); await handle.db.execute(sql`drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`); await migrateDb(handle.db);
		await handle.db.insert(issuer).values({ name: 'Test US', cik: '0000000001', secMetadata: { status: 'included', listings: ['A', 'B'].map((c) => ({ symbol: `TEST.${c}`, name: `Class ${c} Common Stock`, exchange: 'N', excludedReason: null })) } });
	});
	afterAll(async () => { await handle?.sql.end(); });
	it('retains both classes, uses the largest overlapping size band and never sends US shares to BF', async () => {
		await publishSecMemberships({ db: handle.db, runDate: date, log: () => {} }, [snapshot('sp400'), snapshot('sp500', ['TEST.A'])], tickers);
		const assets = await handle.db.select().from(instrument); expect(assets).toHaveLength(2); expect(assets.every((a) => a.isin === null)).toBe(true);
		expect(new Set(assets.map((a) => a.assetId)).size).toBe(2); expect(await bfMembers(handle.db)).toEqual([]);
		const selected = await resolveSnapshots(handle.db, date, cutoff);
		expect(selected.map((a) => [a.ticker, a.sizeBand])).toEqual([['TEST.A', 'large'], ['TEST.B', 'mid']]);
		expect(selected.every((a) => a.shortSellers.status === 'unavailable')).toBe(true);
		expect(await resolveSnapshots(handle.db, '2026-06-30', new Date('2026-06-30T23:00:00Z'))).toEqual([]);
	});
	it('enforces dates and observation cutoffs together for prices, facts and news', async () => {
		const [quote] = await handle.db.select().from(listing);
		const [asset] = await handle.db.select().from(instrument).where(eq(instrument.id, quote.instrumentId));
		await handle.db.insert(eodPrice).values({ listingId: quote.id, tradeDate: '2026-07-02', close: '999', currency: 'USD', source: 'alpaca', feed: 'sip', sourceRecordId: 'future-close', observedAt: cutoff });
		await handle.db.insert(schema.fundamental).values({ issuerId: asset.issuerId, instrumentId: asset.id, metric: 'market_cap', value: '999999', currency: 'USD', periodEnd: '2026-06-30', publishedDate: '2026-06-30', publishedAt: new Date('2026-06-30'), observedAt: new Date('2026-07-02'), source: 'boerse_frankfurt' });
		await handle.db.insert(schema.newsItem).values({ issuerId: asset.issuerId, source: 'sec', externalId: 'future-news', headline: 'Not published at cutoff', publishedAt: new Date('2026-07-02'), publishedDate: '2026-07-02', observedAt: cutoff, naturalKeyHash: 'future-news' });
		const resolved = (await resolveSnapshots(handle.db, date, cutoff)).find((r) => r.instrumentId === asset.id)!;
		expect(resolved.close).toBeNull();
		expect(resolved.marketCap).toBeNull();
		expect(resolved.news).toEqual([]);
		await handle.db.delete(eodPrice).where(eq(eodPrice.sourceRecordId, 'future-close'));
		await handle.db.delete(schema.fundamental).where(eq(schema.fundamental.instrumentId, asset.id));
		await handle.db.delete(schema.newsItem).where(eq(schema.newsItem.externalId, 'future-news'));
	});
	it('keeps known memberships during ambiguous mapping and records validated removals', async () => {
		const ctx = { db: handle.db, runDate: '2026-07-02', log: () => {} };
		await publishSecMemberships(ctx, [snapshot('sp400', ['TEST.A', 'UNRESOLVED'])], tickers);
		expect((await handle.db.select().from(indexMembership)).filter((m) => m.indexName === 'sp400' && m.validTo === null)).toHaveLength(2);
		await publishSecMemberships(ctx, [snapshot('sp400', ['TEST.A'])], tickers);
		expect((await handle.db.select().from(indexMembership)).find((m) => m.validTo !== null)?.validTo).toBe('2026-07-02');
	});
	it('retains price corrections and reversions without duplicating identical observations', async () => {
		const [quote] = await handle.db.select().from(listing);
		const row = { listingId: quote.id, tradeDate: '2026-06-29', close: '100', currency: 'USD', source: 'alpaca', feed: 'sip', sourceRecordId: 'test', observedAt: cutoff };
		expect(await storePrices(handle.db, [row])).toBe(1);
		expect(await storePrices(handle.db, [{ ...row, observedAt: new Date('2026-07-02') }])).toBe(0);
		expect(await storePrices(handle.db, [{ ...row, close: '101', observedAt: new Date('2026-07-02') }])).toBe(1);
		expect(await storePrices(handle.db, [{ ...row, observedAt: new Date('2026-07-03') }])).toBe(1);
		expect((await handle.db.select().from(eodPrice).where(eq(eodPrice.tradeDate, row.tradeDate))).map((p) => p.close)).toEqual(['100', '101', '100']);
	});
	it('freezes currency, qualification, prices and identity across feed, detail and MCP', async () => {
		const asset = (await handle.db.select().from(instrument)).find((a) => a.securityClass?.includes('Class A'))!; const [quote] = await handle.db.select().from(listing).where(eq(listing.instrumentId, asset.id));
		await handle.db.insert(eodPrice).values({ listingId: quote.id, tradeDate: '2026-06-30', close: '100', currency: 'USD', source: 'alpaca', feed: 'sip', sourceRecordId: 'close1', observedAt: cutoff });
		await handle.db.insert(fxRate).values({ date: '2026-06-30', currency: 'USD', unitsPerEur: '1.2', observedAt: cutoff, evidence: {} });
		await handle.db.insert(insiderTransaction).values({ issuerId: asset.issuerId, instrumentId: asset.id, issuerNameRaw: 'Test US', source: 'sec', side: 'buy', price: '100', volume: '10000', transactionDate: '2026-06-30', publishedDate: date, observedAt: cutoff, naturalKeyHash: 'buy', raw: { derivative: false, securityTitle: 'Class A Common Stock', transactionCode: 'P', owners: [{ cik: 'owner1', name: 'Executive', officer: true, director: false, tenPercentOwner: false }] } });
		await runSignals(handle.db, date);
		const before = (await loadFeed(handle.db))!.cardsByView.surfaced[0];
		expect(before.currency).toBe('USD'); expect(before.shortSellers.status).toBe('unavailable'); expect(before.reasons.some((r) => r.signal === 'no_disclosed_shorts')).toBe(false);
		await handle.db.update(issuer).set({ name: 'Changed later' }).where(eq(issuer.id, asset.issuerId));
		await handle.db.insert(eodPrice).values({ listingId: quote.id, tradeDate: '2026-06-30', close: '999', currency: 'USD', source: 'alpaca', feed: 'sip', sourceRecordId: 'correction', observedAt: new Date('2026-07-02') });
		const feed = (await loadFeed(handle.db))!.cardsByView.surfaced[0]; const detail = await issuerDetail(handle.db, asset.assetId, date); const report = (await enrichedSignalReport(handle.db, 'surfaced', date, 10))!.top[0];
		expect(feed).toEqual(before); expect(report.name).toBe(before.name); expect(report.fundamentals?.price).toBe(before.price); expect(detail?.name).toBe(before.name); expect(report.insiders[0].currencyStatus).toBe(feed.insiders[0].currencyStatus);
	});
	it('requires rename evidence and preserves identity across symbol changes and later ticker reuse', async () => {
		const [entity] = await handle.db.insert(issuer).values({ name: 'Rename fixture', cik: '0000000002', secMetadata: { status: 'included', listings: [{ symbol: 'OLD', name: 'Common Stock', exchange: 'N', excludedReason: null }] } }).returning();
		const holdings = (symbol: string, day: string) => ({ ...snapshot('sp500', [symbol]), evidence: { ...snapshot('sp500').evidence, observedAt: `${day}T12:00:00.000Z` } });
		const directory = (ticker: string, cik = entity.cik!) => [{ ticker, cik, name: 'Fixture', exchange: 'NYSE' }];
		await publishSecMemberships({ db: handle.db, runDate: date, log: () => {} }, [holdings('OLD', date)], directory('OLD'));
		const [original] = await handle.db.select().from(instrument).where(eq(instrument.issuerId, entity.id));
		await handle.db.update(issuer).set({ secMetadata: { status: 'included', listings: [{ symbol: 'NEW', name: 'Common Stock', exchange: 'N', excludedReason: null }] } }).where(eq(issuer.id, entity.id));
		const ctx = { db: handle.db, runDate: '2026-07-02', log: () => {} };
		expect((await publishSecMemberships(ctx, [holdings('NEW', ctx.runDate)], directory('NEW')))[0].unresolved).toHaveLength(1);
		await handle.db.insert(corporateAction).values({ instrumentId: original.id, source: 'alpaca', externalId: 'rename', type: 'name_changes', exDate: ctx.runDate, observedAt: new Date('2026-07-02T10:00:00Z'), sourceRecordId: 'rename', evidence: {}, qualification: 'qualified', metadata: { old_symbol: 'OLD', new_symbol: 'NEW' } });
		await publishSecMemberships(ctx, [holdings('NEW', ctx.runDate)], directory('NEW'));
		expect(await handle.db.select().from(instrument).where(eq(instrument.issuerId, entity.id))).toHaveLength(1);
		const history = await handle.db.select().from(listing).where(eq(listing.instrumentId, original.id));
		expect(history.find((q) => q.symbol === 'OLD')?.validTo).toBe(ctx.runDate);
		expect(history.find((q) => q.symbol === 'NEW')?.priceHistoryCoveredFrom).toBeNull();
		expect((await handle.db.select().from(providerIdentifier).where(eq(providerIdentifier.instrumentId, original.id))).find((p) => p.externalId.endsWith(':OLD'))?.validTo).toBe(ctx.runDate);
		const [replacement] = await handle.db.insert(issuer).values({ name: 'Different issuer', cik: '0000000003', secMetadata: { status: 'included', listings: [{ symbol: 'NEW', name: 'Common Stock', exchange: 'N', excludedReason: null }] } }).returning();
		await publishSecMemberships({ ...ctx, runDate: '2026-07-03' }, [holdings('NEW', '2026-07-03')], directory('NEW', replacement.cik!));
		const [reused] = await handle.db.select().from(instrument).where(eq(instrument.issuerId, replacement.id));
		expect(reused.assetId).not.toBe(original.assetId);
	});

	it('does not apply the historical CR-to-CXT rename to a reused current ticker', async () => {
		const [entity] = await handle.db.insert(issuer).values({ name: 'Rename collision fixture' }).returning();
		const assets = await handle.db.insert(instrument).values([1, 2].map(() => ({ issuerId: entity.id, firstSeen: date, lastSeen: date }))).returning();
		const quotes = await handle.db.insert(listing).values(['CR', 'CXT'].map((symbol, i) => ({ instrumentId: assets[i].id, mic: 'XNYS', symbol, source: 'alpaca', currency: 'USD', validFrom: date }))).returning();
		const action = parseActions({ corporate_actions: { name_changes: [{ id: 'b264a2c4-b1c6-4b0d-818f-de27c7cac2b2', old_symbol: 'CR', new_symbol: 'CXT', old_cusip: '224441105', new_cusip: '224441105', process_date: '2023-04-04' }] }, next_page_token: null }).actions[0];
		expect(await applyListingRename(handle.db, quotes[0], '0000000004', action, date, {})).toBe('not_applicable');
		// Even an in-period event cannot take over an occupied symbol.
		expect(await applyListingRename(handle.db, quotes[0], '0000000004', { ...action, exDate: date }, date, {})).toBe('conflicting_listing');
		expect(await handle.db.select().from(listing).where(eq(listing.id, quotes[0].id))).toEqual([quotes[0]]);
		const valid = { ...action, exDate: date, metadata: { ...action.metadata, new_symbol: 'RENAMED' } };
		expect(await applyListingRename(handle.db, quotes[0], '0000000004', valid, date, {})).toBe('applied');
		// Replaying a stale in-memory target after a completed transaction is harmless.
		expect(await applyListingRename(handle.db, quotes[0], '0000000004', valid, date, {})).toBe('not_applicable');
		const history = await handle.db.select().from(listing).where(eq(listing.instrumentId, assets[0].id));
		expect(history).toHaveLength(2);
		expect(history.find((q) => q.symbol === 'RENAMED')).toMatchObject({ validFrom: date, validTo: null, priceHistoryCoveredFrom: null });
	});

	it('bounds raw evidence queries by issuer and publishes every batch in one run', async () => {
		const entities = await handle.db.insert(issuer).values(Array.from({ length: 23 }, (_, i) => ({ name: `Batch fixture ${i}` }))).returning();
		const assets = await handle.db.insert(instrument).values(entities.map((e) => ({ issuerId: e.id, firstSeen: date, lastSeen: date }))).returning();
		await handle.db.insert(listing).values(assets.map((a, i) => ({ instrumentId: a.id, mic: 'XNYS', symbol: `BATCH${i}`, source: 'alpaca', currency: 'USD', validFrom: date })));
		await handle.db.insert(indexMembership).values(assets.map((a) => ({ instrumentId: a.id, indexName: 'sp500' as const, validFrom: date, observedAt: cutoff })));
		const queries: string[] = [];
		const boundedDb = drizzle(handle.sql, { schema, logger: { logQuery: (query) => { queries.push(query); } } });
		const resolved = await resolveSnapshots(boundedDb, date, cutoff);
		expect(assets.every((a) => resolved.some((r) => r.instrumentId === a.id && r.close === null))).toBe(true);
		for (const table of ['eod_price', 'fundamental', 'insider_transaction', 'source_filing', 'corporate_action', 'news_item']) {
			const reads = queries.filter((q) => q.includes(`from "${table}"`));
			expect(reads.length).toBeGreaterThanOrEqual(3);
			expect(reads.every((q) => q.includes(' in (') && q.includes('issuer_id'))).toBe(true);
		}
		await runSignals(boundedDb, date);
		const saved = await handle.db.select().from(schema.assetSnapshot).innerJoin(schema.signalRun, eq(schema.signalRun.id, schema.assetSnapshot.runId)).where(eq(schema.signalRun.runDate, date));
		expect(assets.every((a) => saved.some((s) => s.asset_snapshot.instrumentId === a.id))).toBe(true);
		expect(queries.filter((q) => q.startsWith('insert into "asset_snapshot"')).length).toBeGreaterThanOrEqual(3);
	});

	it('does not append identical action revisions after a JSONB round trip', async () => {
		let observation = 0;
		const request = vi.spyOn(alpacaClient, 'alpacaRequest').mockImplementation(async (_path, params) => ({
			data: { corporate_actions: { cash_dividends: params.symbols.split(',').map((symbol) => ({ symbol, id: `round-trip-${symbol}`, ex_date: date, rate: 1, foreign: false })) }, next_page_token: null },
			evidence: { hash: 'fixture', path: '/fixture', url: 'https://example.com/actions', observedAt: `2026-07-01T12:00:0${observation++}.000Z` }
		}));
		try {
			const ctx = { db: handle.db, runDate: date, log: () => {} };
			expect(Number((await alpacaActionsJob.run(ctx)).inserted)).toBeGreaterThan(0);
			expect((await alpacaActionsJob.run(ctx)).inserted).toBe(0);
		} finally { request.mockRestore(); }
	});

	it('keeps feed evidence on one run during concurrent same-date replacement', async () => {
		const [entity] = await handle.db.select().from(issuer).where(eq(issuer.cik, '0000000001'));
		const original = snapshotsModule.savedSnapshots;
		let replaced = false;
		const intercept = vi.spyOn(snapshotsModule, 'savedSnapshots').mockImplementation(async (db, day, assetId) => {
			if (!replaced) {
				replaced = true;
				await handle.db.update(issuer).set({ name: 'Replacement name' }).where(eq(issuer.id, entity.id));
				await runSignals(handle.db, date);
			}
			return original(db, day, assetId);
		});
		try {
			const feed = await loadFeed(handle.db);
			expect(feed?.catalog.some((a) => a.name === entity.name)).toBe(true);
			expect(feed?.catalog.some((a) => a.name === 'Replacement name')).toBe(false);
		} finally { intercept.mockRestore(); }
		expect((await loadFeed(handle.db))?.catalog.some((a) => a.name === 'Replacement name')).toBe(true);
	});
	it('reads only the newest eligible frozen price series per asset', async () => {
		const [asset] = await handle.db.select().from(instrument).limit(1);
		for (const [day, close] of [['2026-07-03', 10], ['2026-07-04', 20], ['2026-07-05', 30]] as const) {
			const [run] = await handle.db.insert(schema.signalRun).values({ runDate: day, status: 'success', universeSize: 1 }).returning();
			await handle.db.insert(schema.assetSnapshot).values({ runId: run.id, instrumentId: asset.id, payload: { currency: 'USD', series: [{ date: '2026-07-02', close }] } });
		}
		const history = await adjustedPriceHistory(handle.db, [asset.id], '2026-07-02', '2026-07-04');
		expect(history.get(asset.id)?.series).toEqual([{ date: '2026-07-02', close: 20 }]);
	});

	it('repairs missing raw prices even when adjusted prices are current', async () => {
		const [entity] = await handle.db.insert(issuer).values({ name: 'Raw coverage fixture' }).returning();
		const [asset] = await handle.db.insert(instrument).values({ issuerId: entity.id, isin: 'DE0000000081', firstSeen: date, lastSeen: date }).returning();
		const [quote] = await handle.db.insert(listing).values({ instrumentId: asset.id, mic: 'XETR', symbol: 'RAWTEST', source: 'boerse_frankfurt', currency: 'EUR', validFrom: date, priceHistoryCoveredFrom: '2020-01-01' }).returning();
		await handle.db.insert(indexMembership).values({ instrumentId: asset.id, indexName: 'DAX', validFrom: date });
		await storePrices(handle.db, [
			{ listingId: quote.id, source: 'boerse_frankfurt', feed: 'XETR', adjustment: 'raw', tradeDate: '2026-06-01', currency: 'EUR', close: '100', sourceRecordId: 'raw-fixture' },
			{ listingId: quote.id, source: 'boerse_frankfurt', feed: 'XETR', adjustment: 'split', tradeDate: '2026-06-30', currency: 'EUR', close: '50', sourceRecordId: 'split-fixture' }
		]);
		const request = vi.spyOn(bfClient, 'bfRequest').mockResolvedValue({ data: [], totalCount: 0 } as never);
		try {
			await pricesJob.run({ db: handle.db, runDate: date, log: () => {} });
			expect(request).toHaveBeenCalledWith('/data/price_history', expect.objectContaining({ params: expect.objectContaining({ cleanSplit: false, minDate: '2026-06-02' }) }));
		} finally { request.mockRestore(); }
	});

});
