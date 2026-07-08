import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IssuerDetail } from '../issuer/detail.js';
import { summarizeRationale } from '../signals/report.js';
import type { EnrichedSignalReport } from './report.js';
import { ISSUER_DETAIL_DESCRIPTION, signalTools } from './tools.js';

/** Read functions injected instead of a db handle so tests need no database. */
export interface McpDeps {
	latestRunDate(): Promise<string | null>;
	signalReport(slug: string, runDate: string, top: number): Promise<EnrichedSignalReport | null>;
	issuerDetail(isin: string, runDate: string): Promise<IssuerDetail | null>;
}

const runDateParam = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
	.optional()
	.describe('Signal run date (YYYY-MM-DD). Defaults to the latest run.');

const inputSchema = {
	runDate: runDateParam,
	limit: z.number().int().min(1).max(50).default(10).describe('Max rows returned (rank order, best first).')
};

const partyRole = z
	.enum(['executive_board', 'supervisory_board', 'related_party', 'other'])
	.describe(
		'Filing role: executive_board (Vorstand), supervisory_board (Aufsichtsrat), related_party ' +
			'(person/entity in enger Beziehung to an insider), other (Sonstige Führungsperson)'
	);

const dealingRow = z.object({
	party: z
		.string()
		.nullable()
		.describe('Insider name as filed (Meldepflichtiger); null when the filing names no person'),
	role: partyRole,
	roleWeight: z
		.number()
		.describe('Weight the signal applies to this role (executive 1.0 … related party 0.6)'),
	side: z.enum(['buy', 'sell', 'other']).describe('"Art des Geschäfts" as filed: Kauf/Verkauf/Sonstiges'),
	dealingType: z
		.enum(['open_market_purchase', 'sale', 'settlement_or_award'])
		.describe(
			'Transaction nature at the granularity the BaFin CSV offers. Option exercises and RSU/' +
				'performance-share settlements land in settlement_or_award but cannot be told apart; ' +
				'they never count toward severity.'
		),
	instrumentType: z
		.string()
		.nullable()
		.describe('Filed instrument type ("Aktie" = shares); only share dealings count toward severity'),
	countedInSignal: z
		.boolean()
		.describe('Whether this dealing entered the severity (share buy/sell with a positive amount)'),
	amountEur: z.number().nullable().describe('Aggregate filed volume in EUR'),
	price: z.number().nullable().describe('Filed average price per unit'),
	transactionDate: z.string(),
	publishedDate: z.string().describe('Publication date — decay and no-lookahead run off this'),
	decayedWeightEur: z
		.number()
		.nullable()
		.describe('Role-weighted, publication-decayed EUR the signal credited; null for sells/settlements')
});

const insiderComponents = z
	.object({
		fired: z.boolean().describe('Whether this signal passed its gate for the row'),
		severity: z.number().nullable().describe('This component signal’s calibrated severity in [0,1]'),
		sizeScore: z
			.number()
			.nullable()
			.describe('Saturating size of role-weighted decayed buying vs the cap-band floor, [0,1]'),
		clusterFactor: z.number().nullable().describe('Distinct-buyer multiplier, 1 (solo) … 1.75 (4+ buyers)'),
		sellDampen: z.number().nullable().describe('Dampening from concurrent insider sells, (0,1], 1 = no sells'),
		contrarianBoost: z
			.number()
			.nullable()
			.describe('Boost for buying into a falling price, 1 … 1.5 (grows with the trailing 3-month drop)'),
		buyerCount: z.number().nullable().describe('Distinct named buyers (+1 if any unnamed filing)'),
		buyValueEur: z.number().nullable().describe('Raw (unweighted) insider share buying in the window, EUR'),
		sellValueEur: z.number().nullable().describe('Raw insider share selling in the window, EUR'),
		weightedBuyEur: z.number().nullable().describe('Role-weighted, publication-decayed buying, EUR'),
		floorEur: z.number().nullable().describe('Cap-band materiality floor (DAX 100k / MDAX 50k / SDAX 25k)'),
		passesSizeGate: z
			.boolean()
			.nullable()
			.describe('Weighted buying cleared the full floor; null on rows from older engine versions'),
		passesClusterGate: z
			.boolean()
			.nullable()
			.describe('≥2 buyers cleared the halved floor; null on rows from older engine versions'),
		boughtIntoDecline: z
			.boolean()
			.nullable()
			.describe('Buying while the price is down ≥10% over ~3 months; null on older rows')
	})
	.nullable()
	.describe('Insider-conviction severity sub-components; null when the run has no row for this signal');

