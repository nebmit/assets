import { authConfig } from '$lib/server/auth/config.js';
import { corsPreflight, withCors } from '$lib/server/auth/cors.js';
import type { RequestHandler } from '@sveltejs/kit';

// RFC 9728 protected-resource metadata: tells MCP clients which
// authorization server issues tokens for this resource.
export const GET: RequestHandler = () => {
	const config = authConfig();
	return withCors(
		Response.json(
			{
				resource: config.RESOURCE_URL,
				authorization_servers: [config.AUTH_ORIGIN],
				bearer_methods_supported: ['header'],
				scopes_supported: ['mcp'],
				resource_name: 'assets signals MCP'
			},
			{ headers: { 'cache-control': 'public, max-age=3600' } }
		),
		'GET, OPTIONS'
	);
};

export const OPTIONS: RequestHandler = () => corsPreflight('GET, OPTIONS');
