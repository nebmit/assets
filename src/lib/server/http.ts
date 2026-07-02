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

export interface FetchOptions {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	retries?: number;
	limiter?: RateLimiter;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

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
			lastError = err;
		}
	}
	throw lastError;
}
