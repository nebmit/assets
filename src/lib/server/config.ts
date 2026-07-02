import { z } from 'zod';

// Pipeline code must stay free of SvelteKit-only imports ($env/*) so the
// worker can run as a standalone bundle; all configuration enters here.
const envSchema = z.object({
	DATABASE_URL: z.string().url().default('postgres://assets:assets@localhost:5432/assets'),
	RAW_DATA_DIR: z.string().default('./data/raw'),
	INGEST_CRON: z.string().default('30 6 * * *'),
	TZ: z.string().default('Europe/Berlin')
});

export type Config = z.infer<typeof envSchema>;

let cached: Config | undefined;

export function config(): Config {
	cached ??= envSchema.parse(process.env);
	return cached;
}
