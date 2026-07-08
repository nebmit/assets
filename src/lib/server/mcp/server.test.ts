import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { IssuerDetail } from '../issuer/detail.js';
import { summarizeRationale } from '../signals/report.js';
import type { EnrichedReportRow, EnrichedSignalReport } from './report.js';
import { buildMcpServer, type McpDeps } from './server.js';

const RUN_DATE = '2026-07-01';

const alphaRow: EnrichedReportRow = {
	rank: 1,
	ticker: 'AAA',
	isin: 'DE0000000001',
	name: 'Alpha AG',
	score: 0.42,
	percentile: 1,
	rationale: { buy_value_eur: 250_000, buyer_count: 3, headline: '3 insiders bought €250k in 30d' },
	superSector: 'Industrials',
	sectorPeersFiring: 2,
	fundamentals: {
		price: 82.4,
		priceDate: RUN_DATE,
		ytdReturn: -0.12,
		high52w: 110,
		low52w: 70,
		marketCap: 4_200_000_000,
		epsBasic: 5.9,
		peTrailing: 82.4 / 5.9,
		dividendYield: 0.031
	},
	components: {
		insiderConviction: {
			fired: true,
			severity: 0.42,
			sizeScore: 0.4,
			clusterFactor: 1.5,
			sellDampen: 1,
			contrarianBoost: 1.12,
			buyerCount: 3,
			buyValueEur: 250_000,
			sellValueEur: 0,
			weightedBuyEur: 231_000,
			floorEur: 100_000,
			passesSizeGate: true,
			passesClusterGate: true,
			boughtIntoDecline: true
		},
		relativeValue: {
			fired: false,
			severity: null,
			pe: 13.9,
			peerMedianPe: 15.1,
			peerCount: 12,
			peerGroup: 'sector:Industrials',
			discountToPeerMedian: 0.08,
			dividendYield: 0.031,
			knifeGuard: null
		}
	},
	insiders: [
		{
			party: 'Armin Example',
			role: 'executive_board',
			roleWeight: 1,
			side: 'buy',
			dealingType: 'open_market_purchase',
			instrumentType: 'Aktie',
			countedInSignal: true,
			amountEur: 250_000,
			price: 81.7,
			transactionDate: '2026-06-25',
			publishedDate: '2026-06-26',
			decayedWeightEur: 231_000
		}
	],
	news: {
		windowCount: 4,
		latest: [{ headline: 'Alpha AG wins defence order', publishedAt: '2026-06-30T08:00:00.000Z' }]
	}
};

/** Pre-enrichment row shape (older run / instrument without data): everything nullable is null. */
const betaRow: EnrichedReportRow = {
	rank: 2,
	ticker: null,
	isin: 'DE0000000002',
	name: 'Beta SE',
	score: 0.17,
	percentile: 0.5,
	rationale: { buy_value_eur: 90_000, buyer_count: 1 },
	superSector: null,
	sectorPeersFiring: null,
	fundamentals: null,
	components: null,
	insiders: [],
	news: null
};

function makeReport(slug: string, top: number): EnrichedSignalReport {
	return {
		signal: slug,
		runDate: RUN_DATE,
		universeSize: 160,
		passed: 2,
		top: [alphaRow, betaRow].slice(0, top)
	};
}

const detailFixture: IssuerDetail = {
	isin: 'DE0000000001',
	ticker: 'AAA',
	name: 'Alpha AG',
	sector: 'Machinery',
	superSector: 'Industrials',
	runDate: RUN_DATE,
	monthlyCloses: [
		{ date: '2026-05-29', close: 79.2 },
		{ date: '2026-06-30', close: 82.4 }
	],
	epsBasicHistory: [{ value: 5.9, periodEnd: '2026-06-30', publishedDate: '2026-06-30' }],
	marketCapHistory: [],
	dividendPerShareHistory: [],
	insiderHistory: alphaRow.insiders,
	insiderFollowThrough: [
		{
			party: 'Armin Example',
			role: 'executive_board',
			buyCount: 2,
			buys: [
				{ transactionDate: '2026-03-02', amountEur: 100_000, fwdReturn91d: 0.08 },
				{ transactionDate: '2026-06-25', amountEur: 250_000, fwdReturn91d: null }
			]
		}
	],
	news: [{ headline: 'Alpha AG wins defence order', publishedAt: '2026-06-30T08:00:00.000Z' }]
};

