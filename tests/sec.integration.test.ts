import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import { fundamental, insiderTransaction, issuer, instrument, listing, indexMembership, newsItem, sourceFiling, ingestionRun } from '../src/lib/server/db/schema.js';
import { recordCompanyFactsComparison, persistFiling, rememberFiling } from '../src/lib/server/sources/sec/store.js';
import { buildContext } from '../src/lib/server/signals/context.js';
import { issuerDetail } from '../src/lib/server/issuer/detail.js';
import { runJob } from '../src/lib/server/pipeline/runner.js';
import { selectedEntities, filingScope, parseSelection, secJobName } from '../src/lib/server/sources/sec/selection.js';
import type { JobContext } from '../src/lib/server/pipeline/types.js';

const url = process.env.TEST_DATABASE_URL;
const sample = readFileSync('tests/fixtures/sec/msft-form4.txt','utf8');
describe.skipIf(!url)('SEC persistence and product isolation', () => {
	let assetId: string;
	let handle: DbHandle, ctx: JobContext, entity: typeof issuer.$inferSelect;
	beforeAll(async () => {
		handle = createDb(url!);
		await handle.db.execute(sql`drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`);
		await migrateDb(handle.db);
		ctx = { db: handle.db, runDate:'2026-09-06',log:()=>{} };
		[entity] = await handle.db.insert(issuer).values({name:'Microsoft Test',cik:'0000789019'}).returning();
		const [inst] = await handle.db.insert(instrument).values({issuerId:entity.id,isin:'DE0000000099',firstSeen:'2026-01-01',lastSeen:ctx.runDate}).returning();
		assetId = inst.assetId;
		await handle.db.insert(listing).values({ instrumentId: inst.id, source: 'boerse_frankfurt', currency: 'EUR', mic: 'XETR', validFrom: '2026-01-01' });
		await handle.db.insert(indexMembership).values({instrumentId:inst.id,indexName:'DAX',validFrom:'2026-01-01'});
		await handle.db.insert(fundamental).values({issuerId:entity.id,metric:'eps_basic',value:'5',currency:'EUR',source:'boerse_frankfurt',periodEnd:'2026-09-01',publishedDate:'2026-09-01'});
	});
	afterAll(async () => { await handle?.sql.end(); });
	it('supports issuers without instruments and nullable CIKs for existing issuers', async () => {
		await handle.db.insert(issuer).values([{name:'US without security',cik:'0000320193'},{name:'Existing A'},{name:'Existing B'}]);
		const rows = await handle.db.select().from(instrument); expect(rows).toHaveLength(1);
	});
	it('retains immutable provider observations and selects the latest revision', async () => {
		await handle.db.insert(fundamental).values({issuerId:entity.id,metric:'eps_basic',value:'6',currency:'EUR',source:'boerse_frankfurt',periodEnd:'2026-09-01',publishedDate:'2026-09-01',sourceRecordId:'revision2'}).onConflictDoNothing();
		expect(await handle.db.select().from(fundamental)).toHaveLength(2);
		expect((await buildContext(handle.db,ctx.runDate)).instruments[0].epsBasic).toBe(6);
	});
	it('deduplicates filing discovery and economic transactions on replay', async () => {
		const record = {accession:'0000789019-26-000141',cik:entity.cik!,form:'4',filedDate:'2026-08-05',url:'https://www.sec.gov/Archives/edgar/data/789019/0000789019-26-000141.txt'};
		await rememberFiling(ctx,record,entity.id); await rememberFiling(ctx,record,entity.id);
		const [filing] = await handle.db.select().from(sourceFiling);
		const evidence = {hash:'original',path:'/fixture',url:record.url,observedAt:'2026-09-06T10:00:00Z'};
		await persistFiling(ctx,filing,sample,evidence); await persistFiling(ctx,filing,sample,evidence);
		expect(await handle.db.select().from(sourceFiling)).toHaveLength(1);
		expect(await handle.db.select().from(insiderTransaction)).toHaveLength(1);
		expect(await handle.db.select().from(newsItem)).toHaveLength(0);
		const context = await buildContext(handle.db,'2026-08-10'); expect(context.instruments[0].insiderTx).toHaveLength(0);
		const detail = await issuerDetail(handle.db,assetId,ctx.runDate); expect(detail?.insiderHistory.every((t) => !t.countedInSignal)).toBe(true); expect(detail?.news).toHaveLength(0);
	});
	it('keeps company facts as comparison evidence without leaking unvalidated SEC values', async () => {
		const acc = '0000789019-26-000150';
		await rememberFiling(ctx,{accession:acc,cik:entity.cik!,form:'10-K',filedDate:'2026-08-06',acceptedAt:'2026-08-06T22:00:00Z',url:'https://www.sec.gov/fixture'},entity.id);
		const [filing] = await handle.db.select().from(sourceFiling).where(eq(sourceFiling.externalId,acc));
		await handle.db.update(sourceFiling).set({status:'processed'}).where(eq(sourceFiling.id,filing.id));
		const data = {cik:789019,facts:{'us-gaap':{EarningsPerShareBasic:{units:{'USD/shares':[
			{val:999,start:'2025-07-01',end:'2026-06-30',accn:acc,form:'10-K',filed:'2026-08-06'},
			{val:250,start:'2026-04-01',end:'2026-06-30',accn:acc,form:'10-K',filed:'2026-08-06'}
		]}}}}};
		const evidence = {hash:'facts1',path:'/facts',url:'https://data.sec.gov/fixture',observedAt:'2026-09-06T10:00:00Z'};
		await recordCompanyFactsComparison(ctx,entity,data,evidence,'2022-01-01'); await recordCompanyFactsComparison(ctx,entity,data,evidence,'2022-01-01');
		expect(await handle.db.select().from(fundamental).where(eq(fundamental.source,'sec'))).toHaveLength(0);
		await recordCompanyFactsComparison(ctx,entity,data,{...evidence,hash:'facts2'},'2022-01-01');
		expect(await handle.db.select().from(fundamental).where(eq(fundamental.source,'sec'))).toHaveLength(0);
		expect((await buildContext(handle.db,ctx.runDate)).instruments[0].epsBasic).toBe(6);
		expect((await issuerDetail(handle.db,assetId,ctx.runDate))?.epsBasicHistory).toHaveLength(1);
	});
	it('retains partial amendments independently and rolls back malformed filings', async () => {
		const acc = '0000789019-26-000151';
		await rememberFiling(ctx,{accession:acc,cik:entity.cik!,form:'4/A',filedDate:'2026-08-06',url:'https://www.sec.gov/amendment'},entity.id);
		const [filing] = await handle.db.select().from(sourceFiling).where(eq(sourceFiling.externalId,acc));
		const evidence = {hash:'amendment',path:'/amendment',url:filing.url,observedAt:'2026-09-06T10:00:00Z'};
		await expect(persistFiling(ctx,filing,'<html>blocked</html>',evidence)).rejects.toThrow();
		expect((await handle.db.select().from(sourceFiling).where(eq(sourceFiling.id,filing.id)))[0].status).toBe('pending');
		const amended = sample.replaceAll('0000789019-26-000141',acc).replace('<documentType>4','<documentType>4/A').replace('<periodOfReport>','<dateOfOriginalSubmission>2026-08-05</dateOfOriginalSubmission><periodOfReport>');
		await persistFiling(ctx,filing,amended,evidence);
		const txs = await handle.db.select().from(insiderTransaction); expect(txs).toHaveLength(2); expect(txs.find((t)=>t.filingId===filing.id)?.amendmentStatus).toBe('unresolved');
	});
	it('requeues unmatched filings when issuer identity becomes available', async () => {
		const record = {accession:'0000789019-26-000160',cik:entity.cik!,form:'4',filedDate:'2026-08-06',url:'https://www.sec.gov/unmatched'};
		await rememberFiling(ctx,record,null);
		await handle.db.update(sourceFiling).set({status:'unmatched'}).where(eq(sourceFiling.externalId,record.accession));
		await rememberFiling(ctx,{...record,items:'2.02'},entity.id);
		const [row] = await handle.db.select().from(sourceFiling).where(eq(sourceFiling.externalId,record.accession));
		expect(row.status).toBe('pending'); expect(row.issuerId).toBe(entity.id); expect(row.metadata.items).toBe('2.02');
		await handle.db.update(sourceFiling).set({ status: 'unavailable', metadata: { ...row.metadata, unavailableVerification: { version: 1 } } }).where(eq(sourceFiling.id, row.id));
		await rememberFiling(ctx, record, entity.id);
		const [rediscovered] = await handle.db.select().from(sourceFiling).where(eq(sourceFiling.id, row.id));
		expect(rediscovered.status).toBe('pending');
		expect(rediscovered.metadata.unavailableVerification).toEqual({ version: 1 });
	});
	it('keeps partial SEC job stats and durable work while reporting failure', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await runJob(handle.db, {name:'sec_test',source:'sec',async run(context) {
			await rememberFiling(context,{accession:'0000789019-26-000161',cik:entity.cik!,form:'4',filedDate:'2026-08-06',url:'https://www.sec.gov/pending'},entity.id);
			return { failed:1,completed_through:'2026-08-06' };
		}},ctx.runDate);
		expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('[sec_test] INCOMPLETE:'));
		expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('\"failed\":1'));
		errorLog.mockRestore();
		expect(result.ok).toBe(false); expect(result.stats?.completed_through).toBe('2026-08-06');
		expect(await handle.db.select().from(sourceFiling).where(eq(sourceFiling.externalId,'0000789019-26-000161'))).toHaveLength(1);
	});

	it('reuses only successful matching index snapshots and restricts an existing broad queue', async () => {
		const scoped: JobContext = { ...ctx, issuerSelection: parseSelection() };
		await expect(selectedEntities(scoped)).rejects.toThrow('No index universe snapshot');
		const [outside] = await handle.db.insert(issuer).values({ name: 'Outside selected indices', cik: '0000009876' }).returning();
		const selectedRecord = { accession: '0000789019-26-000170', cik: entity.cik!, form: '4', filedDate: ctx.runDate, url: 'https://www.sec.gov/selected' };
		await rememberFiling(ctx, selectedRecord, entity.id);
		await rememberFiling(ctx, { ...selectedRecord, accession: '0000009876-26-000170', cik: outside.cik! }, outside.id);
		await rememberFiling(ctx, { ...selectedRecord, accession: '0000009876-26-000171' }, null);
		await handle.db.insert(ingestionRun).values([
			{ source: 'sec', job: secJobName('sec_universe', scoped), status: 'success', finishedAt: new Date('2026-09-06T10:00:00Z'), stats: { selection_ciks: JSON.stringify([entity.cik]) } },
			{ source: 'sec', job: secJobName('sec_universe', scoped), status: 'error', finishedAt: new Date('2026-09-06T11:00:00Z'), stats: { selection_ciks: JSON.stringify([outside.cik]) } },
			{ source: 'sec', job: 'sec_universe:indices:sp500', status: 'success', finishedAt: new Date('2026-09-06T12:00:00Z'), stats: { selection_ciks: JSON.stringify([outside.cik]) } }
		]);
		const selected = await selectedEntities(scoped);
		expect(selected.map((e) => e.id)).toEqual([entity.id]);
		const queue = await handle.db.select().from(sourceFiling).where(and(eq(sourceFiling.status, 'pending'), filingScope(scoped, selected.map((e) => e.id))));
		expect(queue.some((f) => f.externalId === selectedRecord.accession)).toBe(true);
		expect(queue.every((f) => f.issuerId === entity.id)).toBe(true);
		expect(await handle.db.select().from(sourceFiling).where(filingScope(scoped, []))).toHaveLength(0);
		// A new universe observation does not change the in-progress run's frozen CIK union.
		await handle.db.insert(ingestionRun).values({ source: 'sec', job: secJobName('sec_universe', scoped), status: 'success', finishedAt: new Date('2026-09-06T13:00:00Z'), stats: { selection_ciks: JSON.stringify([outside.cik]) } });
		expect((await selectedEntities(scoped)).map((e) => e.id)).toEqual([entity.id]);
		expect((await selectedEntities({ ...ctx, issuerSelection: parseSelection() })).map((e) => e.id)).toEqual([outside.id]);
	});

});
