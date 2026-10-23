import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyStored, openStored, readStoredText, writeStored } from './storage.js';
import { archiveEvidence } from './sources/sec/client.js';
import { submissionDocuments, verifyPackage } from './sources/sec/xbrl/package.js';
import { readPrimaryDocument } from './sources/sec/inlineFacts.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'storage-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('transparent gzip storage', () => {
	it.each(['', 'x', 'Grüße 日本語\n'.repeat(1000)])('round trips compressed and plain bytes (case %#)', async (text) => {
		const file = path.join(root, 'logical-path');
		await writeStored(file, text);
		expect((await readFile(file)).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
		expect(await readStoredText(file)).toBe(text);
		await copyStored(file, path.join(root, 'plain'));
		expect(await readFile(path.join(root, 'plain'), 'utf8')).toBe(text);
		await writeFile(file, text);
		expect(await readStoredText(file)).toBe(text);
	});
	it('rejects truncated gzip, bad checksums and missing files rather than treating them as plain', async () => {
		const file = path.join(root, 'object');
		await writeStored(file, 'original');
		const bytes = await readFile(file);
		await writeFile(file, bytes.subarray(0, bytes.length - 5));
		await expect(readStoredText(file)).rejects.toThrow();
		await expect(submissionDocuments(file)).rejects.toThrow();
		bytes[bytes.length - 8] ^= 1;
		await writeFile(file, bytes);
		await expect(readStoredText(file)).rejects.toThrow();
		await expect(openStored(path.join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('publishes concurrent immutable writes without replacing a corrupt gzip object', async () => {
		const results = await Promise.all(Array.from({ length: 4 }, () => archiveEvidence('https://www.sec.gov/test', 'original', root)));
		expect(new Set(results.map((result) => result.path)).size).toBe(1);
		const file = results[0].path;
		const bytes = await readFile(file);
		const truncated = bytes.subarray(0, bytes.length - 5);
		await writeFile(file, truncated);
		await expect(archiveEvidence('https://www.sec.gov/test', 'original', root)).rejects.toThrow();
		expect(await readFile(file)).toEqual(truncated);
	});
	it('reads SEC SGML and verifies packages from gzip at unchanged paths', async () => {
		const text = '<DOCUMENT>\n<TYPE>10-K\n<FILENAME>report.htm\n<TEXT>\n<html>Grüße</html>\n</TEXT>\n</DOCUMENT>\n';
		const evidence = await archiveEvidence('https://www.sec.gov/report', text, root);
		expect(await submissionDocuments(evidence.path)).toEqual([{ name: 'report.htm', type: '10-K', body: '<html>Grüße</html>\n' }]);
		expect(await readPrimaryDocument(evidence.path, '10-K')).toContain('<html>Grüße</html>');
		const manifest = { schemaVersion: 1 as const, accession: 'test', acceptedAt: null, submissionHash: evidence.hash, entrypoints: [evidence.url], documents: [evidence] };
		await verifyPackage(manifest);
		await writeStored(evidence.path, 'changed', 'w');
		await expect(verifyPackage(manifest)).rejects.toThrow('Hash mismatch');
	});
});
