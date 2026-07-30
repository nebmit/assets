import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Buffer } from 'node:buffer';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { sleep } from './util.js';

/** Serializes requests so a source sees at most one request per interval. */
export class RateLimiter {
	private queue: Promise<void> = Promise.resolve();
	private lastStart = 0;

	constructor(private minIntervalMs: number) {}

	async acquire(): Promise<void> {
		const turn = this.queue.then(async () => {
			const wait = this.lastStart + this.minIntervalMs - Date.now();
			if (wait > 0) await sleep(wait);
			this.lastStart = Date.now();
		});
		// keep the chain alive even if a caller's request later fails
		this.queue = turn.catch(() => {});
		await turn;
	}
}

export class HttpError extends Error {
	constructor(
		public readonly status: number,
		public readonly url: string,
		public readonly bodySnippet: string
	) {
		super(`HTTP ${status} for ${url}: ${bodySnippet.slice(0, 200)}`);
	}
}

export class TransportError extends Error {
	constructor(
		public readonly url: string,
		public override readonly cause: unknown
	) {
		super(`transport error for ${url}: ${summarizeError(cause)}`);
	}
}

export interface FetchOptions {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	retries?: number;
	limiter?: RateLimiter;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function summarizeError(err: unknown, depth = 0): string {
	if (!(err instanceof Error)) return String(err);
	const parts = [`${err.name}: ${err.message}`];
	if ('code' in err && typeof err.code === 'string') parts.push(`code=${err.code}`);
	if (depth < 2 && 'cause' in err && err.cause !== undefined) {
		parts.push(`cause=${summarizeError(err.cause, depth + 1)}`);
	}
	return parts.join(' ');
}

/**
 * fetch with rate limiting, timeout, and exponential-backoff retries on
 * network errors and retryable status codes. Returns the response body text.
 */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
	const { method = 'GET', headers, body, timeoutMs = 30_000, retries = 3, limiter } = options;

	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1) * (1 + Math.random()));
		await limiter?.acquire();
		try {
			const res = await fetch(url, {
				method,
				headers,
				body,
				signal: AbortSignal.timeout(timeoutMs),
				redirect: 'follow'
			});
			const text = await res.text();
			if (res.ok) return text;
			lastError = new HttpError(res.status, url, text);
			if (!RETRYABLE_STATUS.has(res.status)) throw lastError;
		} catch (err) {
			if (err instanceof HttpError && !RETRYABLE_STATUS.has(err.status)) throw err;
			lastError = err instanceof HttpError ? err : new TransportError(url, err);
		}
	}
	throw lastError;
}

/**
 * Minimal in-memory cookie store for a stateful multi-request flow against a
 * single host. Name→value only: no domain, path or expiry handling — enough for
 * a session cookie used across a handful of requests inside one job run, and
 * deliberately not an RFC 6265 implementation.
 */
export class CookieJar {
	private cookies = new Map<string, string>();

	capture(setCookieHeaders: string[]): void {
		for (const header of setCookieHeaders) {
			const pair = header.split(';', 1)[0];
			const separator = pair.indexOf('=');
			if (separator <= 0) continue;
			const name = pair.slice(0, separator).trim();
			const value = pair.slice(separator + 1).trim();
			if (name) this.cookies.set(name, value);
		}
	}

