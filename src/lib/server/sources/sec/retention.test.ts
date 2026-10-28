import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveEvidence } from './client.js';
import { PRUNE_GRACE_MS, readTaxonomyCatalog, retainedHashes, sweepObjects, type RetentionInput } from './retention.js';
import type { Filing } from './store.js';
import type { FilingPackage } from './xbrl/types.js';

const runDate = '2026-09-06';
let nextId = 1;
function filing(form: string, filedDate: string, status = 'processed', issuerId = 1): Filing {
	const id = nextId++;
	return { id, issuerId, form, filedDate, status, source: 'sec', externalId: `acc-${id}`, metadata: { currentHash: `submission-${id}` } } as unknown as Filing;
}
const evidence = (hash: string) => ({ hash, path: `/objects/${hash}`, url: 'https://www.sec.gov/fixture', observedAt: '2026-09-01T00:00:00Z' });
const manifest = (...hashes: string[]): FilingPackage => ({ schemaVersion: 1, accession: 'acc', acceptedAt: null, submissionHash: 'x', entrypoints: [], documents: hashes.map(evidence) });
const input = (patch: Partial<RetentionInput>): RetentionInput => ({ filings: [], extractions: [], processing: [], companyFacts: [], catalog: [], ...patch });
const submission = (f: Filing) => String(f.metadata.currentHash);

describe('retainedHashes', () => {
	it('keeps the latest 10-K and 10-Q with their amendments, not older reports or 8-Ks', () => {
		const oldK = filing('10-K', '2025-02-01'), k = filing('10-K', '2026-02-01'), kAmendment = filing('10-K/A', '2026-03-01');
		const oldQ = filing('10-Q', '2026-05-01'), q = filing('10-Q', '2026-08-01'), current = filing('8-K', '2026-09-01');
		const otherIssuer = filing('10-Q', '2026-07-01', 'processed', 2), outsideWindow = filing('10-K', '2021-12-31', 'processed', 3);
		const kept = retainedHashes(input({ filings: [oldK, k, kAmendment, oldQ, q, current, otherIssuer, outsideWindow] }), runDate);
		expect([...kept].sort()).toEqual([k, kAmendment, q, otherIssuer].map(submission).sort());
	});
	it('keeps a queued newer report as well as the processed one it will supersede', () => {
		const processed = filing('10-Q', '2026-05-01'), queued = filing('10-Q', '2026-08-01', 'pending'), unavailable = filing('10-Q', '2026-08-15', 'unavailable');
		const kept = retainedHashes(input({ filings: [processed, queued, unavailable] }), runDate);
		expect([...kept].sort()).toEqual([processed, queued].map(submission).sort());
	});
	it('keeps in-flight package documents but not completed ones', () => {
		const k = filing('10-K', '2026-02-01'), q = filing('10-Q', '2026-08-01'), old = filing('10-Q', '2026-05-01');
		const kept = retainedHashes(input({ filings: [k, q, old], processing: [
			{ filingId: k.id, status: 'complete', manifest: manifest('k-doc') },
			{ filingId: q.id, status: 'failed', manifest: manifest('q-doc', 'q-schema') },
			{ filingId: q.id, status: 'running', manifest: null },
			{ filingId: old.id, status: 'failed', manifest: manifest('old-doc') }
		] }), runDate);
		expect(kept).toContain('q-doc'); expect(kept).toContain('q-schema');
		expect(kept).not.toContain('k-doc'); expect(kept).not.toContain('old-doc');
	});
	it('keeps extraction artifacts of selected filings, Company Facts and the taxonomy catalog', () => {
		const k = filing('10-K', '2026-02-01'), old = filing('10-K', '2025-02-01');
		const kept = retainedHashes(input({ filings: [k, old], extractions: [{ filingId: k.id, artifact: evidence('k-artifact') }, { filingId: old.id, artifact: evidence('old-artifact') }],
			companyFacts: [evidence('facts')], catalog: [evidence('us-gaap.xsd')] }), runDate);
		expect([...kept].sort()).toEqual(['facts', 'k-artifact', submission(k), 'us-gaap.xsd'].sort());
	});
});

describe('sweepObjects', () => {
	let root: string;
	const now = Date.now(), old = new Date(now - PRUNE_GRACE_MS - 60_000);
	beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'sec-prune-test-')); });
	afterEach(async () => { await rm(root, { recursive: true, force: true }); });
	async function object(content: string, aged = true) {
		const stored = await archiveEvidence('https://www.sec.gov/fixture', content, root);
		if (aged) await utimes(stored.path, old, old);
		return stored;
	}
	async function temp(dir: string, aged: boolean) {
		await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'body'), 'partial');
		if (aged) await utimes(dir, old, old);
	}
	const objects = () => path.join(root, 'sec', 'objects');
	async function remaining() { return (await Promise.all((await readdir(objects())).map(async (shard) => (await readdir(path.join(objects(), shard))).map((name) => shard.startsWith('.write-') ? shard : name)))).flat().sort(); }

	it('deletes old unretained objects and leaked staging directories, keeping retained and young ones', async () => {
		const retained = await object('retained'), stale = await object('stale'), young = await object('young', false);
		await temp(path.join(objects(), '.write-old'), true);
		await temp(path.join(path.dirname(retained.path), '.write-nested'), true);
		await temp(path.join(objects(), '.write-young'), false);
		const stats = await sweepObjects(root, new Set([retained.hash]), { now });
		expect(stats).toMatchObject({ deleted_files: 1, retained_files: 2, deleted_temp_dirs: 2 });
		expect(stats.deleted_bytes).toBeGreaterThan(0);
		expect(await remaining()).toEqual(['.write-young', retained.hash, young.hash].sort());
		expect(await remaining()).not.toContain(stale.hash);
	});
	it('restarts the grace window when an existing object is observed again', async () => {
		const stale = await object('observed again');
		await archiveEvidence('https://www.sec.gov/fixture', 'observed again', root);
		expect(await sweepObjects(root, new Set(), { now })).toMatchObject({ deleted_files: 0, retained_files: 1 });
		expect(await remaining()).toEqual([stale.hash]);
	});
	it('tolerates an archive that does not exist yet', async () => {
		expect(await sweepObjects(path.join(root, 'missing'), new Set(), { now })).toMatchObject({ deleted_files: 0, retained_files: 0 });
		expect(await readTaxonomyCatalog(path.join(root, 'missing'))).toEqual([]);
	});
	it('reads catalog entries and ignores in-progress index writes', async () => {
		const dir = path.join(root, 'sec', 'taxonomy-catalog'), entry = evidence('a'.repeat(64));
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, 'b'.repeat(64)), JSON.stringify(entry));
		await writeFile(path.join(dir, `${'c'.repeat(64)}.tmp-uuid`), '{');
		expect(await readTaxonomyCatalog(root)).toEqual([entry]);
	});
});
