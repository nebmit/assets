import { createHash } from 'node:crypto';
import { jsonRpcError } from '../mcp/guards.js';
import { TtlCache } from './cache.js';
import { authConfig } from './config.js';

export interface AuthenticatedUser {
	uuid: string;
	scope: string;
}

export type AuthResult = { ok: true; user: AuthenticatedUser } | { ok: false; response: Response };

type Introspection =
	| { active: true; sub: string; aud: string; scope: string; expMs: number }
	| { active: false };

const POSITIVE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 10_000;
const INTROSPECT_TIMEOUT_MS = 5_000;

// Keyed by sha256(token) — raw tokens never sit in memory as map keys and
// are never logged. Entries expire with the token at the latest.
const cache = new TtlCache<Introspection>(1000);
let warnedMissingSecret = false;

/**
 * OAuth resource-server check for /mcp: validates the bearer token against
 * the authorization server's introspection endpoint (with a short cache) and
 * enforces the token's audience. The 401 challenge carries the RFC 9728
 * resource_metadata pointer MCP clients use to bootstrap their OAuth flow.
 */
export async function authenticateBearer(request: Request): Promise<AuthResult> {
	const config = authConfig();

	const header = request.headers.get('authorization');
	if (header === null || !header.startsWith('Bearer ')) {
		return { ok: false, response: challenge(401, undefined, 'Authentication required.') };
	}
	const token = header.slice('Bearer '.length);

	if (config.INTROSPECTION_SECRET === '') {
		if (!warnedMissingSecret) {
			console.warn('auth: INTROSPECTION_SECRET is not set — all /mcp requests will be rejected');
			warnedMissingSecret = true;
		}
		return { ok: false, response: challenge(401, 'invalid_token', 'Authentication is not configured.') };
	}

	const cacheKey = sha256hex(token);
	let introspection = cache.get(cacheKey);
	if (introspection === undefined) {
		const fetched = await introspect(token, config.AUTH_ORIGIN, config.INTROSPECTION_SECRET);
		if (fetched instanceof Response) {
			return { ok: false, response: fetched };
		}
		introspection = fetched;
		const ttl = introspection.active
			? Math.min(POSITIVE_TTL_MS, introspection.expMs - Date.now())
			: NEGATIVE_TTL_MS;
		if (ttl > 0) cache.set(cacheKey, introspection, ttl);
	}

	if (!introspection.active || introspection.expMs <= Date.now()) {
		return { ok: false, response: challenge(401, 'invalid_token', 'Token is invalid or expired.') };
	}
	if (introspection.aud !== config.RESOURCE_URL) {
		return {
			ok: false,
			response: challenge(403, 'invalid_token', 'Token was not issued for this resource.')
		};
	}

	return { ok: true, user: { uuid: introspection.sub, scope: introspection.scope } };
}

async function introspect(token: string, authOrigin: string, secret: string): Promise<Introspection | Response> {
	let response: Response;
	try {
		response = await fetch(`${authOrigin}/auth/oauth/introspect`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${secret}`,
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: `token=${encodeURIComponent(token)}`,
			signal: AbortSignal.timeout(INTROSPECT_TIMEOUT_MS)
		});
	} catch (err) {
		console.error('auth: introspection request failed', err);
		// The IdP being down is not the client's fault — don't claim the
		// token is bad.
		return jsonRpcError(503, -32000, 'Authorization server unreachable.');
	}
	if (!response.ok) {
		console.error(`auth: introspection returned ${response.status}`);
		return jsonRpcError(503, -32000, 'Token validation failed upstream.');
	}

	let data: Record<string, unknown>;
	try {
		data = await response.json();
	} catch (err) {
		console.error('auth: introspection returned malformed JSON', err);
		return jsonRpcError(503, -32000, 'Token validation failed upstream.');
	}

	if (
		data.active === true &&
		typeof data.sub === 'string' &&
		typeof data.aud === 'string' &&
		typeof data.exp === 'number'
	) {
		return {
			active: true,
			sub: data.sub,
			aud: data.aud,
			scope: typeof data.scope === 'string' ? data.scope : '',
			expMs: data.exp * 1000
		};
	}
	return { active: false };
}

function challenge(status: number, error: string | undefined, description: string): Response {
	const metadataUrl = `${new URL(authConfig().RESOURCE_URL).origin}/.well-known/oauth-protected-resource`;
	const parts = [`resource_metadata="${metadataUrl}"`];
	if (error !== undefined) {
		parts.unshift(`error="${error}", error_description="${description}"`);
	}
	return jsonRpcError(status, -32001, description, {
		'www-authenticate': `Bearer ${parts.join(', ')}`
	});
}

function sha256hex(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
