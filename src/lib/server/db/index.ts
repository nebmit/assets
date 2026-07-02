import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
	db: Db;
	sql: postgres.Sql;
}

export function createDb(url: string): DbHandle {
	const sql = postgres(url, { max: 5, onnotice: () => {} });
	return { db: drizzle(sql, { schema }), sql };
}

export async function migrateDb(db: Db, migrationsFolder = './drizzle'): Promise<void> {
	await migrate(db, { migrationsFolder });
}

let handle: DbHandle | undefined;

export function getDb(): Db {
	handle ??= createDb(config().DATABASE_URL);
	return handle.db;
}

export async function runMigrations(): Promise<void> {
	await migrateDb(getDb());
}

export async function closeDb(): Promise<void> {
	await handle?.sql.end();
	handle = undefined;
}

export { schema };
