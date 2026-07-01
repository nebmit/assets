import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | undefined;
let db: Db | undefined;

export function getDb(): Db {
	if (!db) {
		client = postgres(config().DATABASE_URL, { max: 5, onnotice: () => {} });
		db = drizzle(client, { schema });
	}
	return db;
}

export async function runMigrations(): Promise<void> {
	await migrate(getDb(), { migrationsFolder: './drizzle' });
}

export async function closeDb(): Promise<void> {
	await client?.end();
	client = undefined;
	db = undefined;
}

export { schema };
