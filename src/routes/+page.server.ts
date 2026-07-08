import { getDb } from '$lib/server/db/index.js';
import { getFeedPayload } from '$lib/server/feed/cache.js';
import type { PageServerLoad } from './$types.js';

/**
 * SSR payload for the surfaced feed — all views in one cached payload, so
 * this load has no URL dependency and view switches never re-run it.
 * `payload === null` with `dbError === false` means no signal run exists yet
 * (fresh install); a caught failure renders the error empty-state instead of
 * a 500.
 */
export const load: PageServerLoad = async () => {
	try {
		const payload = await getFeedPayload(getDb());
		return { payload, dbError: false };
	} catch (err) {
		console.error('feed load failed', err);
		return { payload: null, dbError: true };
	}
};
