import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { isoDate } from './util.js';

/**
 * Archive a raw source payload under RAW_DATA_DIR/<source>/<date>/<name> so
 * ingestion can be re-run/debugged without re-fetching.
 */
export async function archiveRaw(
	source: string,
	name: string,
	content: string,
	date: string = isoDate()
): Promise<void> {
	const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
	const dir = path.join(config().RAW_DATA_DIR, source, date);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, safeName), content);
}
