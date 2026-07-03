import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticateBearer } from '$lib/server/auth/bearer.js';
import { corsPreflight, withCors } from '$lib/server/auth/cors.js';
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
 *
 * Every request must carry an OAuth bearer token issued by the timben.net
 * authorization server for this resource (validated per request via cached
 * introspection, see $lib/server/auth/bearer). Sessions are bound to the
 * account that initialized them, so a token for a different account cannot
 * ride an existing session, and a revoked token stops working within the
 * introspection cache TTL. Anonymous requests get the 401 challenge MCP
 * clients use to discover the OAuth endpoints.
 *
 * Behind a proxy, set adapter-node's ADDRESS_HEADER/XFF_DEPTH so
 * getClientAddress() (the pre-session rate-limit key) sees the real
 * client IP.
 */
const MCP_METHODS = 'POST, DELETE, OPTIONS';
const limiter = new RateLimiter(30, 60_000);
const sessions = new SessionStore(30 * 60_000, 1000);

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const sessionId = request.headers.get('mcp-session-id');
	const session = sessionId === null ? undefined : sessions.get(sessionId);

	const callerKey = session === undefined ? `ip:${getClientAddress()}` : `session:${sessionId}`;
	const rejection = guardMcpRequest(limiter, request, callerKey);
	if (rejection) return finalize(rejection);

	const auth = await authenticateBearer(request);
	if (!auth.ok) return finalize(auth.response);

	if (sessionId !== null && session === undefined) {
		return finalize(jsonRpcError(404, -32001, 'Session not found or expired — send initialize to start a new one.'));
	}
	if (session !== undefined) {
		if (session.userUuid !== auth.user.uuid) {
			return finalize(jsonRpcError(401, -32001, 'Session belongs to a different account.'));
		}
		return finalize(await session.transport.handleRequest(request));
	}

	// no session yet: the transport only accepts `initialize` here and mints
	// the session id, which gets bound to the authenticated account
	const db = getDb();
	const server = buildMcpServer({
		latestRunDate: () => latestRunDate(db),
		screenReport: (slug, runDate, top) => screenReport(db, slug, runDate, top)
	});
	const userUuid = auth.user.uuid;
	const newTransport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: () => randomUUID(),
		enableJsonResponse: true,
		onsessioninitialized: (id): void => {
			sessions.set(id, newTransport, userUuid);
		},
		onsessionclosed: (id) => sessions.delete(id)
	});
	await server.connect(newTransport);
	return finalize(await newTransport.handleRequest(request));
};

// DELETE terminates the caller's session (spec behavior for stateful servers).
export const DELETE: RequestHandler = async ({ request, getClientAddress }) => {
	const sessionId = request.headers.get('mcp-session-id');
	const session = sessionId === null ? undefined : sessions.get(sessionId);

	const callerKey = session === undefined ? `ip:${getClientAddress()}` : `session:${sessionId}`;
	const rejection = guardMcpRequest(limiter, request, callerKey);
	if (rejection) return finalize(rejection);

	const auth = await authenticateBearer(request);
	if (!auth.ok) return finalize(auth.response);

	if (sessionId === null) return finalize(jsonRpcError(400, -32000, 'Mcp-Session-Id header is required.'));
	if (session === undefined) return finalize(jsonRpcError(404, -32001, 'Session not found or expired.'));
	if (session.userUuid !== auth.user.uuid) {
		return finalize(jsonRpcError(401, -32001, 'Session belongs to a different account.'));
	}
	return finalize(await session.transport.handleRequest(request));
};

// JSON-only server: no SSE stream to GET.
export const GET: RequestHandler = () =>
	finalize(jsonRpcError(405, -32000, 'Method not allowed.', { allow: MCP_METHODS }));

export const OPTIONS: RequestHandler = () => corsPreflight(MCP_METHODS);

function finalize(response: Response): Response {
	response.headers.set('cache-control', 'no-store');
	response.headers.set('x-content-type-options', 'nosniff');
	return withCors(response, MCP_METHODS);
}
