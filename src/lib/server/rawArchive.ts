import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { addDays, isoDate } from './util.js';

/**
 * Archive a raw source payload under RAW_DATA_DIR/<source>/<date>/<name> so
 * ingestion can be re-run/debugged without re-fetching.
 */
export async function archiveRaw(
	source: string,
	name: string,
	content: string,
	date: string = isoDate(new Date(), config().TZ)
): Promise<void> {
	const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
	const dir = path.join(config().RAW_DATA_DIR, source, date);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, safeName), content);
}

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Delete raw-archive date directories older than the retention window,
 * keeping disk usage bounded. Opt-in: with RAW_RETENTION_DAYS unset nothing
 * is ever deleted. The <date> directory layout makes this a pure name
 * comparison. Returns the number of directories removed.
 */
export async function pruneRawArchive(
	runDate: string,
	retentionDays: number | undefined = config().RAW_RETENTION_DAYS,
	root: string = config().RAW_DATA_DIR
): Promise<number> {
	if (retentionDays === undefined) return 0;
	const cutoff = addDays(runDate, -retentionDays);
	let removed = 0;
	for (const source of await listDirs(root)) {
		for (const date of await listDirs(path.join(root, source))) {
			if (!DATE_DIR.test(date) || date >= cutoff) continue;
			await rm(path.join(root, source, date), { recursive: true, force: true });
			removed++;
		}
	}
	return removed;
}

/** Subdirectory names, tolerating a root that doesn't exist yet. */
async function listDirs(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
}
