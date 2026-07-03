import { createHash } from 'node:crypto';
import type { Handle } from '@sveltejs/kit';
import { TtlCache } from '$lib/server/auth/cache.js';
import { authConfig } from '$lib/server/auth/config.js';

/**
 * Browser SSO against the timben.net SSO host: all *.timben.net apps share
 * the parent-domain `session_id` cookie, and this hook resolves it to a
 * user via the SSO introspection endpoint. Failures never block rendering —
 * pages stay public, locals.user is simply null. /mcp and the discovery
 * metadata are token-authenticated, so the hook skips them.
 */
const SKIP_PREFIXES = ['/mcp', '/.well-known/'];
const SESSION_CACHE_TTL_MS = 60_000;
const SSO_TIMEOUT_MS = 3_000;

// Keyed by sha256(session id) — raw session ids are never map keys.
const sessionCache = new TtlCache<{ uuid: string; elevated: boolean }>(1000);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;

	const pathname = event.url.pathname;
	if (!SKIP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
		const sessionId = event.cookies.get('session_id');
		if (sessionId) {
			event.locals.user = await resolveUser(sessionId);
		}
	}

	return resolve(event);
};

async function resolveUser(sessionId: string): Promise<{ uuid: string; elevated: boolean } | null> {
	const cacheKey = createHash('sha256').update(sessionId).digest('hex');
	const cached = sessionCache.get(cacheKey);
	if (cached !== undefined) return cached;

	try {
		const response = await fetch(`${authConfig().AUTH_ORIGIN}/auth/sso`, {
			headers: { authorization: `Bearer ${sessionId}` },
			signal: AbortSignal.timeout(SSO_TIMEOUT_MS)
		});
		if (!response.ok) return null;
		const data = await response.json();
		if (data?.success !== true || typeof data.user?.uuid !== 'string') return null;

		const user = { uuid: data.user.uuid, elevated: data.user.elevated === true };
		sessionCache.set(cacheKey, user, SESSION_CACHE_TTL_MS);
		return user;
	} catch (err) {
		// SSO host unreachable or slow — treat as signed out, don't break pages.
		return null;
	}
}
