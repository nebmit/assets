import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { summarizeRationale, type SignalReport } from '../signals/report.js';
import { signalTools } from './tools.js';

/** Read functions injected instead of a db handle so tests need no database. */
export interface McpDeps {
	latestRunDate(): Promise<string | null>;
	signalReport(slug: string, runDate: string, top: number): Promise<SignalReport | null>;
}

const inputSchema = {
	runDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
		.optional()
		.describe('Signal run date (YYYY-MM-DD). Defaults to the latest run.'),
	limit: z.number().int().min(1).max(50).default(10).describe('Max rows returned (rank order, best first).')
};

const outputSchema = {
	signal: z.string().describe('Signal slug'),
	runDate: z.string().describe('Run date the report is based on (YYYY-MM-DD)'),
	universeSize: z.number().nullable().describe('Instruments in the run universe'),
	passed: z.number().describe('Total fired signals in the run'),
	top: z
		.array(
			z.object({
				rank: z.number().describe('1 = strongest'),
				ticker: z.string().nullable(),
				isin: z.string(),
				name: z.string().describe('Issuer name'),
				score: z
					.number()
					.describe(
						'Calibrated severity in [0,1] on an absolute scale, comparable across runs: ~0.2 barely material, ~0.5 strong, ~1 exceptional'
					),
				percentile: z.number().describe('Percentile among fired signals of this run, 0..1'),
				summary: z.string().describe('One-line human-readable rationale'),
				rationale: z.record(z.unknown()).describe('Raw inputs behind the severity (incl. `reasons` on the feed)')
			})
		)
		.describe('Fired signals, strongest first, truncated to `limit`; empty = nothing material happened')
};

// type alias (not interface) so it satisfies the SDK's structuredContent index signature
type ToolReport = Omit<SignalReport, 'top'> & {
	top: (SignalReport['top'][number] & { summary: string })[];
};

function toolError(text: string) {
	return { content: [{ type: 'text' as const, text }], isError: true };
}

function renderText(report: ToolReport): string {
	const universe = report.universeSize === null ? '' : ` of ${report.universeSize} in universe`;
	const header =
		report.passed === 0
			? `${report.signal} — run ${report.runDate}: nothing surfaced${universe} (quiet day)`
			: `${report.signal} — run ${report.runDate}: ${report.passed} surfaced${universe}, showing ${report.top.length}`;
	const rows = report.top.map(
		(r) =>
			`${r.rank}. ${r.ticker ?? r.isin} ${r.name} — severity ${r.score.toFixed(2)} — ${r.summary}`
	);
	return [header, ...rows].join('\n');
}

/**
 * MCP server exposing the surfaced feed (`surface_latest`) and one
 * read-only facet tool per signal (`signal_<slug>`). Execution failures
 * (no runs yet, unknown run date, db down) come back as tool results with
 * `isError`; invalid params are rejected by schema validation as JSON-RPC
 * invalid-params errors.
 */
export function buildMcpServer(deps: McpDeps): McpServer {
	const server = new McpServer({ name: 'assets-signals', version: '0.0.1' });

	for (const meta of signalTools) {
		server.registerTool(
			meta.toolName,
			{
				title: meta.name,
				description: meta.description,
				inputSchema,
				outputSchema,
				annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }
			},
			async ({ runDate, limit }) => {
				try {
					const date = runDate ?? (await deps.latestRunDate());
					if (!date) return toolError('No signal runs exist yet — the daily pipeline has not run.');
					const report = await deps.signalReport(meta.slug, date, limit);
					if (!report) return toolError(`No signal run found for ${date}.`);
					const structuredContent: ToolReport = {
						...report,
						top: report.top.map((row) => ({ ...row, summary: summarizeRationale(meta.slug, row.rationale) }))
					};
					return {
						content: [{ type: 'text' as const, text: renderText(structuredContent) }],
						structuredContent
					};
				} catch (err) {
					// keep failure details out of the anonymous-facing response
					console.error(`mcp tool ${meta.toolName} failed`, err);
					return toolError('Signal query failed.');
				}
			}
		);
	}
	return server;
}
