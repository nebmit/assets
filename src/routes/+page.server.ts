import { getDb } from '$lib/server/db/index.js';
import { loadFeed } from '$lib/server/feed/queries.js';
import { DEFAULT_VIEW_SLUG, isFeedViewSlug } from '$lib/feed/views.js';
import type { PageServerLoad } from './$types.js';

/**
 * SSR payload for the surfaced feed. `payload === null` with `dbError === false`
 * means no signal run exists yet (fresh install); a caught failure renders
 * the error empty-state instead of a 500.
 */
export const load: PageServerLoad = async ({ url }) => {
	try {
		const viewParam = url.searchParams.get('view');
		const selectedView = isFeedViewSlug(viewParam) ? viewParam : DEFAULT_VIEW_SLUG;
		const payload = await loadFeed(getDb(), selectedView);
		return { payload, dbError: false };
	} catch (err) {
		console.error('feed load failed', err);
		return { payload: null, dbError: true };
	}
};
