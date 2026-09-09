import { savedSnapshots } from '../assets/snapshot.js';
import { addDays } from '../util.js';
import { unknownShortSellers, type ShortSellerAnalysis } from '../../shortSellers.js';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, signal, signalDefinition, signalRun } from '../db/schema.js';
import type { ReportRow, SignalReport } from '../signals/report.js';
import {
	loadComponentBreakdowns,
	fundamentalsView,
	toDealingView,
	sectorConcentration,
	type ComponentBreakdown,
	type FundamentalsSnapshot,
	type InsiderDealingView,
	type NewsSummaryView
} from './enrich.js';

export interface EnrichedReportRow extends ReportRow {
	coverage: Record<string, { state: string; reason: string | null }>;
	shortSellers: ShortSellerAnalysis;
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
	/** Asset IDs to hide (a user's ignore list); `passed` reflects the exclusion. */
	excludeAssetIds?: ReadonlySet<string>
): Promise<EnrichedSignalReport | null> {
	return db.transaction((tx) => readReport(tx, slug, runDate, top, excludeAssetIds), { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

async function readReport(db: Db, slug: string, runDate: string, top: number, excludeAssetIds?: ReadonlySet<string>): Promise<EnrichedSignalReport | null> {
	const [run] = await db.select().from(signalRun).where(and(eq(signalRun.runDate, runDate), eq(signalRun.status, 'success')));
	if (!run) return null;
	const [definition] = await db.select().from(signalDefinition).where(eq(signalDefinition.slug, slug));
	if (!definition) return null;

	const snapshots = new Map((await savedSnapshots(db, runDate)).map((s) => [s.instrumentId, s]));
	const allRows = await db
		.select({
			rank: signal.rank,
			score: signal.score,
			percentile: signal.percentile,
			rationale: signal.rationale,
			instrumentId: signal.instrumentId,
			issuerId: instrument.issuerId,
			assetId: instrument.assetId,
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
	for (const row of allRows) { const frozen = snapshots.get(row.instrumentId); if (frozen) { row.name = frozen.name; row.isin = frozen.isin; row.sector = frozen.sector; } }
	const concentration = sectorConcentration(allRows);

	const rows =
		excludeAssetIds === undefined || excludeAssetIds.size === 0
			? allRows
			: allRows.filter((r) => !excludeAssetIds.has(r.assetId));
	const visible = rows.slice(0, top);

	const instrumentIds = visible.map((r) => r.instrumentId);
	const components = await loadComponentBreakdowns(db, run.id, instrumentIds);

	return {
		signal: slug,
		runDate,
		universeSize: run.universeSize,
		passed: rows.length,
		top: visible.map((r) => {
			const sector = concentration.get(r.assetId);
			const snapshot = snapshots.get(r.instrumentId);
			const news = snapshot?.news.filter((n) => n.publishedAt.slice(0, 10) > addDays(runDate, -30)) ?? [];
			return {
				coverage: snapshots.get(r.instrumentId)?.coverage ?? {},
				shortSellers: snapshots.get(r.instrumentId)?.shortSellers ?? unknownShortSellers(),
				rank: r.rank as number,
				ticker: snapshots.get(r.instrumentId)?.ticker ?? null,
				assetId: r.assetId, currency: snapshots.get(r.instrumentId)?.currency ?? '',
				isin: r.isin,
				name: r.name,
				score: Number(r.score),
				percentile: Number(r.percentile),
				rationale: (r.rationale ?? {}) as Record<string, unknown>,
				superSector: sector?.superSector ?? null,
				sectorPeersFiring: sector?.peersFiring ?? null,
				fundamentals: snapshot ? fundamentalsView(snapshot) : null,
				components: components.get(r.instrumentId) ?? null,
				insiders: snapshot?.insiderHistory.filter((t) => t.transactionDate > addDays(runDate, -30)).map((t) => toDealingView(t, runDate)) ?? [],
				news: { windowCount: news.length, latest: news.slice(0, 3) }
			};
		})
	};
}
