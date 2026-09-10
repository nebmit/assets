import { canonicalJson } from '../src/lib/server/sources/sec/xbrl/canonical.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import { fundamental, instrument, issuer, listing, secExtraction, secProcessing, sourceFiling } from '../src/lib/server/db/schema.js';
import { processFinancialFiling, configHash } from '../src/lib/server/sources/sec/xbrl/process.js';
import { hash } from '../src/lib/server/sources/sec/client.js';
import { PARSER_VERSION, RESOLVER_VERSION, type FilingPackage } from '../src/lib/server/sources/sec/xbrl/types.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('SEC immutable extraction and restart', () => {
	let h: DbHandle, root: string;
	let filing: typeof sourceFiling.$inferSelect;
	beforeAll(async () => {
		h = createDb(url!);
		await h.db.execute(sql`drop schema public cascade; create schema public; drop schema if exists drizzle cascade`);
		await migrateDb(h.db);
		root = await mkdtemp(path.join(tmpdir(), 'sec-processing-test-'));
		const [entity] = await h.db.insert(issuer).values({ name: 'DKS fixture', cik: '0001089063' }).returning();
		const [asset] = await h.db.insert(instrument).values({ issuerId: entity.id, securityClass: 'Common Stock', firstSeen: '2026-09-01', lastSeen: '2026-09-09' }).returning();
		await h.db.insert(listing).values({ instrumentId: asset.id, source: 'alpaca', symbol: 'DKS', currency: 'USD', mic: 'XNYS', validFrom: '2026-09-01' });
		const content = await readFile('tests/fixtures/sec/xbrl/dks-cover-artifact.json', 'utf8');
		const file = path.join(root, 'artifact'); await writeFile(file, content);
		const source = { hash: hash(content), path: file, url: 'https://www.sec.gov/fixture', observedAt: '2026-09-07T09:31:48.408Z' };
		[filing] = await h.db.insert(sourceFiling).values({ issuerId: entity.id, source: 'sec', externalId: '0001089063-26-000036', form: '10-Q', status: 'processed', filedDate: '2026-09-03', reportDate: '2026-08-01', url: source.url, metadata: { currentHash: source.hash, documents: [source] } }).returning();
		const manifest: FilingPackage = { schemaVersion: 1, accession: filing.externalId, acceptedAt: null, submissionHash: source.hash, entrypoints: [source.url], documents: [source] };
		const [extraction] = await h.db.insert(secExtraction).values({ filingId: filing.id, packageHash: hash(canonicalJson(manifest)), parserVersion: PARSER_VERSION, configHash, manifest, artifact: source, diagnostics: [], observedAt: new Date(source.observedAt) }).returning();
		await h.db.insert(secProcessing).values({ filingId: filing.id, inputHash: source.hash, configHash, parserVersion: PARSER_VERSION, resolverVersion: RESOLVER_VERSION, stage: 'normalize', status: 'running', manifest, extractionId: extraction.id });
	});
	afterAll(async () => { await h?.sql.end(); if (root) await rm(root, { recursive: true, force: true }); });
	it('resumes normalization offline and retains unresolved class facts', async () => {
		const result = await processFinancialFiling({ db: h.db, runDate: '2026-09-09', log: () => {} }, filing, true);
		expect(result.ok, JSON.stringify(result.issues)).toBe(true);
		const rows = await h.db.select().from(fundamental).where(eq(fundamental.metric, 'shares_outstanding'));
		expect(rows.map((r) => r.value).sort()).toEqual(['23570633', '65355923']);
		expect(rows.every((r) => r.instrumentId === null && r.qualificationReason === 'listed_class_unresolved' && r.metadata?.extractionId)).toBe(true);
		expect(rows.every((r) => r.observedAt! >= new Date('2026-09-07T09:31:48.408Z'))).toBe(true);
	});
	it('does not duplicate observations or rewrite their observation times on replay', async () => {
		const before = await h.db.select().from(fundamental);
		await processFinancialFiling({ db: h.db, runDate: '2026-09-09', log: () => {} }, filing, true);
		expect(await h.db.select().from(fundamental)).toEqual(before);
		expect(await h.db.select().from(secExtraction)).toHaveLength(1);
	});
	it('records deterministic failure without repeatedly parsing the same missing package', async () => {
		const changed = { ...filing, metadata: { ...filing.metadata, currentHash: 'changed', documents: [{ hash: 'changed', path: path.join(root, 'missing'), url: 'https://www.sec.gov/missing', observedAt: new Date().toISOString() }] } };
		const ctx = { db: h.db, runDate: '2026-09-09', log: () => {} };
		expect((await processFinancialFiling(ctx, changed, true)).ok).toBe(false);
		const attempts = await h.db.select().from(secProcessing).where(eq(secProcessing.inputHash, 'changed'));
		expect((await processFinancialFiling(ctx, changed, true)).ok).toBe(false);
		expect((await h.db.select().from(secProcessing).where(eq(secProcessing.inputHash, 'changed')))[0].attempts).toBe(attempts[0].attempts);
	});
});
