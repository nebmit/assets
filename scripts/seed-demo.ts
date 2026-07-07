/**
 * Dev-only demo seed for the feed UI. DESTRUCTIVE: drops and recreates
 * the public schema of DATABASE_URL, inserts a realistic 9-name universe
 * (prices, fundamentals, insider dealings, news), then runs the real signal
 * engine for two consecutive dates (so lifecycle badges render) — signal
 * rows come from production code, not hand-faked values. The cast is chosen
 * to exercise the feed semantics: names surfacing on insider evidence alone,
 * on value alone, on both (noisy-or), and a token courtesy buy that stays
 * below the materiality floor and must NOT surface.
 *
 *   docker compose up -d postgres && npm run seed:demo && npm run dev
 */
import { sql } from 'drizzle-orm';
import { closeDb, getDb, migrateDb } from '../src/lib/server/db/index.js';
import {
	eodPrice,
	fundamental,
	indexMembership,
	insiderTransaction,
	instrument,
	issuer,
	newsItem
} from '../src/lib/server/db/schema.js';
import { runSignals } from '../src/lib/server/signals/engine.js';

const RUN_DATE = '2026-07-01';

interface DemoInsider {
	daysAgo: number;
	who: string;
	role: 'executive_board' | 'supervisory_board' | 'related_party' | 'other';
	side: 'buy' | 'sell' | 'other';
	amount: number;
}

interface DemoNews {
	daysAgo: number;
	type: string;
	headline: string;
}

interface DemoCompany {
	name: string;
	sector: string;
	isin: string;
	wkn: string;
	ticker: string;
	/** Target close at the run date; the walk is scaled to land here. */
	price: number;
	eps: number;
	marketCap: number;
	/** Dividend per share (EUR); feeds the value signal's yield bonus. */
	dividend?: number;
	drift: number;
	seed: number;
	insiders: DemoInsider[];
	news: DemoNews[];
}

