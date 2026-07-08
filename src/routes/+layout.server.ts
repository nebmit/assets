import { authConfig } from '$lib/server/auth/config.js';
import { claudeConnectorUrl } from '$lib/externalLinks.js';
import { getDb } from '$lib/server/db/index.js';
import { listIgnoredAssets } from '$lib/server/userData/ignoredAssets.js';
import type { ListEntry } from '$lib/userData/types.js';
import type { LayoutServerLoad } from './$types.js';

/**
 * The ignore list rides along with the layout so the very first server
 * render is already filtered. `null` (db hiccup) makes the client fetch it
 * instead of failing the whole page.
 */
async function loadIgnoredAssets(userUuid: string): Promise<ListEntry[] | null> {
	try {
		const entries = await listIgnoredAssets(getDb(), userUuid);
		return entries.map((e) => ({ isin: e.isin, name: e.name, addedAt: e.addedAt.toISOString() }));
	} catch (error) {
		console.error('ignored assets load failed', error);
		return null;
	}
}

// Expose the SSO sign-in state and the auth/resource origins to the UI; no
// pages are gated. Auth lives on the SSO host, and the sign-in/out links are
// built client-side (see +page.svelte) from these origins plus the live URL —
// keeping this load URL-independent so client-side navigations (view/tab
// switches) never re-run it or its ignored-assets query. RESOURCE_URL's
// origin makes the return URL correct behind a proxy regardless of the
// request origin. `connectorUrl` opens Claude's "add custom connector"
// dialog. Claude does not currently honor URL prefill params, so expose the
// canonical MCP resource URL separately for manual entry.
export const load: LayoutServerLoad = async ({ locals }) => {
	const { AUTH_ORIGIN, RESOURCE_URL } = authConfig();
	return {
		user: locals.user,
		ignoredAssets: locals.user === null ? null : await loadIgnoredAssets(locals.user.uuid),
		authOrigin: AUTH_ORIGIN,
		resourceOrigin: new URL(RESOURCE_URL).origin,
		connectorUrl: claudeConnectorUrl(RESOURCE_URL),
		connectorName: 'assets',
		mcpServerUrl: RESOURCE_URL
	};
};
