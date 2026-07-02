import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getDb } from '$lib/server/db/index.js';
import { guardMcpRequest, jsonRpcError } from '$lib/server/mcp/guards.js';
import { RateLimiter } from '$lib/server/mcp/rateLimit.js';
import { buildMcpServer } from '$lib/server/mcp/server.js';
import { latestRunDate, screenReport } from '$lib/server/signals/report.js';
import type { RequestHandler } from './$types.js';

/**
 * MCP Streamable HTTP endpoint (stateless, JSON responses only — no SSE,
 * no sessions). Anonymous by design: it serves the same read-only signal
 * data as the public screener page, guarded by rate limiting and request
 * caps. If the data ever stops being public, a bearer-token check at the
 * top of POST is the single insertion point.
 *
 * Behind a proxy, set adapter-node's ADDRESS_HEADER/XFF_DEPTH so
 * getClientAddress() (the rate-limit key) sees the real client IP.
 */
const limiter = new RateLimiter(30, 60_000);

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const rejection = guardMcpRequest(limiter, request, getClientAddress());
	if (rejection) return rejection;

	const db = getDb();
	const server = buildMcpServer({
		latestRunDate: () => latestRunDate(db),
		screenReport: (slug, runDate, top) => screenReport(db, slug, runDate, top)
	});
	// per-request server + transport is the SDK's stateless pattern; in JSON
	// mode the response is fully materialized, so nothing needs closing
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await server.connect(transport);

	const response = await transport.handleRequest(request);
	response.headers.set('cache-control', 'no-store');
	response.headers.set('x-content-type-options', 'nosniff');
	return response;
};

// Stateless and JSON-only: no SSE stream to GET, no session to DELETE.
const methodNotAllowed: RequestHandler = () =>
	jsonRpcError(405, -32000, 'Method not allowed.', { allow: 'POST' });

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
