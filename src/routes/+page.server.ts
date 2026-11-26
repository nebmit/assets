import { assetCatalog } from '$lib/server/assets/catalog.js';
import { getDb } from '$lib/server/db/index.js';
import { getFeedPayload } from '$lib/server/feed/cache.js';
import { config } from '$lib/server/config.js';
import { isoDate, snapshotFreshness } from '$lib/server/util.js';
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
		const freshness = payload ? snapshotFreshness(payload.runDate, isoDate(new Date(), config().TZ)) : null;
				return { payload, freshness, catalog: await assetCatalog(getDb()), dbError: false };
	} catch (err) {
		console.error('feed load failed', err);
		return { payload: null, freshness: null, catalog: [], dbError: true };
	}
};
