import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, link, unlink } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export function fingerprint(value: unknown): string {
	return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}
export async function archiveObservation(source: string, url: string, content: string) {
	const hash = fingerprint(content);
	const dir = path.join(config().RAW_DATA_DIR, source, 'objects', hash.slice(0, 2));
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, hash);
	const temporary = `${file}.${randomUUID()}.tmp`;
	await writeFile(temporary, content, { flag: 'wx' });
	try { await link(temporary, file); }
	catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
	finally { await unlink(temporary); }
	return { hash, path: file, url, observedAt: new Date().toISOString() };
}