const COMPANIES: DemoCompany[] = [
	{
		// Insider cluster (2 buyers in window) at a rich P/E: insider-only surface.
		name: 'SAP SE', sector: 'Software', isin: 'DE0007164600', wkn: '716460', ticker: 'SAP',
		price: 245.8, eps: 5.84, marketCap: 2.87e11, dividend: 2.2, drift: 0.0009, seed: 7,
		insiders: [
			{ daysAgo: 19, who: 'Julia White', role: 'supervisory_board', side: 'buy', amount: 1_240_000 },
			{ daysAgo: 27, who: 'C. Klein', role: 'executive_board', side: 'buy', amount: 2_800_000 },
			{ daysAgo: 43, who: 'D. Saul', role: 'executive_board', side: 'buy', amount: 640_000 }
		],
		news: [
			{ daysAgo: 4, type: 'Ad-hoc', headline: 'Raised FY26 cloud revenue guidance' },
			{ daysAgo: 12, type: 'Voting rights', headline: 'Norges Bank crossed 3% threshold' },
			{ daysAgo: 33, type: 'Corporate', headline: 'Completed WalkMe integration ahead of plan' }
		]
	},
	{
		name: 'Rheinmetall AG', sector: 'Defense', isin: 'DE0007030009', wkn: '703000', ticker: 'RHM',
		price: 498.2, eps: 14.4, marketCap: 2.2e10, drift: 0.0028, seed: 20,
		insiders: [
			{ daysAgo: 28, who: 'A. Müller', role: 'executive_board', side: 'buy', amount: 820_000 },
			{ daysAgo: 35, who: 'A. Papperger', role: 'executive_board', side: 'buy', amount: 3_100_000 },
			{ daysAgo: 60, who: 'K. Adam', role: 'supervisory_board', side: 'buy', amount: 410_000 }
		],
		news: [
			{ daysAgo: 7, type: 'Corporate', headline: 'New EUR 8.5bn framework order signed' },
			{ daysAgo: 19, type: 'Ad-hoc', headline: 'Q2 order backlog at record EUR 63bn' }
		]
	},
	{
		name: 'Siemens AG', sector: 'Industrials', isin: 'DE0007236101', wkn: '723610', ticker: 'SIE',
		price: 182.4, eps: 9.21, marketCap: 1.44e11, drift: 0.0006, seed: 33,
		insiders: [
			{ daysAgo: 12, who: 'R. Busch', role: 'executive_board', side: 'buy', amount: 2_100_000 },
			{ daysAgo: 22, who: 'R. Thomas', role: 'executive_board', side: 'sell', amount: 900_000 },
			{ daysAgo: 62, who: 'H. Klein', role: 'supervisory_board', side: 'buy', amount: 320_000 }
		],
		news: [
			{ daysAgo: 13, type: 'Voting rights', headline: 'BlackRock crossed 5% threshold' },
			{ daysAgo: 29, type: 'Corporate', headline: 'Healthineers stake reduced to 71%' }
		]
	},
	{
		// Material exec buy AND a deep discount with a fat yield: noisy-or showcase.
		name: 'Allianz SE', sector: 'Insurance', isin: 'DE0008404005', wkn: '840400', ticker: 'ALV',
		price: 298.6, eps: 24.08, marketCap: 1.16e11, dividend: 13.8, drift: 0.0004, seed: 46,
		insiders: [
			{ daysAgo: 9, who: 'C. Bahr', role: 'executive_board', side: 'buy', amount: 1_900_000 },
			{ daysAgo: 53, who: 'O. Bäte', role: 'executive_board', side: 'sell', amount: 1_600_000 },
			{ daysAgo: 74, who: 'G. Müller', role: 'supervisory_board', side: 'buy', amount: 260_000 }
		],
		news: [
			{ daysAgo: 20, type: 'Corporate', headline: 'EUR 2bn share buyback tranche II' },
			{ daysAgo: 34, type: 'Ad-hoc', headline: 'FY combined ratio guidance confirmed' }
		]
	},
	{
		name: 'Deutsche Telekom AG', sector: 'Telecom', isin: 'DE0005557508', wkn: '555750', ticker: 'DTE',
		price: 28.94, eps: 1.79, marketCap: 1.41e11, dividend: 0.77, drift: 0.0007, seed: 59,
		insiders: [
			{ daysAgo: 25, who: 'T. Höttges', role: 'executive_board', side: 'buy', amount: 540_000 },
			{ daysAgo: 32, who: 'C. Illek', role: 'executive_board', side: 'buy', amount: 380_000 },
			{ daysAgo: 87, who: 'B. Krüger', role: 'supervisory_board', side: 'buy', amount: 150_000 }
		],
		news: [
			{ daysAgo: 26, type: 'Ad-hoc', headline: 'US tower stake disposal completed' },
			{ daysAgo: 41, type: 'Voting rights', headline: 'State stake unchanged at 30.5%' }
		]
	},
	{
		name: 'Infineon Technologies AG', sector: 'Semiconductors', isin: 'DE0006231004', wkn: '623100', ticker: 'IFX',
		price: 33.18, eps: 1.34, marketCap: 4.3e10, drift: -0.0005, seed: 72,
		insiders: [
			{ daysAgo: 16, who: 'J. Hanebeck', role: 'executive_board', side: 'buy', amount: 310_000 },
			{ daysAgo: 24, who: 'S. Schulz', role: 'executive_board', side: 'buy', amount: 220_000 },
			{ daysAgo: 99, who: 'W. Ploss', role: 'supervisory_board', side: 'sell', amount: 180_000 }
		],
		news: [
			{ daysAgo: 33, type: 'Ad-hoc', headline: 'Cut auto segment outlook for H2' },
			{ daysAgo: 48, type: 'Corporate', headline: 'Dresden fab ramp on schedule' }
		]
	},
	{
		// No insider activity — surfaces via the value signal alone (union, not intersection).
		name: 'BASF SE', sector: 'Chemicals', isin: 'DE000BASF111', wkn: 'BASF11', ticker: 'BAS',
		price: 44.6, eps: 3.1, marketCap: 4.0e10, dividend: 2.25, drift: 0.0002, seed: 85,
		insiders: [],
		news: [{ daysAgo: 15, type: 'Corporate', headline: 'Verbund site efficiency program on track' }]
	},
	{
		// Negative EPS (no P/E) — surfaces via the insider signal alone.
		name: 'Zalando SE', sector: 'E-commerce', isin: 'DE000ZAL1111', wkn: 'ZAL111', ticker: 'ZAL',
		price: 24.1, eps: -0.4, marketCap: 6.2e9, drift: -0.0009, seed: 98,
		insiders: [
			{ daysAgo: 11, who: 'R. Gentz', role: 'executive_board', side: 'buy', amount: 450_000 }
		],
		news: [{ daysAgo: 9, type: 'Ad-hoc', headline: 'GMV growth guidance narrowed' }]
	},
	{
		// Token €6k courtesy buy: below the materiality floor, must NOT surface.
		name: 'Nemetschek SE', sector: 'Software', isin: 'DE0006452907', wkn: '645290', ticker: 'NEM',
		price: 92.0, eps: 2.1, marketCap: 1.06e10, drift: 0.0005, seed: 111,
		insiders: [
			{ daysAgo: 8, who: 'L. Kaltner', role: 'supervisory_board', side: 'buy', amount: 6_000 }
		],
		news: []
	}
];

