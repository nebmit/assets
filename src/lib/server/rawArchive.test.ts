import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveRaw, pruneRawArchive } from './rawArchive.js';
import * as configuration from './config.js';
import { readStoredText } from './storage.js';
import { archiveObservation, fingerprint } from './assets/evidence.js';

let root: string;

async function seed(source: string, date: string): Promise<void> {
	const dir = path.join(root, source, date);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, 'payload.json'), '{}');
}

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'raw-archive-'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});

describe('raw storage', () => {
	it('compresses raw payloads and observations without changing names or hashes', async () => {
		vi.spyOn(configuration, 'config').mockReturnValue({ ...configuration.config(), RAW_DATA_DIR: root });
		await archiveRaw('bf', 'payload.json', '{"name":"Grüße"}', '2026-07-08');
		const file = path.join(root, 'bf', '2026-07-08', 'payload.json');
		expect((await readFile(file)).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
		expect(await readStoredText(file)).toBe('{"name":"Grüße"}');
		const first = await archiveObservation('bf', 'https://example.com', 'original');
		expect(first.hash).toBe(fingerprint('original'));
		expect(await readStoredText(first.path)).toBe('original');
		expect((await archiveObservation('bf', first.url, 'original')).path).toBe(first.path);
		await rm(root, { recursive: true });
		expect((await archiveObservation('bf', first.url, 'original')).path).toBe(first.path);
		expect(await readStoredText(first.path)).toBe('original');
	});
});

describe('pruneRawArchive', () => {
	it('deletes date directories past retention and keeps the rest', async () => {
		await seed('bf', '2026-06-01');
		await seed('bf', '2026-06-15');
		await seed('bafin', '2026-05-20');
		const removed = await pruneRawArchive('2026-07-08', 30, root);
		expect(removed).toBe(2);
		expect(await readdir(path.join(root, 'bf'))).toEqual(['2026-06-15']);
		expect(await readdir(path.join(root, 'bafin'))).toEqual([]);
	});

	it('keeps the directory exactly at the cutoff', async () => {
		await seed('bf', '2026-06-08');
		expect(await pruneRawArchive('2026-07-08', 30, root)).toBe(0);
	});

	it('ignores non-date directories', async () => {
		await mkdir(path.join(root, 'bf', 'notes'), { recursive: true });
		expect(await pruneRawArchive('2026-07-08', 1, root)).toBe(0);
		expect(await readdir(path.join(root, 'bf'))).toEqual(['notes']);
	});

	it('is a no-op without a retention setting', async () => {
		await seed('bf', '2000-01-01');
		expect(await pruneRawArchive('2026-07-08', undefined, root)).toBe(0);
		expect(await readdir(path.join(root, 'bf'))).toEqual(['2000-01-01']);
	});

	it('tolerates a missing archive root', async () => {
		expect(await pruneRawArchive('2026-07-08', 30, path.join(root, 'missing'))).toBe(0);
	});
});
