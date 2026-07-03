import { sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db/index.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	try {
		await getDb().execute(sql`select 1`);
		return new Response('ok\n', {
			headers: {
				'cache-control': 'no-store',
				'content-type': 'text/plain; charset=utf-8'
			}
		});
	} catch (err) {
		console.error('health check failed', err);
		return new Response('database unavailable\n', {
			status: 503,
			headers: {
				'cache-control': 'no-store',
				'content-type': 'text/plain; charset=utf-8'
			}
		});
	}
};
