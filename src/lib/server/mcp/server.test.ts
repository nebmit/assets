import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { summarizeRationale, type SignalReport } from '../signals/report.js';
import { buildMcpServer, type McpDeps } from './server.js';

const RUN_DATE = '2026-07-01';

function makeReport(slug: string, top: number): SignalReport {
	return {
		signal: slug,
		runDate: RUN_DATE,
		universeSize: 160,
		passed: 2,
		top: [
			{
				rank: 1,
				ticker: 'AAA',
				isin: 'DE0000000001',
				name: 'Alpha AG',
				score: 0.42,
				percentile: 1,
				rationale: { buy_value_eur: 250_000, buyer_count: 3, headline: '3 insiders bought €250k in 30d' }
			},
			{
				rank: 2,
				ticker: null,
				isin: 'DE0000000002',
				name: 'Beta SE',
				score: 0.17,
				percentile: 0.5,
				rationale: { buy_value_eur: 90_000, buyer_count: 1 }
			}
		].slice(0, top)
	};
}

const happyDeps: McpDeps = {
	latestRunDate: async () => RUN_DATE,
	signalReport: async (slug, runDate, top) => (runDate === RUN_DATE ? makeReport(slug, top) : null)
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

	it('lists the feed tool plus one read-only facet tool per signal', async () => {
		const client = await connect(happyDeps);
		const { tools } = await client.listTools();

		expect(tools.map((t) => t.name).sort()).toEqual([
			'signal_insider_conviction',
			'signal_relative_value',
			'surface_latest'
		]);
		for (const tool of tools) {
			expect(tool.description).toBeTruthy();
			expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
			expect(tool.inputSchema.properties).toHaveProperty('runDate');
			expect(tool.inputSchema.properties).toHaveProperty('limit');
			expect(tool.outputSchema?.properties).toHaveProperty('top');
		}
	});

	it('returns a structured report with rationale summaries', async () => {
		const client = await connect(happyDeps);
		const result = await client.callTool({
			name: 'signal_insider_conviction',
			arguments: { limit: 2 }
		});

		expect(result.isError).toBeFalsy();
		const report = result.structuredContent as SignalReport & { top: { summary: string }[] };
		expect(report).toMatchObject({ signal: 'insider_conviction', runDate: RUN_DATE, passed: 2 });
		expect(report.top).toHaveLength(2);
		expect(report.top[0].summary).toBe('3 insiders bought €250k in 30d');
		expect(report.top[1].summary).toBe(
			summarizeRationale('insider_conviction', { buy_value_eur: 90_000, buyer_count: 1 })
		);
		const text = (result.content as { type: string; text: string }[])[0];
		expect(text.type).toBe('text');
		expect(text.text).toContain('AAA Alpha AG');
	});

	it('passes an explicit runDate through to the report query', async () => {
		let seen: { runDate: string; top: number } | undefined;
		const client = await connect({
			latestRunDate: async () => RUN_DATE,
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
