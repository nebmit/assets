/**
 * Wrapped-DEK storage for the passkey-encrypted user data (see
 * src/lib/crypto/README.md). Gated on the SSO session cookie resolved in
 * hooks.server.ts; note that hook caches SSO lookups for 60s, so a cookie
 * can be honored here for up to a minute after logout at core — the data is
 * ciphertext owned by that same user, so nothing leaks.
 */

import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { insertKeyWrap, listKeyWraps } from '$lib/server/userData/repo.js';
import {
	MAX_WRAPPED_DEK_LENGTH,
	isValidCredentialId,
	isValidEnvelopeBlob,
	isValidPurpose
} from '$lib/server/userData/validate.js';
import type { RequestHandler } from './$types.js';

const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = async ({ locals, url }) => {
	if (locals.user === null) {
		return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
	}
	const purpose = url.searchParams.get('purpose');
	if (!isValidPurpose(purpose)) {
		return json({ error: 'invalid purpose' }, { status: 400, headers: NO_STORE });
	}
	const wraps = await listKeyWraps(getDb(), locals.user.uuid, purpose);
	return json({ purpose, wraps }, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (locals.user === null) {
		return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid json' }, { status: 400, headers: NO_STORE });
	}
	const { purpose, credentialId, wrappedDek } = (body ?? {}) as Record<string, unknown>;
	if (!isValidPurpose(purpose)) {
		return json({ error: 'invalid purpose' }, { status: 400, headers: NO_STORE });
	}
	if (!isValidCredentialId(credentialId)) {
		return json({ error: 'invalid credentialId' }, { status: 400, headers: NO_STORE });
	}
	if (!isValidEnvelopeBlob(wrappedDek, MAX_WRAPPED_DEK_LENGTH)) {
		return json({ error: 'invalid wrappedDek' }, { status: 400, headers: NO_STORE });
	}

	const result = await insertKeyWrap(getDb(), {
		userUuid: locals.user.uuid,
		purpose,
		credentialId,
		wrappedDek
	});
	if (result.created) {
		return json({ created: true }, { status: 201, headers: NO_STORE });
	}
	// A wrap already exists for this passkey (e.g. two tabs bootstrapped at
	// once). Hand the authoritative wrap back so the caller adopts that DEK.
	return json({ created: false, wrappedDek: result.wrappedDek }, { headers: NO_STORE });
};
