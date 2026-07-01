import type { z } from 'zod';
import { fetchText, RateLimiter } from '../../http.js';
import { archiveRaw } from '../../rawArchive.js';
import { md5 } from '../../util.js';

/**
 * Client for the undocumented api.boerse-frankfurt.de JSON API. No SLA, no
 * docs — everything here was derived from the website's own requests and can
 * break without notice, so responses are validated at the edge and archived.
 *
 * Quirks (verified 2026-07):
 * - Some endpoints (e.g. price_history) silently return `{}` unless the
 *   tracing handshake headers below are present; others work without them.
 *   We always send them.
 * - Requests carrying an `Origin` header are rejected ("Invalid CORS
 *   request") — never send one.
 */
export const BF_SOURCE = 'boerse_frankfurt';

const BASE_URL = 'https://api.boerse-frankfurt.de/v1';
// From the website bundle (`tracing.salt`); rotates occasionally — if all
// handshake-gated endpoints start returning {}, re-extract it from the app JS.
const TRACING_SALT = 'af5a8d16eb5dc49f8a72b26fd9185475c7a';
const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const limiter = new RateLimiter(600);

/**
 * Handshake: Client-Date is a seconds-precision ISO timestamp,
 * X-Client-TraceId = md5(clientDate + urlWithParams + salt),
 * X-Security = md5(clientDate as yyyyMMddHHmm).
 */
export function tracingHeaders(url: string, now: Date = new Date()): Record<string, string> {
	const clientDate = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
	const compact = clientDate.replace(/[-:TZ]/g, '').slice(0, 12);
	return {
		'Client-Date': clientDate,
		'X-Client-TraceId': md5(clientDate + url + TRACING_SALT),
		'X-Security': md5(compact)
	};
}

export interface BfRequestOptions<T> {
	params?: Record<string, string | number | boolean>;
	body?: unknown;
	schema: z.ZodType<T>;
	/** When set, the raw response is archived under this name. */
	archiveName?: string;
}

export async function bfRequest<T>(path: string, options: BfRequestOptions<T>): Promise<T> {
	const query = options.params
		? '?' +
			Object.entries(options.params)
				.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
				.join('&')
		: '';
	const url = `${BASE_URL}${path}${query}`;

	const headers: Record<string, string> = {
		accept: 'application/json',
		'user-agent': USER_AGENT,
		...tracingHeaders(url)
	};
	let body: string | undefined;
	if (options.body !== undefined) {
		body = JSON.stringify(options.body);
		headers['content-type'] = 'application/json';
	}

	const text = await fetchText(url, {
		method: options.body !== undefined ? 'POST' : 'GET',
		headers,
		body,
		limiter
	});
	if (options.archiveName) await archiveRaw(BF_SOURCE, options.archiveName, text);

	const parsed = options.schema.safeParse(JSON.parse(text));
	if (!parsed.success) {
		throw new Error(
			`unexpected boerse-frankfurt response shape for ${path}: ${parsed.error.message.slice(0, 500)}`
		);
	}
	return parsed.data;
}
