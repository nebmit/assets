import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveFinancialSubmission, MAX_HEADER_BYTES, MAX_SUBMISSION_BYTES, retryTransport, SecTransportError, SourceSizeError, readSourceText, hash } from './client.js';
import { parseFinancialHeader } from './filingHeader.js';
import { evidenceVersions } from './store.js';

const accession = '0000005272-24-000023';
const url = 'https://www.sec.gov/Archives/edgar/data/5272/0000005272-24-000023.txt';
const header = `<SEC-DOCUMENT>${accession}.txt\n<SEC-HEADER>\nACCESSION NUMBER: ${accession}\n<ACCEPTANCE-DATETIME>20240215120000\n</SEC-HEADER>`;
const roots: string[] = [];
async function root() { const dir = await mkdtemp(path.join(tmpdir(), 'sec-stream-test-')); roots.push(dir); return dir; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function generatedSubmission(blocks: number) {
	const block = Buffer.alloc(64 * 1024, 'x');
	let index = -1;
	return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
		if (index === -1) { controller.enqueue(Buffer.from(header)); index++; }
		else if (index++ < blocks) controller.enqueue(block);
		else controller.close();
	} }));
}

describe('streamed financial filings', () => {
	it('archives over 64 MiB from generated chunks and deduplicates replay without buffering originals', async () => {
		const dir = await root(), blocks = 1040;
		const expected = createHash('sha256').update(header);
		const block = Buffer.alloc(64 * 1024, 'x');
		for (let i = 0; i < blocks; i++) expected.update(block);
		const first = await archiveFinancialSubmission(generatedSubmission(blocks), url, accession, dir);
		expect(MAX_SUBMISSION_BYTES).toBe(1024 ** 3);
		expect(first.header).toBe(header);
		expect(first.evidence.hash).toBe(expected.digest('hex'));
		expect((await stat(first.evidence.path)).size).toBe(Buffer.byteLength(header) + blocks * 64 * 1024);
		const second = await archiveFinancialSubmission(generatedSubmission(blocks), url, accession, dir);
		expect(second.evidence.path).toBe(first.evidence.path);
		expect(evidenceVersions({ documents: [first.evidence] }, second.evidence)).toEqual([first.evidence]);
		expect((await readdir(path.join(dir, 'sec', 'objects'))).some((name) => name.startsWith('.write-'))).toBe(false);
	});
	it('handles header tags split across chunks and preserves the entire raw body', async () => {
		const text = header + '\n<DOCUMENT>report and exhibits</DOCUMENT>\n</SEC-DOCUMENT>';
		let offset = 0;
		const res = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
			if (offset === text.length) controller.close();
			else { controller.enqueue(Buffer.from(text.slice(offset, offset + 7))); offset = Math.min(text.length, offset + 7); }
		} }));
		const result = await archiveFinancialSubmission(res, url, accession, await root());
		expect(result.evidence.hash).toBe(hash(text));
		expect(await readFile(result.evidence.path, 'utf8')).toBe(text);
		expect(parseFinancialHeader(result.header, accession)?.toISOString()).toBe('2024-02-15T17:00:00.000Z');
	});
	it('removes staging files after interruptions and never publishes partial originals', async () => {
		const dir = await root(); let reads = 0;
		const res = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
			if (reads++ === 0) controller.enqueue(Buffer.from(header));
			else controller.error(new Error('connection lost'));
		} }));
		await expect(archiveFinancialSubmission(res, url, accession, dir)).rejects.toBeInstanceOf(SecTransportError);
		expect(await readdir(path.join(dir, 'sec', 'objects'))).toEqual([]);
	});
	it('rejects oversized, mismatched, incomplete and oversized-header responses without publishing', async () => {
		for (const [text, expected] of [
			[header.replace(accession, '0000005272-24-000099').replace(accession, '0000005272-24-000099'), 'accession mismatch'],
			[header.replace('</SEC-HEADER>', ''), 'missing complete'],
			['x'.repeat(MAX_HEADER_BYTES), 'header exceeds'],
			[header.replace('20240215120000', 'invalid'), 'invalid acceptance']
		]) {
			const dir = await root();
			await expect(archiveFinancialSubmission(new Response(text), url, accession, dir)).rejects.toThrow(expected);
			expect(await readdir(path.join(dir, 'sec', 'objects'))).toEqual([]);
		}
		const dir = await root();
		await expect(archiveFinancialSubmission(new Response(header), url, accession, dir, 10)).rejects.toThrow(`observed_bytes=${Buffer.byteLength(header)}; limit_bytes=10`);
		expect(await readdir(path.join(dir, 'sec', 'objects'))).toEqual([]);
	});
	it('detects a corrupt pre-existing object and cleans staging files', async () => {
		const dir = await root();
		const first = await archiveFinancialSubmission(new Response(header), url, accession, dir);
		await writeFile(first.evidence.path, 'corrupt');
		await expect(archiveFinancialSubmission(new Response(header), url, accession, dir)).rejects.toThrow('corrupt SEC evidence');
		expect((await readdir(path.join(dir, 'sec', 'objects'))).some((name) => name.startsWith('.write-'))).toBe(false);
	});
});

describe('source retry policy', () => {
	it('does not retry size or validation failures', async () => {
		let calls = 0;
		await expect(retryTransport(async () => { calls++; return readSourceText(new Response('1234'), url, 3); })).rejects.toBeInstanceOf(SourceSizeError);
		expect(calls).toBe(1);
		calls = 0;
		const dir = await root();
		await expect(retryTransport(async () => { calls++; return archiveFinancialSubmission(new Response(header), url, '0000005272-24-000099', dir); })).rejects.toThrow('accession mismatch');
		expect(calls).toBe(1);
	});
	it('retries transport failures with backoff and stops after four attempts', async () => {
		vi.useFakeTimers();
		const succeeds = vi.fn().mockRejectedValueOnce(new SecTransportError('interrupted')).mockResolvedValue('ok');
		const success = expect(retryTransport(succeeds)).resolves.toBe('ok');
		await vi.runAllTimersAsync(); await success;
		expect(succeeds).toHaveBeenCalledTimes(2);
		const fails = vi.fn().mockRejectedValue(new SecTransportError('interrupted'));
		const failure = expect(retryTransport(fails)).rejects.toThrow('interrupted');
		await vi.runAllTimersAsync(); await failure;
		expect(fails).toHaveBeenCalledTimes(4);
	});
	it('respects Retry-After and stops on cooldowns longer than a minute', async () => {
		vi.useFakeTimers();
		const attempt = vi.fn().mockRejectedValueOnce(new SecTransportError('429', undefined, '5')).mockResolvedValue('ok');
		const done = expect(retryTransport(attempt)).resolves.toBe('ok');
		await vi.advanceTimersByTimeAsync(4999); expect(attempt).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1); await done; expect(attempt).toHaveBeenCalledTimes(2);
		const cooldown = vi.fn().mockRejectedValue(new SecTransportError('429', undefined, '61'));
		await expect(retryTransport(cooldown)).rejects.toThrow('cooldown');
		expect(cooldown).toHaveBeenCalledOnce();
	});
});
