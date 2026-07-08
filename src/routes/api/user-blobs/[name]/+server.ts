/**
 * Named client-side-encrypted documents per user. The server round-trips
 * ciphertext and arbitrates concurrency (version compare-and-swap); it can
 * never read the contents. `name` is allowlisted so the table doesn't
 * become a dumping ground — extend the list when a new document ships.
 */

import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { getBlob, putBlob } from '$lib/server/userData/repo.js';
import { MAX_CIPHERTEXT_LENGTH, isValidEnvelopeBlob } from '$lib/server/userData/validate.js';
import type { RequestHandler } from './$types.js';

const KNOWN_NAMES = new Set(['watchlist']);
const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = async ({ locals, params }) => {
	if (locals.user === null) {
		return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
	}
	if (!KNOWN_NAMES.has(params.name)) {
		return json({ error: 'unknown blob' }, { status: 404, headers: NO_STORE });
	}
	const blob = await getBlob(getDb(), locals.user.uuid, params.name);
	if (blob === null) {
		return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
	}
	return json(
		{
			name: params.name,
			ciphertext: blob.ciphertext,
			version: blob.version,
			updatedAt: blob.updatedAt.toISOString()
		},
		{ headers: NO_STORE }
	);
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (locals.user === null) {
		return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
	}
	if (!KNOWN_NAMES.has(params.name)) {
		return json({ error: 'unknown blob' }, { status: 404, headers: NO_STORE });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid json' }, { status: 400, headers: NO_STORE });
	}
	const { ciphertext, baseVersion } = (body ?? {}) as Record<string, unknown>;
	if (typeof ciphertext === 'string' && ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
		return json({ error: 'ciphertext too large' }, { status: 413, headers: NO_STORE });
	}
	if (!isValidEnvelopeBlob(ciphertext, MAX_CIPHERTEXT_LENGTH)) {
		return json({ error: 'invalid ciphertext' }, { status: 400, headers: NO_STORE });
	}
	if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
		return json({ error: 'invalid baseVersion' }, { status: 400, headers: NO_STORE });
	}

	const result = await putBlob(getDb(), locals.user.uuid, params.name, ciphertext, baseVersion);
	if (result.ok) {
		return json(
			{ version: result.version },
			{ status: baseVersion === 0 ? 201 : 200, headers: NO_STORE }
		);
	}
	if (result.current === null) {
		// Stale update against a row that no longer exists (never deleted in
		// practice today); tell the client to restart from scratch.
		return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
	}
	// Version conflict: return the winning ciphertext so the client can
	// decrypt, merge its pending ops, and retry in one round-trip.
	return json(
		{
			error: 'conflict',
			ciphertext: result.current.ciphertext,
			version: result.current.version
		},
		{ status: 409, headers: NO_STORE }
	);
};