/** Deterministic LCG in [0, 1) — same generator family the design demo used. */
function lcg(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

function isoDaysAgo(daysAgo: number): string {
	const d = new Date(`${RUN_DATE}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - daysAgo);
	return d.toISOString().slice(0, 10);
}

/** ~370 calendar days of weekday closes ending at `target` on the run date. */
function priceWalk(company: DemoCompany): { tradeDate: string; close: number }[] {
	const rand = lcg(company.seed);
	const walk: number[] = [1];
	const dates: string[] = [];
	for (let daysAgo = 370; daysAgo >= 0; daysAgo--) {
		const date = new Date(`${RUN_DATE}T00:00:00Z`);
		date.setUTCDate(date.getUTCDate() - daysAgo);
		const dow = date.getUTCDay();
		if (dow === 0 || dow === 6) continue;
		dates.push(date.toISOString().slice(0, 10));
		walk.push(walk[walk.length - 1] * (1 + (rand() - 0.5) * 0.03 + company.drift));
	}
	walk.shift();
	const scale = company.price / walk[walk.length - 1];
	return dates.map((tradeDate, i) => ({ tradeDate, close: +(walk[i] * scale).toFixed(2) }));
}

async function main(): Promise<void> {
	const db = getDb();
	console.warn('seed-demo: dropping and recreating the public schema (dev database only!)');
	await db.execute(sql`drop schema public cascade; create schema public;`);
	await db.execute(sql`drop schema if exists drizzle cascade;`);
	await migrateDb(db);

	for (const company of COMPANIES) {
		const [iss] = await db
			.insert(issuer)
			.values({ name: company.name, sector: company.sector })
			.returning();
		const [inst] = await db
			.insert(instrument)
			.values({
				issuerId: iss.id,
				isin: company.isin,
				wkn: company.wkn,
				ticker: company.ticker,
				currency: 'EUR',
				firstSeen: isoDaysAgo(370),
				lastSeen: RUN_DATE
			})
			.returning();
		await db.insert(indexMembership).values({
			instrumentId: inst.id,
			indexName: 'DAX',
			validFrom: isoDaysAgo(370)
		});

		await db.insert(eodPrice).values(
			priceWalk(company).map((p) => ({
				instrumentId: inst.id,
				tradeDate: p.tradeDate,
				close: String(p.close),
				currency: 'EUR'
			}))
		);

		await db.insert(fundamental).values([
			{
				issuerId: iss.id,
				metric: 'eps_basic',
				value: String(company.eps),
				currency: 'EUR',
				periodEnd: isoDaysAgo(120),
				publishedDate: isoDaysAgo(100),
				source: 'boerse_frankfurt'
			},
			{
				issuerId: iss.id,
				metric: 'market_cap',
				value: String(company.marketCap),
				currency: 'EUR',
				periodEnd: isoDaysAgo(30),
				publishedDate: isoDaysAgo(30),
				source: 'boerse_frankfurt'
			},
			...(company.dividend === undefined
				? []
				: [
						{
							issuerId: iss.id,
							metric: 'dividend_per_share',
							value: String(company.dividend),
							currency: 'EUR',
							periodEnd: isoDaysAgo(120),
							publishedDate: isoDaysAgo(100),
							source: 'boerse_frankfurt' as const
						}
					])
		]);

		if (company.insiders.length > 0) {
			await db.insert(insiderTransaction).values(
				company.insiders.map((t, i) => ({
					issuerId: iss.id,
					isin: company.isin,
					issuerNameRaw: company.name,
					partyName: t.who,
					partyRole: t.role,
					side: t.side,
					instrumentType: 'Aktie',
					amount: String(t.amount),
					currency: 'EUR',
					transactionDate: isoDaysAgo(t.daysAgo),
					publishedDate: isoDaysAgo(Math.max(t.daysAgo - 1, 0)),
					naturalKeyHash: `${company.isin}:${i}`
				}))
			);
		}

		if (company.news.length > 0) {
			await db.insert(newsItem).values(
				company.news.map((n, i) => ({
					source: 'boerse_frankfurt',
					externalId: `${company.isin}:${i}`,
					instrumentId: inst.id,
					issuerId: iss.id,
					isin: company.isin,
					headline: n.headline,
					newsType: n.type,
					publishedAt: new Date(`${isoDaysAgo(n.daysAgo)}T15:04:00+02:00`),
					publishedDate: isoDaysAgo(n.daysAgo),
					naturalKeyHash: `news:${company.isin}:${i}`
				}))
			);
		}
	}

	// two consecutive runs so day-over-day lifecycle states render in the UI
	await runSignals(db, isoDaysAgo(1));
	const stats = await runSignals(db, RUN_DATE);
	console.log(`seed-demo: seeded ${COMPANIES.length} companies, signals run:`, stats);
	await closeDb();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