const relativeValueComponents = z
	.object({
		fired: z.boolean().describe('Whether this signal passed its gate for the row'),
		severity: z.number().nullable().describe('This component signal’s calibrated severity in [0,1]'),
		pe: z.number().nullable().describe('Trailing P/E from the latest close and point-in-time basic EPS'),
		peerMedianPe: z.number().nullable().describe('Median trailing P/E of the peer group'),
		peerCount: z.number().nullable().describe('Peers in the comparison group'),
		peerGroup: z
			.string()
			.nullable()
			.describe('Peer group used: "sector:<super-sector>" or "index:<DAX|MDAX|SDAX>" fallback'),
		discountToPeerMedian: z
			.number()
			.nullable()
			.describe('(peer median − P/E) / peer median; the gate needs ≥ 0.15'),
		dividendYield: z.number().nullable().describe('Dividend per share / latest close'),
		knifeGuard: z
			.boolean()
			.nullable()
			.describe('True when gated out for a >35% six-month drop despite being cheap')
	})
	.nullable()
	.describe('Relative-value severity sub-components; null when the run has no row for this signal');

const rowSchema = z.object({
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
	superSector: z
		.string()
		.nullable()
		.describe('Coarse sector bucket used for peer grouping; null when unclassified'),
	sectorPeersFiring: z
		.number()
		.nullable()
		.describe(
			'Other issuers in the same super-sector passing this signal in the same run (before any ' +
				'ignore-list filtering). High values mean a sector-wide flag (usually macro), not an ' +
				'idiosyncratic one.'
		),
	fundamentals: z
		.object({
			price: z.number().nullable().describe('Latest close on or before the run date, EUR'),
			priceDate: z.string().nullable(),
			ytdReturn: z.number().nullable().describe('Price return since the prior year-end close'),
			high52w: z.number().nullable().describe('Trailing 52-week high close'),
			low52w: z.number().nullable().describe('Trailing 52-week low close'),
			marketCap: z.number().nullable().describe('Point-in-time market capitalisation, EUR'),
			epsBasic: z.number().nullable().describe('Point-in-time basic EPS'),
			peTrailing: z
				.number()
				.nullable()
				.describe(
					'Trailing P/E (latest close / basic EPS). Forward P/E and analyst consensus are not ' +
						'available from the data source.'
				),
			dividendYield: z.number().nullable().describe('Dividend per share / latest close')
		})
		.nullable()
		.describe('Point-in-time fundamentals snapshot as of the run date'),
	components: z
		.object({ insiderConviction: insiderComponents, relativeValue: relativeValueComponents })
		.nullable()
		.describe(
			'Severity sub-components of every component signal for this instrument in this run — ' +
				'populated whether or not the signal fired, so a row surfaced by one signal still shows ' +
				'the other’s inputs. Fields unknown to older engine versions are null.'
		),
	insiders: z
		.array(dealingRow)
		.describe('All directors’ dealings for the issuer in the signal window (last 30 days), newest first'),
	news: z
		.object({
			windowCount: z.number().describe('News items in the last 30 days up to the run date'),
			latest: z.array(z.object({ headline: z.string(), publishedAt: z.string() }))
		})
		.nullable()
		.describe(
			'Recent headlines for the issuer — check these for regulatory or company events converging ' +
				'on the same name; null when no news in the window'
		),
	rationale: z.record(z.unknown()).describe('Raw inputs behind the severity (incl. `reasons` on the feed)')
});

const outputSchema = {
	signal: z.string().describe('Signal slug'),
	runDate: z.string().describe('Run date the report is based on (YYYY-MM-DD)'),
	universeSize: z.number().nullable().describe('Instruments in the run universe'),
	passed: z.number().describe('Total fired signals in the run'),
	top: rowSchema
		.array()
		.describe('Fired signals, strongest first, truncated to `limit`; empty = nothing material happened')
};

const detailInputSchema = {
	isin: z
		.string()
		.regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/, 'expected an ISIN (e.g. DE0007030009)')
		.describe('ISIN of the instrument to drill into'),
	runDate: runDateParam
};

