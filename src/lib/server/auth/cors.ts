// CORS for the OAuth-facing endpoints (/mcp and the discovery metadata).
// A wildcard origin is safe here: authentication is bearer-token based and
// no cookies are involved.
export function corsHeaders(methods: string): Record<string, string> {
	return {
		'access-control-allow-origin': '*',
		'access-control-allow-methods': methods,
		'access-control-allow-headers':
			'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
		'access-control-expose-headers': 'Mcp-Session-Id, WWW-Authenticate',
		'access-control-max-age': '86400'
	};
}

export function withCors(response: Response, methods: string): Response {
	for (const [header, value] of Object.entries(corsHeaders(methods))) {
		response.headers.set(header, value);
	}
	return response;
}

export function corsPreflight(methods: string): Response {
	return new Response(null, { status: 204, headers: corsHeaders(methods) });
}
