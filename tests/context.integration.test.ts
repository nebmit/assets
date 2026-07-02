import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DbHandle } from '../src/lib/server/db/index.js';
import {
	eodPrice,
	fundamental,
	indexMembership,
	insiderTransaction,
	instrument,
	issuer
} from '../src/lib/server/db/schema.js';
import { buildContext } from '../src/lib/server/signals/context.js';

/**
 * Requires a Postgres at TEST_DATABASE_URL (dropped/recreated content!).
 * Skipped when the variable is unset so unit runs stay DB-free.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('buildContext (integration)', () => {
	let handle: DbHandle;
	const RUN_DATE = '2026-07-02';

	beforeAll(async () => {
		handle = createDb(url as string);
		await handle.db.execute(sql`drop schema public cascade; create schema public;`);
		await handle.db.execute(sql`drop schema if exists drizzle cascade;`);
		await migrateDb(handle.db);

		const [iss] = await handle.db.insert(issuer).values({ name: 'Test AG', sector: 'Software' }).returning();
		const [inst] = await handle.db
			.insert(instrument)
			.values({ issuerId: iss.id, isin: 'DE0000000001', ticker: 'TST', firstSeen: '2026-01-01', lastSeen: RUN_DATE })
			.returning();
		await handle.db
			.insert(indexMembership)
			.values({ instrumentId: inst.id, indexName: 'DAX', validFrom: '2026-01-01' });
		await handle.db.insert(eodPrice).values([
			{ instrumentId: inst.id, tradeDate: '2026-06-30', close: '90' },
			{ instrumentId: inst.id, tradeDate: '2026-07-01', close: '100' },
			// future price must not leak into a 07-02 run
			{ instrumentId: inst.id, tradeDate: '2026-07-03', close: '999' }
		]);
		await handle.db.insert(fundamental).values([
			{ issuerId: iss.id, metric: 'eps_basic', value: '5', periodEnd: '2026-06-01', publishedDate: '2026-06-01', source: 'boerse_frankfurt' },
			// newer value but published after the run date: lookahead, must be ignored
			{ issuerId: iss.id, metric: 'eps_basic', value: '8', periodEnd: '2026-07-03', publishedDate: '2026-07-03', source: 'boerse_frankfurt' }
		]);
		await handle.db.insert(insiderTransaction).values([
			{
				issuerId: iss.id,
				issuerNameRaw: 'Test AG',
				side: 'buy',
				partyRole: 'executive_board',
				amount: '50000',
				transactionDate: '2026-06-25',
				publishedDate: '2026-06-26',
				naturalKeyHash: 'visible'
			},
			{
				// transacted inside the window but published after run date: no lookahead
				issuerId: iss.id,
				issuerNameRaw: 'Test AG',
				side: 'buy',
				partyRole: 'executive_board',
				amount: '99999',
				transactionDate: '2026-07-01',
				publishedDate: '2026-07-03',
				naturalKeyHash: 'lookahead'
			},
			{
				// outside the 30-day transaction window
				issuerId: iss.id,
				issuerNameRaw: 'Test AG',
				side: 'buy',
				partyRole: 'executive_board',
				amount: '11111',
				transactionDate: '2026-05-01',
				publishedDate: '2026-05-02',
				naturalKeyHash: 'too_old'
			}
		]);
	});

	afterAll(async () => {
		await handle?.sql.end();
	});

	it('builds a point-in-time view without lookahead', async () => {
		const ctx = await buildContext(handle.db, RUN_DATE);
		expect(ctx.instruments).toHaveLength(1);
		const [inst] = ctx.instruments;
		expect(inst.close).toBe(100);
		expect(inst.closeDate).toBe('2026-07-01');
		expect(inst.epsBasic).toBe(5);
		expect(inst.insiderTx).toHaveLength(1);
		expect(inst.insiderTx[0].amount).toBe(50000);
	});

	it('sees the later data once the run date passes it', async () => {
		const ctx = await buildContext(handle.db, '2026-07-04');
		const [inst] = ctx.instruments;
		expect(inst.close).toBe(999);
		expect(inst.epsBasic).toBe(8);
		expect(inst.insiderTx.map((t) => t.amount).sort()).toEqual([50000, 99999]);
	});
});
