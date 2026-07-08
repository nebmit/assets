import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, signal, signalDefinition, signalRun } from '../db/schema.js';
import type { ReportRow, SignalReport } from '../signals/report.js';
import {
	loadComponentBreakdowns,
	loadFundamentalsSnapshots,
	loadInsiderDetails,
	loadNewsSummaries,
	sectorConcentration,
	type ComponentBreakdown,
	type FundamentalsSnapshot,
	type InsiderDealingView,
	type NewsSummaryView
} from './enrich.js';

export interface EnrichedReportRow extends ReportRow {
	superSector: string | null;
	/** Other issuers in the same super-sector passing this signal in the same run. */
	sectorPeersFiring: number | null;
	fundamentals: FundamentalsSnapshot | null;
	components: ComponentBreakdown | null;
	insiders: InsiderDealingView[];
	news: NewsSummaryView | null;
}

export interface EnrichedSignalReport extends Omit<SignalReport, 'top'> {
	top: EnrichedReportRow[];
}

/**
 * signalReport (signals/report.ts) plus the per-row enrichment the MCP tools
 * expose: fundamentals snapshot, severity sub-components, per-insider dealing
 * detail, news summary and sector concentration. The web feed keeps using the
 * lean report; heavy loaders only run for the rows actually returned.
 */
export async function enrichedSignalReport(
	db: Db,
	slug: string,
	runDate: string,
	top: number,
	/** ISINs to hide (a user's ignore list); `passed` reflects the exclusion. */
	excludeIsins?: ReadonlySet<string>
): Promise<EnrichedSignalReport | null> {
	const [run] = await db.select().from(signalRun).where(eq(signalRun.runDate, runDate));
	if (!run) return null;
	const [definition] = await db.select().from(signalDefinition).where(eq(signalDefinition.slug, slug));
	if (!definition) return null;

	const allRows = await db
		.select({
			rank: signal.rank,
			score: signal.score,
			percentile: signal.percentile,
			rationale: signal.rationale,
			instrumentId: signal.instrumentId,
			issuerId: instrument.issuerId,
			ticker: instrument.ticker,
			isin: instrument.isin,
			name: issuer.name,
			sector: issuer.sector
		})
		.from(signal)
		.innerJoin(instrument, eq(instrument.id, signal.instrumentId))
		.innerJoin(issuer, eq(issuer.id, instrument.issuerId))
		.where(
			and(eq(signal.runId, run.id), eq(signal.definitionId, definition.id), eq(signal.passedGate, true))
		)
		.orderBy(signal.rank);

	// Concentration counts the FULL passer set: how crowded a sector is, is a
	// market fact and must not shrink with a personal ignore list or `limit`.
	const concentration = sectorConcentration(allRows);

	const rows =
		excludeIsins === undefined || excludeIsins.size === 0
			? allRows
			: allRows.filter((r) => !excludeIsins.has(r.isin));
	const visible = rows.slice(0, top);

	const instrumentIds = visible.map((r) => r.instrumentId);
	const issuerIds = [...new Set(visible.map((r) => r.issuerId))];
	const [fundamentals, components, insiders, news] = await Promise.all([
		loadFundamentalsSnapshots(db, visible, runDate),
		loadComponentBreakdowns(db, run.id, instrumentIds),
		loadInsiderDetails(db, issuerIds, runDate),
		loadNewsSummaries(db, issuerIds, runDate)
	]);

	return {
		signal: slug,
		runDate,
		universeSize: run.universeSize,
		passed: rows.length,
		top: visible.map((r) => {
			const sector = concentration.get(r.isin);
			return {
				rank: r.rank as number,
				ticker: r.ticker,
				isin: r.isin,
				name: r.name,
				score: Number(r.score),
				percentile: Number(r.percentile),
				rationale: (r.rationale ?? {}) as Record<string, unknown>,
				superSector: sector?.superSector ?? null,
				sectorPeersFiring: sector?.peersFiring ?? null,
				fundamentals: fundamentals.get(r.instrumentId) ?? null,
				components: components.get(r.instrumentId) ?? null,
				insiders: insiders.get(r.issuerId) ?? [],
				news: news.get(r.issuerId) ?? null
			};
		})
	};
}