	/** `"a=1; b=2"`, or undefined when the jar is empty. */
	header(): string | undefined {
		if (this.cookies.size === 0) return undefined;
		return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	get size(): number {
		return this.cookies.size;
	}
}

export interface SessionResponse {
	/** Final URL after any redirects. */
	url: string;
	status: number;
	contentType: string | null;
	text: string;
}

const MAX_REDIRECTS = 5;

/**
 * Cookie-aware fetch that follows redirects manually. Node's fetch drops
 * Set-Cookie from intermediate 3xx hops and only exposes the final response's
 * headers, so a session established by a redirecting landing page is lost with
 * `redirect: 'follow'`. Hops are followed here with `redirect: 'manual'` so
 * cookies can be captured at every one. A retry restarts the whole chain from
 * the requested URL with the same jar.
 */
export async function fetchSession(
	url: string,
	options: FetchOptions & { jar: CookieJar }
): Promise<SessionResponse> {
	const { method = 'GET', headers, body, timeoutMs = 30_000, retries = 3, limiter, jar } = options;

	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1) * (1 + Math.random()));
		try {
			let currentUrl = url;
			let currentMethod = method;
			let currentBody = body;

			for (let hop = 0; ; hop++) {
				if (hop > MAX_REDIRECTS) {
					throw new Error(`too many redirects (>${MAX_REDIRECTS}) starting at ${url}`);
				}
				await limiter?.acquire();
				const cookieHeader = jar.header();
				const res = await fetch(currentUrl, {
					method: currentMethod,
					headers: { ...headers, ...(cookieHeader ? { cookie: cookieHeader } : {}) },
					body: currentBody,
					signal: AbortSignal.timeout(timeoutMs),
					redirect: 'manual'
				});
				jar.capture(res.headers.getSetCookie());

				const location = res.headers.get('location');
				if (res.status >= 300 && res.status < 400 && location) {
					// drain so the socket can be reused
					await res.arrayBuffer();
					currentUrl = new URL(location, currentUrl).toString();
					if (res.status === 301 || res.status === 302 || res.status === 303) {
						currentMethod = 'GET';
						currentBody = undefined;
					}
					continue;
				}

				const text = await res.text();
				if (res.ok) {
					return {
						url: currentUrl,
						status: res.status,
						contentType: res.headers.get('content-type'),
						text
					};
				}
				throw new HttpError(res.status, currentUrl, text);
			}
		} catch (err) {
			if (err instanceof HttpError && !RETRYABLE_STATUS.has(err.status)) throw err;
			lastError = err instanceof HttpError ? err : new TransportError(url, err);
		}
	}
	throw lastError;
}

/**
 * Node's built-in fetch (undici) intentionally rejects invalid response
 * headers. A few legacy public-sector portals still emit folded/multiline
 * headers; use this narrowly for such sources, never as the default client.
 */
export async function fetchTextLooseHeaders(url: string, options: FetchOptions = {}): Promise<string> {
	const { method = 'GET', headers, body, timeoutMs = 30_000, retries = 3, limiter } = options;

	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1) * (1 + Math.random()));
		await limiter?.acquire();
		try {
			const text = await requestTextLooseHeaders(url, { method, headers, body, timeoutMs });
			return text;
		} catch (err) {
			if (err instanceof HttpError && !RETRYABLE_STATUS.has(err.status)) throw err;
			lastError = err instanceof HttpError ? err : new TransportError(url, err);
		}
	}
	throw lastError;
}

async function requestTextLooseHeaders(
	url: string,
	options: Required<Pick<FetchOptions, 'method' | 'timeoutMs'>> & Pick<FetchOptions, 'headers' | 'body'>
): Promise<string> {
	return new Promise((resolve, reject) => {
		const transport = url.startsWith('https:') ? httpsRequest : httpRequest;
		const req = transport(
			url,
			{
				method: options.method,
				headers: options.headers,
				timeout: options.timeoutMs,
				insecureHTTPParser: true
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer | string) => {
					chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
				});
				res.on('error', reject);
				res.on('end', () => {
					try {
						const text = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']);
						const status = res.statusCode ?? 0;
						if (status >= 200 && status < 300) {
							resolve(text);
							return;
						}
						reject(new HttpError(status, url, text));
					} catch (err) {
						reject(err);
					}
				});
			}
		);
		req.on('timeout', () => req.destroy(new Error(`request timed out after ${options.timeoutMs}ms`)));
		req.on('error', reject);
		if (options.body !== undefined) req.write(options.body);
		req.end();
	});
}

function decodeBody(buffer: Buffer, encodingHeader: string | string[] | undefined): string {
	const encoding = Array.isArray(encodingHeader) ? encodingHeader.join(',') : (encodingHeader ?? '');
	const normalized = encoding.toLowerCase();
	if (normalized.includes('gzip')) return gunzipSync(buffer).toString('utf8');
	if (normalized.includes('deflate')) return inflateSync(buffer).toString('utf8');
	if (normalized.includes('br')) return brotliDecompressSync(buffer).toString('utf8');
	return buffer.toString('utf8');
}
