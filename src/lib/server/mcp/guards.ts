import type { RateLimiter } from './rateLimit.js';

/**
 * MCP requests here are a few hundred bytes; this blocks parser-abuse
 * payloads well below adapter-node's BODY_SIZE_LIMIT (512 KB default),
 * which still covers chunked bodies that omit Content-Length.
 */
export const MAX_BODY_BYTES = 16 * 1024;

export function jsonRpcError(
	status: number,
	code: number,
	message: string,
	headers: Record<string, string> = {}
): Response {
	return Response.json(
		{ jsonrpc: '2.0', error: { code, message }, id: null },
		{
			status,
			headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }
		}
	);
}

/**
 * Abuse guards for the anonymous /mcp endpoint: per-IP rate limit, body
 * size cap, JSON content type. Returns the rejection Response, or null when
 * the request may proceed to the MCP transport.
 */
export function guardMcpRequest(limiter: RateLimiter, request: Request, clientAddress: string): Response | null {
	const decision = limiter.check(clientAddress);
	if (!decision.allowed) {
		console.warn(`mcp: rate limit exceeded for ${clientAddress}`);
		return jsonRpcError(429, -32000, 'Rate limit exceeded.', {
			'retry-after': String(decision.retryAfterSeconds)
		});
	}

	const contentLength = Number(request.headers.get('content-length') ?? '0');
	if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
		console.warn(`mcp: oversized request (${request.headers.get('content-length')} bytes) from ${clientAddress}`);
		return jsonRpcError(413, -32000, `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
	}

	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().includes('application/json')) {
		return jsonRpcError(415, -32000, 'Content-Type must be application/json.');
	}

	return null;
}
