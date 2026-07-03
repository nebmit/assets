import { z } from 'zod';

// Auth wiring against the timben.net SSO / authorization server. Kept apart
// from config.ts, which is pipeline-scoped and shared with the worker.
const envSchema = z.object({
	/** Origin of the SSO host / OAuth authorization server. */
	AUTH_ORIGIN: z
		.string()
		.url()
		.default('http://localhost:5172')
		.transform((value) => value.replace(/\/+$/, '')),
	/** This server's canonical RFC 8707 resource identifier (token audience). */
	RESOURCE_URL: z.string().url().default('http://localhost:5173/mcp'),
	/**
	 * Shared secret for the authorization server's introspection endpoint.
	 * Empty means every token check fails — /mcp stays 401-closed.
	 */
	INTROSPECTION_SECRET: z.string().default('')
});

export type AuthConfig = z.infer<typeof envSchema>;

let cached: AuthConfig | undefined;

export function authConfig(): AuthConfig {
	cached ??= envSchema.parse(process.env);
	return cached;
}
