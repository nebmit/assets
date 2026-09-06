import { createReadStream } from 'node:fs';
import { parseFinancialHeader } from './filingHeader.js';
import { createHash } from 'node:crypto';
import { mkdir, open, rename, rm, mkdtemp, link } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import yauzl from 'yauzl';
import { config } from '../../config.js';
import { RateLimiter, HttpError } from '../../http.js';
import { sleep } from '../../util.js';

const userAgent = 'Assets SEC Worker contact@timben.net';
const limiter = new RateLimiter(200);
const allowedHosts = new Set(['www.sec.gov', 'data.sec.gov', 'www.nasdaqtrader.com', 'www.ishares.com']);
export const transportStats = { requests: 0, bytes: 0 };
export class SecAccessError extends Error {}
export class SecTransportError extends Error {
	constructor(message: string, options?: ErrorOptions, readonly retryAfter: string | null = null) { super(message, options); }
}
export class SourceSizeError extends Error {
	constructor(url: string, observedBytes: number, maxBytes: number) {
		super(`source response exceeds size limit: ${url}; observed_bytes=${observedBytes}; limit_bytes=${maxBytes}`);
	}
}
/** Only transport failures are retried; parsing, validation and disk failures are deterministic. */
export async function retryTransport<T>(operation: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try { return await operation(); }
		catch (error) {
			if (!(error instanceof SecTransportError) || attempt >= 3) throw error;
			await pause(retryDelay(error.retryAfter, attempt));
		}
	}
}
export function hash(value: string | Buffer): string {
	return createHash('sha256').update(value).digest('hex');
}
export function retryDelay(header: string | null, attempt: number, now = Date.now()): number {
	const seconds = header === null ? NaN : Number(header);
	const specified = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header ?? '') - now;
	return Math.max(1000 * 2 ** attempt, Number.isFinite(specified) ? specified : 0);
}
async function pause(ms: number): Promise<void> {
	// Do not cap Retry-After: long cooldowns terminate the run and retry next invocation.
	if (ms > 60_000) throw new SecAccessError(`SEC requested a ${Math.ceil(ms / 1000)}s cooldown; retry later`);
	await sleep(ms);
}

async function* bodyChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
	const reader = body.getReader();
	try { for (;;) { const item = await reader.read().catch((error: unknown) => { throw new SecTransportError('source body interrupted', { cause: error }); }); if (item.done) return; yield item.value; } }
	finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function response(url: string): Promise<Response> {
	let current = url;
	for (let redirects = 0; redirects <= 5; redirects++) {
		const parsed = new URL(current);
		if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) throw new Error(`unapproved source URL: ${current}`);
		await limiter.acquire();
		transportStats.requests++;
		const res = await fetch(current, {
			headers: { 'User-Agent': userAgent, Accept: '*/*' },
			redirect: 'manual', signal: AbortSignal.timeout(120_000)
		}).catch((error: unknown) => { throw new SecTransportError('source request interrupted', { cause: error }); });
		if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
			await res.body?.cancel();
			current = new URL(res.headers.get('location')!, current).href;
			continue;
		}
		return res;
	}
	throw new Error('too many source redirects');
}

/** One request at a time in current jobs; limiter is shared by all provider endpoints. */
async function request<T>(url: string, consume: (res: Response) => Promise<T>): Promise<T> {
	return retryTransport(async () => {
		const res = await response(url);
		if (res.status === 403) {
			await res.body?.cancel();
			throw new SecAccessError(`SEC access denied: ${url}`);
		}
		if (!res.ok) {
			const retry = res.status === 429 || res.status >= 500;
			await res.body?.cancel();
			if (retry) throw new SecTransportError(`HTTP ${res.status}: ${url}`, undefined, res.headers.get('retry-after'));
			throw new HttpError(res.status, url, 'source request failed');
		}
		return await consume(res);
	});
}

export async function fetchSecText(url: string, maxBytes = 64 * 1024 * 1024): Promise<string> {
	return request(url, (res) => readSourceText(res, url, maxBytes));
}

export async function readSourceText(res: Response, url: string, maxBytes: number): Promise<string> {
		if (!res.body) throw new Error('empty source response');
		let size = 0;
		const chunks: Uint8Array[] = [];
		for await (const chunk of bodyChunks(res.body)) {
			size += chunk.length;
			transportStats.bytes += chunk.length;
			if (size > maxBytes) throw new SourceSizeError(url, size, maxBytes);
			chunks.push(chunk);
		}
		const text = Buffer.concat(chunks).toString('utf8');
		if (/<!doctype html|<html[\s>]/i.test(text.slice(0, 1000)) && /undeclared automated|access denied|request rate threshold|captcha/i.test(text)) {
			throw new SecAccessError(`source challenge at ${url}`);
		}
		return text;
}

export interface Evidence { hash: string; path: string; url: string; observedAt: string }
export async function archiveEvidence(url: string, content: string, root = config().RAW_DATA_DIR): Promise<Evidence> {
	const digest = hash(content);
	const dir = path.join(root, 'sec', 'objects', digest.slice(0, 2));
	await mkdir(dir, { recursive: true });
	const target = path.join(dir, digest);
	const temp = await mkdtemp(path.join(dir, '.write-'));
	try {
		const file = await open(path.join(temp, 'body'), 'wx');
		try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
		await publishEvidence(path.join(temp, 'body'), target, digest);
	} finally { await rm(temp, { recursive: true, force: true }); }
	return { hash: digest, path: target, url, observedAt: new Date().toISOString() };
}

