/**
 * The signed-in user's ignored assets. Plaintext by design (unlike the
 * encrypted watchlist blob): the server must read this list to filter the
 * MCP signal tools. GET lists, POST adds idempotently (re-adding refreshes
 * the name snapshot); removal lives at ./[isin].
 */

import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { addIgnoredAsset, listIgnoredAssets } from '$lib/server/userData/ignoredAssets.js';
import type { RequestHandler } from './$types.js';

const NO_STORE = { 'cache-control': 'no-store' };
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const MAX_NAME_LENGTH = 200;

function toWire(entry: { isin: string; name: string; addedAt: Date }) {
	return { isin: entry.isin, name: entry.name, addedAt: entry.addedAt.toISOString() };
}

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.user === null) {
		return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
	}
	const entries = await listIgnoredAssets(getDb(), locals.user.uuid);
	return json({ entries: entries.map(toWire) }, { headers: NO_STORE });
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
	const { isin, name } = (body ?? {}) as Record<string, unknown>;
	if (typeof isin !== 'string' || !ISIN_PATTERN.test(isin)) {
		return json({ error: 'invalid isin' }, { status: 400, headers: NO_STORE });
	}
	if (typeof name !== 'string' || name === '' || name.length > MAX_NAME_LENGTH) {
		return json({ error: 'invalid name' }, { status: 400, headers: NO_STORE });
	}
	const entry = await addIgnoredAsset(getDb(), locals.user.uuid, isin, name);
	return json({ entry: toWire(entry) }, { status: 201, headers: NO_STORE });
};
