import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { removeIgnoredAsset } from '$lib/server/userData/ignoredAssets.js';
import type { RequestHandler } from './$types.js';

const NO_STORE = { 'cache-control': 'no-store' };

/** Un-ignores an asset; idempotent (deleting a non-row is still a 204). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (locals.user === null) {
		return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
	}
	await removeIgnoredAsset(getDb(), locals.user.uuid, params.isin);
	return new Response(null, { status: 204, headers: NO_STORE });
};
