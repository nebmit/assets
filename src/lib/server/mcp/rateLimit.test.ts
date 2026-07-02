import { describe, expect, it, vi } from 'vitest';
import { guardMcpRequest, jsonRpcError, MAX_BODY_BYTES } from './guards.js';
import { RateLimiter } from './rateLimit.js';

function makeClock(start = 0) {
	let time = start;
	return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe('RateLimiter', () => {
	it('allows up to the limit and blocks the next request', () => {
		const clock = makeClock();
		const limiter = new RateLimiter(3, 60_000, clock.now);
		for (let i = 0; i < 3; i++) {
			expect(limiter.check('ip')).toEqual({ allowed: true, retryAfterSeconds: 0 });
		}
		const blocked = limiter.check('ip');
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSeconds).toBe(60);
	});

	it('tracks keys independently', () => {
		const clock = makeClock();
		const limiter = new RateLimiter(1, 60_000, clock.now);
		expect(limiter.check('a').allowed).toBe(true);
		expect(limiter.check('a').allowed).toBe(false);
		expect(limiter.check('b').allowed).toBe(true);
	});

	it('counts down retry-after within the window and resets after it', () => {
		const clock = makeClock();
		const limiter = new RateLimiter(1, 60_000, clock.now);
		limiter.check('ip');
		clock.advance(45_500);
		expect(limiter.check('ip')).toEqual({ allowed: false, retryAfterSeconds: 15 });
		clock.advance(14_500);
		expect(limiter.check('ip').allowed).toBe(true);
	});

	it('evicts expired and oldest keys instead of growing unboundedly', () => {
		const clock = makeClock();
		const limiter = new RateLimiter(1, 60_000, clock.now, 3);
		limiter.check('a');
		clock.advance(61_000);
		limiter.check('b');
		limiter.check('c');
		// map is at cap; 'a' is expired and gets pruned, so 'd' fits
		limiter.check('d');
		// cap reached again with live keys: least-recently-seen ('b') is evicted,
		// so its window restarts instead of blocking
		limiter.check('e');
		expect(limiter.check('b').allowed).toBe(true);
	});
});

describe('guardMcpRequest', () => {
	function makeRequest(headers: Record<string, string>): Request {
		return new Request('http://localhost/mcp', { method: 'POST', headers });
	}
	const jsonHeaders = { 'content-type': 'application/json', 'content-length': '120' };

	it('lets a normal request through', () => {
		const limiter = new RateLimiter(30, 60_000);
		expect(guardMcpRequest(limiter, makeRequest(jsonHeaders), '1.2.3.4')).toBeNull();
	});

	it('returns 429 with retry-after when the caller is over the limit', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const limiter = new RateLimiter(1, 60_000);
		guardMcpRequest(limiter, makeRequest(jsonHeaders), '1.2.3.4');
		const rejection = guardMcpRequest(limiter, makeRequest(jsonHeaders), '1.2.3.4');
		expect(rejection?.status).toBe(429);
		expect(Number(rejection?.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(await rejection?.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } });
		vi.restoreAllMocks();
	});

	it('rejects oversized bodies with 413', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const limiter = new RateLimiter(30, 60_000);
		const request = makeRequest({
			'content-type': 'application/json',
			'content-length': String(MAX_BODY_BYTES + 1)
		});
		expect(guardMcpRequest(limiter, request, '1.2.3.4')?.status).toBe(413);
		vi.restoreAllMocks();
	});

	it('rejects non-JSON content types with 415', () => {
		const limiter = new RateLimiter(30, 60_000);
		const request = makeRequest({ 'content-type': 'text/plain', 'content-length': '10' });
		expect(guardMcpRequest(limiter, request, '1.2.3.4')?.status).toBe(415);
	});

	it('builds JSON-RPC error responses with hardening headers', async () => {
		const response = jsonRpcError(405, -32000, 'Method not allowed.', { allow: 'POST' });
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('POST');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(await response.json()).toMatchObject({ error: { message: 'Method not allowed.' } });
	});
});