async function publishEvidence(staged: string, target: string, digest: string): Promise<void> {
	try { await link(staged, target); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		const existing = createHash('sha256');
		for await (const chunk of createReadStream(target)) existing.update(chunk);
		if (existing.digest('hex') !== digest) throw new Error('corrupt SEC evidence object');
	}
}

export const MAX_SUBMISSION_BYTES = 1024 ** 3;
export const MAX_HEADER_BYTES = 1024 ** 2;
export async function fetchFinancialSubmission(url: string, accession: string) {
	return request(url, (res) => archiveFinancialSubmission(res, url, accession));
}

/** Retain at most 1 MiB of header; the complete original goes directly to disk. */
export async function archiveFinancialSubmission(res: Response, url: string, accession: string,
	root = config().RAW_DATA_DIR, maxBytes = MAX_SUBMISSION_BYTES): Promise<{ header: string; evidence: Evidence }> {
	if (!res.body) throw new Error('empty source response');
	const objects = path.join(root, 'sec', 'objects');
	let temp: string | undefined;
	try {
		await mkdir(objects, { recursive: true });
		temp = await mkdtemp(path.join(objects, '.write-'));
		const file = await open(path.join(temp, 'body'), 'wx');
		const digest = createHash('sha256');
		let size = 0, prefix = Buffer.alloc(0), header: string | undefined;
		try {
			for await (const chunk of bodyChunks(res.body)) {
				size += chunk.length; transportStats.bytes += chunk.length;
				if (size > maxBytes) throw new SourceSizeError(url, size, maxBytes);
				if (header === undefined) {
					prefix = Buffer.concat([prefix, chunk.subarray(0, MAX_HEADER_BYTES - prefix.length)]);
					const text = prefix.toString('utf8');
					if (/<!doctype html|<html[\s>]/i.test(text.slice(0, 1000)) && /undeclared automated|access denied|request rate threshold|captcha/i.test(text)) throw new SecAccessError(`source challenge at ${url}`);
					const end = text.indexOf('</SEC-HEADER>');
					if (end >= 0) {
						header = text.slice(0, end + '</SEC-HEADER>'.length);
						parseFinancialHeader(header, accession);
						prefix = Buffer.alloc(0);
					} else if (prefix.length === MAX_HEADER_BYTES) throw new Error(`SEC header exceeds ${MAX_HEADER_BYTES} bytes: ${url}`);
				}
				digest.update(chunk);
				await file.writeFile(chunk);
			}
			if (header === undefined) throw new Error(`missing complete SEC header: ${url}`);
			await file.sync();
		} finally { await file.close(); }
		const value = digest.digest('hex');
		const dir = path.join(objects, value.slice(0, 2));
		await mkdir(dir, { recursive: true });
		const target = path.join(dir, value);
		await publishEvidence(path.join(temp, 'body'), target, value);
		return { header, evidence: { hash: value, path: target, url, observedAt: new Date().toISOString() } };
	} finally {
		await res.body.cancel().catch(() => {});
		if (temp) await rm(temp, { recursive: true, force: true });
	}
}

/** Download to disk, then process one bounded ZIP entry at a time. Never extract paths. */
export async function readZip(url: string, include: (name: string) => boolean, consume: (name: string, text: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), 'assets-sec-'));
	const target = path.join(dir, 'archive.zip');
	try {
		await request(url, async (res) => {
			if (!res.body) throw new Error('empty ZIP response');
			const file = await open(target + '.part', 'w');
			let size = 0;
			try {
				for await (const chunk of bodyChunks(res.body)) {
					size += chunk.length; transportStats.bytes += chunk.length;
					if (size > 8 * 1024 ** 3) throw new SourceSizeError(url, size, 8 * 1024 ** 3);
					await file.writeFile(chunk);
				}
			} finally { await file.close(); }
			await rename(target + '.part', target);
		});
		await readZipEntries(target, include, consume);
	} finally { await rm(dir, { recursive: true, force: true }); }
}

export async function readZipEntries(target: string, include: (name: string) => boolean, consume: (name: string, text: string) => Promise<void>): Promise<void> {
		const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(target, { lazyEntries: true, autoClose: false }, (e, z) => e ? reject(e) : resolve(z!)));
		try {
			await new Promise<void>((resolve, reject) => {
				let total = 0;
				zip.on('error', reject);
				zip.on('end', resolve);
				zip.on('entry', (entry: yauzl.Entry) => {
					void (async () => {
						const name = entry.fileName;
						if (name.includes('..') || name.includes('\\') || name.startsWith('/')) throw new Error('unsafe ZIP entry');
						total += entry.uncompressedSize;
						if (total > 100 * 1024 ** 3) throw new Error('ZIP expansion exceeds limit');
						if (include(name)) {
							if (entry.uncompressedSize > 256 * 1024 ** 2) throw new Error(`ZIP entry too large: ${name}`);
							const stream = await new Promise<NodeJS.ReadableStream>((ok, fail) => zip.openReadStream(entry, (e, s) => e ? fail(e) : ok(s!)));
							const chunks: Buffer[] = []; let size = 0;
							for await (const chunk of stream) { size += chunk.length; if (size > 256 * 1024 ** 2) throw new Error('ZIP entry exceeded limit'); chunks.push(Buffer.from(chunk)); }
							await consume(name, Buffer.concat(chunks).toString('utf8'));
						}
						zip.readEntry();
					})().catch(reject);
				});
				zip.readEntry();
			});
		} finally { zip.close(); }
}
