import { getDb } from '$lib/server/db/index.js';
import { loadScreener } from '$lib/server/screener/queries.js';
import { DEFAULT_SCREEN_SLUG, isScreenerScreenSlug } from '$lib/screener/screens.js';
import type { PageServerLoad } from './$types.js';

/**
 * SSR payload for the screener. `payload === null` with `dbError === false`
 * means no signal run exists yet (fresh install); a caught failure renders
 * the error empty-state instead of a 500.
 */
export const load: PageServerLoad = async ({ url }) => {
	try {
		const screenParam = url.searchParams.get('screen');
		const selectedScreen = isScreenerScreenSlug(screenParam) ? screenParam : DEFAULT_SCREEN_SLUG;
		const payload = await loadScreener(getDb(), selectedScreen);
		return { payload, dbError: false };
	} catch (err) {
		console.error('screener load failed', err);
		return { payload: null, dbError: true };
	}
};
