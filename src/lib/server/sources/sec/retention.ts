import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { issuer, secExtraction, secProcessing, sourceFiling } from '../../db/schema.js';
import type { Db } from '../../db/index.js';
import type { JobStats } from '../../pipeline/types.js';
import { config } from '../../config.js';
import type { Evidence } from './client.js';
import type { FilingPackage } from './xbrl/types.js';
import { financialCutoff, financialDocuments, type Filing } from './store.js';

/** Objects written or re-observed this recently survive a sweep, protecting in-flight runs. */
export const PRUNE_GRACE_MS = 2 * 24 * 3600_000;

/** 10-K/10-Q filings in the tracked window; only these can ever be read back from the archive. */
export function financialWindow(runDate: string) {
	return and(eq(sourceFiling.source, 'sec'), sql`${sourceFiling.form} ~ '^10-(K|Q)(/A)?$' and ${sourceFiling.filedDate} >= ${financialCutoff(runDate)} and ${sourceFiling.filedDate} <= ${runDate}`);
}

/** Filings sec_fundamentals reads now, or will read once the queued downloads have landed. */
export function financialSelection(filings: Filing[], runDate: string): Set<number> {
	const byIssuer = new Map<number | null, Filing[]>();
	for (const f of filings) if (f.filedDate >= financialCutoff(runDate)) byIssuer.set(f.issuerId, [...(byIssuer.get(f.issuerId) ?? []), f]);
	const selected = new Set<number>();
	for (const group of byIssuer.values()) {
		const queued = group.filter((f) => ['processed', 'pending', 'error'].includes(f.status)).map((f) => ({ ...f, status: 'processed' }));
		for (const f of [...financialDocuments(group, runDate), ...financialDocuments(queued, runDate)]) selected.add(f.id);
	}
	return selected;
}

export interface RetentionInput {
	filings: Filing[];
	extractions: { filingId: number; artifact: Evidence }[];
	processing: { filingId: number; status: string; manifest: FilingPackage | null }[];
	companyFacts: Evidence[];
	catalog: Evidence[];
}

/** Every archived object the pipeline reads again. Everything else is re-downloaded from the SEC on demand. */
export function retainedHashes(input: RetentionInput, runDate: string): Set<string> {
	const selected = financialSelection(input.filings, runDate);
	const hashes = new Set<string>();
	for (const f of input.filings) if (selected.has(f.id) && typeof f.metadata.currentHash === 'string') hashes.add(f.metadata.currentHash);
	// Resolver-only bumps reuse the extraction instead of re-running Arelle.
	for (const e of input.extractions) if (selected.has(e.filingId)) hashes.add(e.artifact.hash);
	// Completed packages rebuild deterministically from the submission; in-flight ones resume from their manifest.
	for (const p of input.processing) if (selected.has(p.filingId) && p.status !== 'complete') for (const d of p.manifest?.documents ?? []) hashes.add(d.hash);
	for (const e of [...input.companyFacts, ...input.catalog]) hashes.add(e.hash);
	return hashes;
}

async function entries(dir: string) {
	try { return await readdir(dir, { withFileTypes: true }); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

/** The taxonomy catalog maps dependency URLs to shared objects; every catalog entry is retained. */
export async function readTaxonomyCatalog(root: string): Promise<Evidence[]> {
	const dir = path.join(root, 'sec', 'taxonomy-catalog');
	const names = (await entries(dir)).filter((e) => e.isFile() && /^[0-9a-f]{64}$/.test(e.name)).map((e) => e.name);
	return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(dir, name), 'utf8')) as Evidence));
}

/** Retention covers every included issuer, independent of the run's issuer selection. */
export async function loadRetention(db: Db, runDate: string, root: string): Promise<RetentionInput> {
	const included = db.select({ id: issuer.id }).from(issuer).where(sql`${issuer.secMetadata}->>'status' = 'included'`);
	const where = and(financialWindow(runDate), inArray(sourceFiling.issuerId, included));
	const ids = db.select({ id: sourceFiling.id }).from(sourceFiling).where(where);
	const [filings, extractions, processing, issuers, catalog] = await Promise.all([
		db.select().from(sourceFiling).where(where),
		db.select({ filingId: secExtraction.filingId, artifact: secExtraction.artifact }).from(secExtraction).where(inArray(secExtraction.filingId, ids)),
		db.select({ filingId: secProcessing.filingId, status: secProcessing.status, manifest: secProcessing.manifest }).from(secProcessing).where(inArray(secProcessing.filingId, ids)),
		db.select({ metadata: issuer.secMetadata }).from(issuer).where(sql`${issuer.secMetadata}->>'status' = 'included'`),
		readTaxonomyCatalog(root)
	]);
	return { filings, extractions, processing, catalog, companyFacts: issuers.flatMap((i) => i.metadata?.factsEvidence ? [i.metadata.factsEvidence as Evidence] : []) };
}

/** Delete unretained objects and leaked staging directories older than the grace window. */
export async function sweepObjects(root: string, retained: Set<string>, { now = Date.now(), graceMs = PRUNE_GRACE_MS } = {}): Promise<JobStats> {
	const stats = { deleted_files: 0, deleted_bytes: 0, retained_files: 0, retained_bytes: 0, deleted_temp_dirs: 0 };
	const remove = (target: string) => rm(target, { recursive: true, force: true });
	const objects = path.join(root, 'sec', 'objects');
	const sweepTemp = async (dir: string) => { if (now - (await stat(dir)).mtimeMs >= graceMs) { await remove(dir); stats.deleted_temp_dirs++; } };
	for (const shard of await entries(objects)) {
		const shardPath = path.join(objects, shard.name);
		if (shard.isDirectory() && shard.name.startsWith('.write-')) { await sweepTemp(shardPath); continue; }
		if (!shard.isDirectory() || !/^[0-9a-f]{2}$/.test(shard.name)) continue;
		for (const entry of await entries(shardPath)) {
			const file = path.join(shardPath, entry.name);
			if (entry.isDirectory() && entry.name.startsWith('.write-')) { await sweepTemp(file); continue; }
			if (!entry.isFile()) continue;
			const info = await stat(file);
			if (retained.has(entry.name) || now - info.mtimeMs < graceMs) { stats.retained_files++; stats.retained_bytes += info.size; continue; }
			await remove(file);
			stats.deleted_files++; stats.deleted_bytes += info.size;
		}
	}
	return stats;
}

/** Sweep the SEC archive down to what the pipeline still reads; null when there is no financial state to retain against. */
export async function pruneSecArchive(db: Db, runDate: string, root = config().RAW_DATA_DIR): Promise<JobStats | null> {
	const input = await loadRetention(db, runDate, root);
	// An empty selection means missing state, not an empty archive: never sweep on it.
	if (!input.filings.length) return null;
	const retained = retainedHashes(input, runDate);
	return { ...(await sweepObjects(root, retained)), retained_hashes: retained.size };
}
