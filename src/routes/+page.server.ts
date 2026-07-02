import { getDb } from '$lib/server/db/index.js';
import { loadScreener } from '$lib/server/screener/queries.js';
import type { PageServerLoad } from './$types.js';

/**
 * SSR payload for the screener. `payload === null` with `dbError === false`
 * means no signal run exists yet (fresh install); a caught failure renders
 * the error empty-state instead of a 500.
 */
export const load: PageServerLoad = async () => {
	try {
		const payload = await loadScreener(getDb());
		return { payload, dbError: false };
	} catch (err) {
		console.error('screener load failed', err);
		return { payload: null, dbError: true };
	}
};