const metricPoint = z.object({
	value: z.number(),
	periodEnd: z.string(),
	publishedDate: z.string().describe('Point-in-time guard — when the value became public')
});

const detailOutputSchema = {
	isin: z.string(),
	ticker: z.string().nullable(),
	name: z.string().describe('Issuer name'),
	sector: z.string().nullable().describe('Granular sector as reported by the exchange'),
	superSector: z.string().nullable().describe('Coarse sector bucket used for peer grouping'),
	runDate: z.string().describe('All history is bounded by this date (no lookahead)'),
	monthlyCloses: z
		.array(z.object({ date: z.string(), close: z.number() }))
		.describe('Last close per calendar month, ascending, ~24 months'),
	epsBasicHistory: z.array(metricPoint).describe('Basic EPS history (shape shows recovery vs re-rating)'),
	marketCapHistory: z.array(metricPoint),
	dividendPerShareHistory: z.array(metricPoint),
	insiderHistory: z
		.array(dealingRow)
		.describe(
			'Stored directors’ dealings, newest first (max 50). Covers history since ingestion began — ' +
				'not the full historic record.'
		),
	insiderFollowThrough: z
		.array(
			z.object({
				party: z.string(),
				role: partyRole,
				buyCount: z.number().describe('Counted share buys by this person in the stored history'),
				buys: z.array(
					z.object({
						transactionDate: z.string(),
						amountEur: z.number().nullable(),
						fwdReturn91d: z
							.number()
							.nullable()
							.describe('Price return ~91 days after the buy; null when the horizon has not elapsed')
					})
				)
			})
		)
		.describe(
			'Per named insider: prior counted buys and what the price did afterwards — a repeat dip ' +
				'buyer with positive follow-through is a different signal from a first-time buyer'
		),
	news: z.array(z.object({ headline: z.string(), publishedAt: z.string() })).describe('Most recent headlines (max 10)')
};

// type alias (not interface) so it satisfies the SDK's structuredContent index signature
type ToolReport = Omit<EnrichedSignalReport, 'top'> & {
	top: (EnrichedSignalReport['top'][number] & { summary: string })[];
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

function renderDetailText(detail: IssuerDetail): string {
	const parts = [
		`${detail.name} (${detail.ticker ?? detail.isin}) as of ${detail.runDate}`,
		`${detail.monthlyCloses.length} monthly closes, ${detail.epsBasicHistory.length} EPS points`,
		`${detail.insiderHistory.length} stored insider dealings, ${detail.insiderFollowThrough.length} named buyer(s) with follow-through`,
		`${detail.news.length} recent headlines`
	];
	return parts.join(' — ');
}

/**
 * MCP server exposing the surfaced feed (`surface_latest`), one read-only
 * facet tool per signal (`signal_<slug>`) and the `issuer_detail` drill-down.
 * Execution failures (no runs yet, unknown run date, db down) come back as
 * tool results with `isError`; invalid params are rejected by schema
 * validation as JSON-RPC invalid-params errors.
 */
export function buildMcpServer(deps: McpDeps): McpServer {
	const server = new McpServer({ name: 'assets-signals', version: '0.0.1' });
	const annotations = { readOnlyHint: true, openWorldHint: false, idempotentHint: true };

	for (const meta of signalTools) {
		server.registerTool(
			meta.toolName,
			{
				title: meta.name,
				description: meta.description,
				inputSchema,
				outputSchema,
				annotations
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

	server.registerTool(
		'issuer_detail',
		{
			title: 'Issuer Detail',
			description: ISSUER_DETAIL_DESCRIPTION,
			inputSchema: detailInputSchema,
			outputSchema: detailOutputSchema,
			annotations
		},
		async ({ isin, runDate }) => {
			try {
				const date = runDate ?? (await deps.latestRunDate());
				if (!date) return toolError('No signal runs exist yet — the daily pipeline has not run.');
				const detail = await deps.issuerDetail(isin, date);
				if (!detail) return toolError(`No instrument found for ISIN ${isin}.`);
				return {
					content: [{ type: 'text' as const, text: renderDetailText(detail) }],
					structuredContent: detail as unknown as Record<string, unknown>
				};
			} catch (err) {
				// keep failure details out of the anonymous-facing response
				console.error('mcp tool issuer_detail failed', err);
				return toolError('Issuer detail query failed.');
			}
		}
	);
	return server;
}
