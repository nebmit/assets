import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneRawArchive } from './rawArchive.js';

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
	await rm(root, { recursive: true, force: true });
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