const happyDeps: McpDeps = {
	latestRunDate: async () => RUN_DATE,
	signalReport: async (slug, runDate, top) => (runDate === RUN_DATE ? makeReport(slug, top) : null),
	issuerDetail: async (isin) => (isin === detailFixture.isin ? detailFixture : null)
};

async function connect(deps: McpDeps): Promise<Client> {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test-client', version: '0.0.0' });
	await Promise.all([buildMcpServer(deps).connect(serverTransport), client.connect(clientTransport)]);
	return client;
}

describe('mcp server', () => {
	it('completes initialize with server info', async () => {
		const client = await connect(happyDeps);
		expect(client.getServerVersion()).toMatchObject({ name: 'assets-signals' });
	});

	it('lists the feed tool, one facet tool per signal and the drill-down', async () => {
		const client = await connect(happyDeps);
		const { tools } = await client.listTools();

		expect(tools.map((t) => t.name).sort()).toEqual([
			'issuer_detail',
			'signal_insider_conviction',
			'signal_relative_value',
			'surface_latest'
		]);
		for (const tool of tools) {
			expect(tool.description).toBeTruthy();
			expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
			expect(tool.inputSchema.properties).toHaveProperty('runDate');
		}
		const feed = tools.find((t) => t.name === 'surface_latest');
		expect(feed?.inputSchema.properties).toHaveProperty('limit');
		const rowProperties = (
			feed?.outputSchema?.properties?.top as {
				items: { properties: Record<string, unknown> };
			}
		).items.properties;
		for (const field of [
			'insiders',
			'fundamentals',
			'components',
			'news',
			'superSector',
			'sectorPeersFiring'
		]) {
			expect(rowProperties).toHaveProperty(field);
		}
		const detail = tools.find((t) => t.name === 'issuer_detail');
		expect(detail?.inputSchema.properties).toHaveProperty('isin');
		expect(detail?.outputSchema?.properties).toHaveProperty('insiderFollowThrough');
	});

	it('returns a structured report with rationale summaries and enrichment', async () => {
		const client = await connect(happyDeps);
		const result = await client.callTool({
			name: 'signal_insider_conviction',
			arguments: { limit: 2 }
		});

		expect(result.isError).toBeFalsy();
		const report = result.structuredContent as EnrichedSignalReport & { top: { summary: string }[] };
		expect(report).toMatchObject({ signal: 'insider_conviction', runDate: RUN_DATE, passed: 2 });
		expect(report.top).toHaveLength(2);
		expect(report.top[0].summary).toBe('3 insiders bought €250k in 30d');
		expect(report.top[0]).toMatchObject({
			insiders: [{ party: 'Armin Example', dealingType: 'open_market_purchase' }],
			fundamentals: { marketCap: 4_200_000_000 },
			components: { insiderConviction: { boughtIntoDecline: true } },
			sectorPeersFiring: 2
		});
		expect(report.top[1].summary).toBe(
			summarizeRationale('insider_conviction', { buy_value_eur: 90_000, buyer_count: 1 })
		);
		const text = (result.content as { type: string; text: string }[])[0];
		expect(text.type).toBe('text');
		expect(text.text).toContain('AAA Alpha AG');
	});

	it('renders rows with null enrichment without failing validation', async () => {
		const client = await connect(happyDeps);
		const result = await client.callTool({ name: 'surface_latest', arguments: { limit: 2 } });
		expect(result.isError).toBeFalsy();
		const report = result.structuredContent as EnrichedSignalReport;
		expect(report.top[1]).toMatchObject({
			fundamentals: null,
			components: null,
			insiders: [],
			news: null,
			superSector: null
		});
	});

	it('passes an explicit runDate through to the report query', async () => {
		let seen: { runDate: string; top: number } | undefined;
		const client = await connect({
			...happyDeps,
			signalReport: async (slug, runDate, top) => {
				seen = { runDate, top };
				return makeReport(slug, top);
			}
		});
		await client.callTool({
			name: 'signal_relative_value',
			arguments: { runDate: '2026-06-15', limit: 5 }
		});
		expect(seen).toEqual({ runDate: '2026-06-15', top: 5 });
	});

	it('returns issuer detail with follow-through for a known ISIN', async () => {
		const client = await connect(happyDeps);
		const result = await client.callTool({
			name: 'issuer_detail',
			arguments: { isin: 'DE0000000001' }
		});
		expect(result.isError).toBeFalsy();
		const detail = result.structuredContent as IssuerDetail;
		expect(detail).toMatchObject({
			isin: 'DE0000000001',
			superSector: 'Industrials',
			insiderFollowThrough: [{ party: 'Armin Example', buyCount: 2 }]
		});
		expect(detail.monthlyCloses).toHaveLength(2);
	});

	it('defaults issuer detail to the latest run date', async () => {
		let seen: string | undefined;
		const client = await connect({
			...happyDeps,
			issuerDetail: async (_isin, runDate) => {
				seen = runDate;
				return detailFixture;
			}
		});
		await client.callTool({ name: 'issuer_detail', arguments: { isin: 'DE0000000001' } });
		expect(seen).toBe(RUN_DATE);
	});

	it('reports a tool error for an unknown ISIN', async () => {
		const client = await connect(happyDeps);
		const result = await client.callTool({
			name: 'issuer_detail',
			arguments: { isin: 'DE0000000099' }
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain('DE0000000099');
	});

	it('rejects a malformed ISIN before the query runs', async () => {
		let queried = false;
		const client = await connect({
			...happyDeps,
			issuerDetail: async () => {
				queried = true;
				return detailFixture;
			}
		});
		const result = await client.callTool({ name: 'issuer_detail', arguments: { isin: 'rheinmetall' } });
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain('ISIN');
		expect(queried).toBe(false);
	});

	it('reports a tool error when no signal runs exist', async () => {
		const client = await connect({ ...happyDeps, latestRunDate: async () => null });
		const result = await client.callTool({ name: 'signal_relative_value', arguments: {} });
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain('No signal runs');
	});

	it('reports a tool error for an unknown run date', async () => {
		const client = await connect(happyDeps);
		const result = await client.callTool({
			name: 'signal_relative_value',
			arguments: { runDate: '1999-01-01' }
		});
		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain('1999-01-01');
	});

	it('hides failure details behind a generic tool error', async () => {
		const client = await connect({
			...happyDeps,
			signalReport: async () => {
				throw new Error('connection refused at 10.0.0.5:5432');
			}
		});
		const result = await client.callTool({ name: 'surface_latest', arguments: {} });
		expect(result.isError).toBe(true);
		const content = JSON.stringify(result.content);
		expect(content).toContain('Signal query failed');
		expect(content).not.toContain('10.0.0.5');
	});

	it('rejects out-of-range and malformed params before the query runs', async () => {
		let queried = false;
		const client = await connect({
			...happyDeps,
			signalReport: async (slug, _runDate, top) => {
				queried = true;
				return makeReport(slug, top);
			}
		});

		const overLimit = await client.callTool({
			name: 'signal_insider_conviction',
			arguments: { limit: 999 }
		});
		expect(overLimit.isError).toBe(true);
		expect(JSON.stringify(overLimit.content)).toContain('less than or equal to 50');

		const badDate = await client.callTool({
			name: 'signal_insider_conviction',
			arguments: { runDate: 'yesterday' }
		});
		expect(badDate.isError).toBe(true);
		expect(JSON.stringify(badDate.content)).toContain('YYYY-MM-DD');

		expect(queried).toBe(false);
	});
});
