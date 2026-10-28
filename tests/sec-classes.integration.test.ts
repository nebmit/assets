import { canonicalJson } from '../src/lib/server/sources/sec/xbrl/canonical.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import { fundamental, instrument, issuer, listing, secExtraction, secProcessing, sourceFiling } from '../src/lib/server/db/schema.js';
import { processFinancialFiling, configHash } from '../src/lib/server/sources/sec/xbrl/process.js';
import { archiveEvidence, hash, type Evidence } from '../src/lib/server/sources/sec/client.js';
import { buildPackage } from '../src/lib/server/sources/sec/xbrl/package.js';
import { storedExists } from '../src/lib/server/storage.js';
import { loadRetention, pruneSecArchive, retainedHashes } from '../src/lib/server/sources/sec/retention.js';
import { PARSER_VERSION, RESOLVER_VERSION, type FilingPackage } from '../src/lib/server/sources/sec/xbrl/types.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('SEC immutable extraction and restart', () => {
	let h: DbHandle, root: string, issuerId: number, artifact: Evidence;
	let filing: typeof sourceFiling.$inferSelect;
	beforeAll(async () => {
		// Archive writes resolve against RAW_DATA_DIR; point it at the scratch root before config is read.
		root = await mkdtemp(path.join(tmpdir(), 'sec-processing-test-'));
		process.env.RAW_DATA_DIR = root;
		h = createDb(url!);
		await h.db.execute(sql`drop schema public cascade; create schema public; drop schema if exists drizzle cascade`);
		await migrateDb(h.db);
		const [entity] = await h.db.insert(issuer).values({ name: 'DKS fixture', cik: '0001089063' }).returning();
		const [asset] = await h.db.insert(instrument).values({ issuerId: entity.id, securityClass: 'Common Stock', firstSeen: '2026-09-01', lastSeen: '2026-09-09' }).returning();
		await h.db.insert(listing).values({ instrumentId: asset.id, source: 'alpaca', symbol: 'DKS', currency: 'USD', mic: 'XNYS', validFrom: '2026-09-01' });
		issuerId = entity.id;
		const content = await readFile('tests/fixtures/sec/xbrl/dks-cover-artifact.json', 'utf8');
		artifact = await archiveEvidence('sec:extraction:fixture', content);
		// The fixture schema's only external dependency comes from a pre-seeded taxonomy catalog, so packages build offline.
		const dependency = 'http://www.xbrl.org/2003/xbrl-instance-2003-12-31.xsd';
		const catalog = path.join(root, 'sec', 'taxonomy-catalog');
		await mkdir(catalog, { recursive: true });
		await writeFile(path.join(catalog, hash(dependency)), JSON.stringify(await archiveEvidence(dependency, '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>')));
		const file = path.join(root, 'artifact'); await writeFile(file, content);
		const source = { hash: hash(content), path: file, url: 'https://www.sec.gov/fixture', observedAt: '2026-09-07T09:31:48.408Z' };
		[filing] = await h.db.insert(sourceFiling).values({ issuerId: entity.id, source: 'sec', externalId: '0001089063-26-000036', form: '10-Q', status: 'processed', filedDate: '2026-09-03', reportDate: '2026-08-01', url: source.url, metadata: { currentHash: source.hash, documents: [source] } }).returning();
		const manifest: FilingPackage = { schemaVersion: 1, accession: filing.externalId, acceptedAt: null, submissionHash: source.hash, entrypoints: [source.url], documents: [source] };
		const [extraction] = await h.db.insert(secExtraction).values({ filingId: filing.id, packageHash: hash(canonicalJson(manifest)), parserVersion: PARSER_VERSION, configHash, manifest, artifact: source, diagnostics: [], observedAt: new Date(source.observedAt) }).returning();
		await h.db.insert(secProcessing).values({ filingId: filing.id, inputHash: source.hash, configHash, parserVersion: PARSER_VERSION, resolverVersion: RESOLVER_VERSION, stage: 'normalize', status: 'running', manifest, extractionId: extraction.id });
	});
	afterEach(() => { vi.unstubAllGlobals(); });
	afterAll(async () => { await h?.sql.end(); if (root) await rm(root, { recursive: true, force: true }); });
	it('resumes normalization offline and retains unresolved class facts', async () => {
		const result = await processFinancialFiling({ db: h.db, runDate: '2026-09-09', log: () => {} }, filing);
		expect(result.ok, JSON.stringify(result.issues)).toBe(true);
		const rows = await h.db.select().from(fundamental).where(eq(fundamental.metric, 'shares_outstanding'));
		expect(rows.map((r) => r.value).sort()).toEqual(['23570633', '65355923']);
		expect(rows.every((r) => r.instrumentId === null && r.qualificationReason === 'listed_class_unresolved' && r.metadata?.extractionId)).toBe(true);
		expect(rows.every((r) => r.observedAt! >= new Date('2026-09-07T09:31:48.408Z'))).toBe(true);
	});
	it('does not duplicate observations or rewrite their observation times on replay', async () => {
		const before = await h.db.select().from(fundamental);
		await processFinancialFiling({ db: h.db, runDate: '2026-09-09', log: () => {} }, filing);
		expect(await h.db.select().from(fundamental)).toEqual(before);
		expect(await h.db.select().from(secExtraction)).toHaveLength(1);
	});
	it('records deterministic failure without repeatedly parsing the same missing package', async () => {
		const changed = { ...filing, metadata: { ...filing.metadata, currentHash: 'changed', documents: [{ hash: 'changed', path: path.join(root, 'missing'), url: 'https://www.sec.gov/missing', observedAt: new Date().toISOString() }] } };
		const ctx = { db: h.db, runDate: '2026-09-09', log: () => {} };
		expect((await processFinancialFiling(ctx, changed)).ok).toBe(false);
		const attempts = await h.db.select().from(secProcessing).where(eq(secProcessing.inputHash, 'changed'));
		expect((await processFinancialFiling(ctx, changed)).ok).toBe(false);
		expect((await h.db.select().from(secProcessing).where(eq(secProcessing.inputHash, 'changed')))[0].attempts).toBe(attempts[0].attempts);
	});
	/** A submission whose package already has a recorded extraction, as after a completed run that the SEC archive prune swept. */
	async function extracted(accession: string) {
		const documents = await Promise.all(['report.xhtml', 'test.xsd'].map(async (name) => [name, await readFile(`tests/fixtures/sec/xbrl/${name}`, 'utf8')]));
		const content = `<SEC-DOCUMENT>${accession}.txt\n<SEC-HEADER>\nACCESSION NUMBER: ${accession}\n</SEC-HEADER>\n` +
			documents.map(([name, body]) => `<DOCUMENT>\n<TYPE>EX\n<FILENAME>${name}\n<TEXT>\n<XBRL>\n${body}</XBRL>\n</TEXT>\n</DOCUMENT>\n`).join('');
		const source = await archiveEvidence(`https://www.sec.gov/Archives/edgar/data/1089063/${accession.replaceAll('-', '')}/${accession}.txt`, content);
		const [row] = await h.db.insert(sourceFiling).values({ issuerId, source: 'sec', externalId: accession, form: '10-Q', status: 'processed', filedDate: '2026-09-03', url: source.url, metadata: { currentHash: source.hash, documents: [source] } }).returning();
		const manifest = await buildPackage({ accession, acceptedAt: null, form: row.form, evidence: source });
		await h.db.insert(secExtraction).values({ filingId: row.id, packageHash: hash(canonicalJson(manifest)), parserVersion: PARSER_VERSION, configHash, manifest, artifact, diagnostics: [], observedAt: new Date(source.observedAt) });
		const own = manifest.documents.filter((d) => !d.url.includes('xbrl.org'));
		expect(own).toHaveLength(2);
		for (const document of own) await rm(document.path);
		return { filing: row, source, manifest, content, own };
	}
	const extractions = async (filingId: number) => h.db.select().from(secExtraction).where(eq(secExtraction.filingId, filingId));
	function serve(body: string) {
		const fetch = vi.fn(async () => new Response(body));
		vi.stubGlobal('fetch', fetch);
		return fetch;
	}

	it('rebuilds a pruned in-flight package from the retained submission and reuses its extraction', async () => {
		const { filing: pruned, source, manifest, own } = await extracted('0001089063-26-000040');
		await h.db.insert(secProcessing).values({ filingId: pruned.id, inputHash: source.hash, configHash, parserVersion: PARSER_VERSION, resolverVersion: RESOLVER_VERSION, stage: 'extract', status: 'failed', retryAt: new Date(0), manifest });
		const fetch = serve('');
		const result = await processFinancialFiling({ db: h.db, runDate: '2026-09-09', log: () => {} }, pruned);
		expect(result.ok, JSON.stringify(result.issues)).toBe(true);
		expect(fetch).not.toHaveBeenCalled();
		for (const document of own) expect(await storedExists(document.path)).toBe(true);
		expect(await extractions(pruned.id)).toHaveLength(1);
	});
	it('re-downloads a pruned submission and package without re-extracting', async () => {
		const { filing: pruned, source, content } = await extracted('0001089063-26-000041');
		await rm(source.path);
		const fetch = serve(content);
		const result = await processFinancialFiling({ db: h.db, runDate: '2026-09-09', log: () => {} }, pruned);
		expect(result.ok, JSON.stringify(result.issues)).toBe(true);
		expect(fetch).toHaveBeenCalledOnce();
		expect(await storedExists(source.path)).toBe(true);
		expect(await extractions(pruned.id)).toHaveLength(1);
		const [state] = await h.db.select().from(secProcessing).where(eq(secProcessing.filingId, pruned.id));
		expect(state.status).toBe('complete');
	});
	it('waits for sec_filings when the re-downloaded submission no longer matches', async () => {
		const { filing: pruned, source, content } = await extracted('0001089063-26-000042');
		await rm(source.path);
		serve(content + '<DOCUMENT>\n<TYPE>EX-99\n</DOCUMENT>\n');
		expect((await processFinancialFiling({ db: h.db, runDate: '2026-09-09', log: () => {} }, pruned)).ok).toBe(false);
		const [state] = await h.db.select().from(secProcessing).where(eq(secProcessing.filingId, pruned.id));
		expect(state).toMatchObject({ status: 'failed', reasonCode: 'missing_filing_evidence' });
		expect(state.retryAt).not.toBeNull();
	});
	it('retains the latest submission, its extraction, Company Facts and the taxonomy catalog from database state', async () => {
		const ctx = { db: h.db, runDate: '2026-09-09', log: () => {} };
		expect(await pruneSecArchive(h.db, ctx.runDate, root)).toBeNull();
		await h.db.update(issuer).set({ secMetadata: { status: 'included', factsEvidence: { ...artifact, hash: 'facts' } } }).where(eq(issuer.id, issuerId));
		const input = await loadRetention(h.db, ctx.runDate, root);
		const latest = input.filings.reduce((a, b) => (b.id > a.id ? b : a));
		const kept = retainedHashes(input, ctx.runDate);
		expect(kept).toContain(latest.metadata.currentHash);
		expect(kept).toContain(artifact.hash);
		expect(kept).toContain('facts');
		expect(input.catalog).toHaveLength(1);
		expect(kept).toContain(input.catalog[0].hash);
		expect(kept).not.toContain(input.filings.find((f) => f.externalId === '0001089063-26-000040')!.metadata.currentHash);
		const stats = await pruneSecArchive(h.db, ctx.runDate, root);
		expect(stats).toMatchObject({ deleted_files: 0 });
		expect(Number(stats!.retained_files)).toBeGreaterThan(0);
	});
});
