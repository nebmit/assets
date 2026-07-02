import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getDb } from '$lib/server/db/index.js';
import { guardMcpRequest, jsonRpcError } from '$lib/server/mcp/guards.js';
import { RateLimiter } from '$lib/server/mcp/rateLimit.js';
import { buildMcpServer } from '$lib/server/mcp/server.js';
import { SessionStore } from '$lib/server/mcp/sessions.js';
import { latestRunDate, screenReport } from '$lib/server/signals/report.js';
import type { RequestHandler } from './$types.js';

/**
 * MCP Streamable HTTP endpoint (JSON responses only — no SSE). Sessions
 * are server-minted via the transport's Mcp-Session-Id on `initialize`;
 * the rate limiter keys on the session once one is established, and on the
 * client IP before that — which doubles as the session-creation limit.
 * Anonymous for now: sessions are the attachment point for the planned
 * user accounts (authenticate at initialize, bind the session to the
 * account, key limits and access on it).
 *
 * Behind a proxy, set adapter-node's ADDRESS_HEADER/XFF_DEPTH so
 * getClientAddress() (the pre-session rate-limit key) sees the real
 * client IP.
 */
const limiter = new RateLimiter(30, 60_000);
const sessions = new SessionStore(30 * 60_000, 1000);

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const sessionId = request.headers.get('mcp-session-id');
	const transport = sessionId === null ? undefined : sessions.get(sessionId);

	const callerKey = transport === undefined ? `ip:${getClientAddress()}` : `session:${sessionId}`;
	const rejection = guardMcpRequest(limiter, request, callerKey);
	if (rejection) return rejection;

	if (sessionId !== null && transport === undefined) {
		return jsonRpcError(404, -32001, 'Session not found or expired — send initialize to start a new one.');
	}
	if (transport !== undefined) {
		return withHardeningHeaders(await transport.handleRequest(request));
	}

	// no session yet: the transport only accepts `initialize` here and mints
	// the session id; per-request setup cost is just in-memory registration
	const db = getDb();
	const server = buildMcpServer({
		latestRunDate: () => latestRunDate(db),
		screenReport: (slug, runDate, top) => screenReport(db, slug, runDate, top)
	});
	const newTransport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: () => randomUUID(),
		enableJsonResponse: true,
		onsessioninitialized: (id): void => {
			sessions.set(id, newTransport);
		},
		onsessionclosed: (id) => sessions.delete(id)
	});
	await server.connect(newTransport);
	return withHardeningHeaders(await newTransport.handleRequest(request));
};

// DELETE terminates the caller's session (spec behavior for stateful servers).
export const DELETE: RequestHandler = async ({ request, getClientAddress }) => {
	const sessionId = request.headers.get('mcp-session-id');
	const transport = sessionId === null ? undefined : sessions.get(sessionId);

	const callerKey = transport === undefined ? `ip:${getClientAddress()}` : `session:${sessionId}`;
	const rejection = guardMcpRequest(limiter, request, callerKey);
	if (rejection) return rejection;

	if (sessionId === null) return jsonRpcError(400, -32000, 'Mcp-Session-Id header is required.');
	if (transport === undefined) return jsonRpcError(404, -32001, 'Session not found or expired.');
	return withHardeningHeaders(await transport.handleRequest(request));
};

// JSON-only server: no SSE stream to GET.
export const GET: RequestHandler = () =>
	jsonRpcError(405, -32000, 'Method not allowed.', { allow: 'POST, DELETE' });

function withHardeningHeaders(response: Response): Response {
	response.headers.set('cache-control', 'no-store');
	response.headers.set('x-content-type-options', 'nosniff');
	return response;
}
