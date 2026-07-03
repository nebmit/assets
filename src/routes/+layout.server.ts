import { authConfig } from '$lib/server/auth/config.js';
import { claudeConnectorUrl } from '$lib/externalLinks.js';
import type { LayoutServerLoad } from './$types.js';

// Expose the SSO sign-in state and the sign-in/out links to the UI; no pages
// are gated. The links point at the SSO host (auth lives there, not here) and
// carry an absolute return URL back to this app, built from RESOURCE_URL's
// origin so it is correct behind a proxy regardless of the request origin.
// `connectorUrl` opens Claude's "add custom connector" dialog. Claude does not
// currently honor URL prefill params, so expose the canonical MCP resource URL
// separately for manual entry.
export const load: LayoutServerLoad = ({ locals, url }) => {
	const { AUTH_ORIGIN, RESOURCE_URL } = authConfig();
	const returnUrl = new URL(url.pathname + url.search, new URL(RESOURCE_URL).origin).href;
	const query = `?redirect_uri=${encodeURIComponent(returnUrl)}`;
	return {
		user: locals.user,
		signInUrl: `${AUTH_ORIGIN}/auth${query}`,
		signOutUrl: `${AUTH_ORIGIN}/auth/logout${query}`,
		connectorUrl: claudeConnectorUrl(RESOURCE_URL),
		connectorName: 'assets',
		mcpServerUrl: RESOURCE_URL
	};
};
