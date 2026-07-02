import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { summarizeRationale, type ScreenReport } from '../signals/report.js';
import { screenTools } from './tools.js';

/** Read functions injected instead of a db handle so tests need no database. */
export interface McpDeps {
	latestRunDate(): Promise<string | null>;
	screenReport(slug: string, runDate: string, top: number): Promise<ScreenReport | null>;
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
	screen: z.string().describe('Screen slug'),
	runDate: z.string().describe('Run date the report is based on (YYYY-MM-DD)'),
	universeSize: z.number().nullable().describe('Instruments in the run universe'),
	passed: z.number().describe('Total gate-passers in the run'),
	top: z
		.array(
			z.object({
				rank: z.number().describe('1 = strongest'),
				ticker: z.string().nullable(),
				isin: z.string(),
				name: z.string().describe('Issuer name'),
				score: z.number().describe('Raw screen score; only comparable within one screen and run'),
				percentile: z.number().describe('Percentile among gate-passers, 0..1'),
				summary: z.string().describe('One-line human-readable rationale'),
				rationale: z.record(z.unknown()).describe('Raw inputs behind the score')
			})
		)
		.describe('Ranked gate-passers, best first, truncated to `limit`')
};

// type alias (not interface) so it satisfies the SDK's structuredContent index signature
type ToolReport = Omit<ScreenReport, 'top'> & {
	top: (ScreenReport['top'][number] & { summary: string })[];
};

function toolError(text: string) {
	return { content: [{ type: 'text' as const, text }], isError: true };
}

function renderText(report: ToolReport): string {
	const universe = report.universeSize === null ? '' : ` of ${report.universeSize} in universe`;
	const header = `${report.screen} — run ${report.runDate}: ${report.passed} gate-passer(s)${universe}, showing ${report.top.length}`;
	const rows = report.top.map(
		(r) =>
			`${r.rank}. ${r.ticker ?? r.isin} ${r.name} — score ${r.score.toPrecision(3)}, p${Math.round(r.percentile * 100)} — ${r.summary}`
	);
	return [header, ...rows].join('\n');
}

/**
 * MCP server exposing each signal screen as a read-only tool
 * (`screen_<slug>`). Execution failures (no runs yet, unknown run date, db
 * down) come back as tool results with `isError`; invalid params are
 * rejected by schema validation as JSON-RPC invalid-params errors.
 */
export function buildMcpServer(deps: McpDeps): McpServer {
	const server = new McpServer({ name: 'assets-signals', version: '0.0.1' });

	for (const meta of screenTools) {
		server.registerTool(
			`screen_${meta.slug}`,
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
					const report = await deps.screenReport(meta.slug, date, limit);
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
					console.error(`mcp tool screen_${meta.slug} failed`, err);
					return toolError('Screen query failed.');
				}
			}
		);
	}
	return server;
}
