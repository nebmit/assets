import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AUTH_ORIGIN = 'http://idp.test';
const RESOURCE_URL = 'http://rs.test/mcp';

function introspectionResponse(body: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function activeIntrospection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		active: true,
		sub: 'user-1',
		aud: RESOURCE_URL,
		scope: 'mcp',
		exp: Math.floor(Date.now() / 1000) + 3600,
		...overrides
	};
}

function requestWithToken(token?: string): Request {
	const headers: Record<string, string> = {};
	if (token !== undefined) headers.authorization = `Bearer ${token}`;
	return new Request('http://rs.test/mcp', { method: 'POST', headers });
}

async function loadBearer() {
	// bearer.ts and config.ts hold module-level caches; a fresh import per
	// test isolates both the env snapshot and the token cache.
	const module = await import('./bearer.js');
	return module.authenticateBearer;
}

describe('authenticateBearer', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv('AUTH_ORIGIN', AUTH_ORIGIN);
		vi.stubEnv('RESOURCE_URL', RESOURCE_URL);
		vi.stubEnv('INTROSPECTION_SECRET', 'test-secret');
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('rejects a missing bearer token with a 401 challenge naming the resource metadata', async () => {
		const authenticateBearer = await loadBearer();
		const result = await authenticateBearer(requestWithToken());
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(401);
		expect(result.response.headers.get('www-authenticate')).toContain(
			'resource_metadata="http://rs.test/.well-known/oauth-protected-resource"'
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects everything without calling the IdP when the secret is unset', async () => {
		vi.stubEnv('INTROSPECTION_SECRET', '');
		const authenticateBearer = await loadBearer();
		const result = await authenticateBearer(requestWithToken('some-token'));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects an inactive token with 401 invalid_token', async () => {
		fetchMock.mockResolvedValue(introspectionResponse({ active: false }));
		const authenticateBearer = await loadBearer();
		const result = await authenticateBearer(requestWithToken('bad-token'));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(401);
		expect(result.response.headers.get('www-authenticate')).toContain('error="invalid_token"');
	});

	it('rejects a token for a different resource with 403', async () => {
		fetchMock.mockResolvedValue(
			introspectionResponse(activeIntrospection({ aud: 'http://other.test/mcp' }))
		);
		const authenticateBearer = await loadBearer();
		const result = await authenticateBearer(requestWithToken('foreign-token'));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(403);
	});

	it('accepts a valid token and returns the account', async () => {
		fetchMock.mockResolvedValue(introspectionResponse(activeIntrospection()));
		const authenticateBearer = await loadBearer();
		const result = await authenticateBearer(requestWithToken('good-token'));
		expect(result).toEqual({ ok: true, user: { uuid: 'user-1', scope: 'mcp' } });

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${AUTH_ORIGIN}/auth/oauth/introspect`);
		expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-secret');
	});

	it('serves repeated checks of the same token from cache', async () => {
		fetchMock.mockResolvedValue(introspectionResponse(activeIntrospection()));
		const authenticateBearer = await loadBearer();
		await authenticateBearer(requestWithToken('good-token'));
		const second = await authenticateBearer(requestWithToken('good-token'));
		expect(second.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not blame the token when the IdP is down', async () => {
		fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
		const authenticateBearer = await loadBearer();
		const result = await authenticateBearer(requestWithToken('good-token'));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(503);
	});

	it('treats upstream introspection errors as unavailability, not invalid tokens', async () => {
		fetchMock.mockResolvedValue(introspectionResponse({ error: 'boom' }, 500));
		const authenticateBearer = await loadBearer();
		const result = await authenticateBearer(requestWithToken('good-token'));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.response.status).toBe(503);
	});
});
