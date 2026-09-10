import type { Financials } from '../assets/financials.js';
import type { NewsRowView } from '../../feed/types.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { signal, signalDefinition } from '../db/schema.js';
import type { ResearchSnapshot } from '../assets/snapshot.js';
import type { QualifiedDealing } from '../assets/ownership.js';
import {
	parseInsiderComponents,
	parseRelativeValueComponents,
	type InsiderComponentsView,
	type RelativeValueComponentsView
} from '../feed/rationale.js';
import {
	COUNTED_INSTRUMENT_TYPE,
	ROLE_WEIGHTS,
	insiderConvictionSignal,
	publicationDecay
} from '../signals/definitions/insiderConviction.js';
import { relativeValueSignal } from '../signals/definitions/relativeValue.js';
import { superSector } from '../signals/sectors.js';
import type { InsiderTx } from '../signals/types.js';
import { addDays } from '../util.js';

/**
 * Query-time enrichment for the MCP report: fundamentals snapshot, per-insider
 * dealing detail, news summary, severity sub-components and sector
 * concentration per surfaced row. Everything is bounded by the run date
 * (no lookahead), mirroring the engine's own discipline in context.ts.
 */

export interface FundamentalsSnapshot {
	financials: Financials;
	currency: string;
	price: number | null;
	priceDate: string | null;
	ytdReturn: number | null;
	high52w: number | null;
	low52w: number | null;
	marketCap: number | null;
	epsBasic: number | null;
	peTrailing: number | null;
	dividendYield: number | null;
}

export function fundamentalsView(s: ResearchSnapshot): FundamentalsSnapshot {
	const priorYear = `${Number(s.cutoffAt.slice(0, 4)) - 1}-12-31`;
	const adjustedClose = s.series.at(-1)?.close ?? null;
	const base = s.series.filter((p) => p.date <= priorYear && p.date > addDays(priorYear, -10)).at(-1)?.close ?? null;
	const range = s.series.filter((p) => p.date > addDays(s.cutoffAt.slice(0, 10), -365));
	return { financials: s.financials, currency: s.currency, price: s.close, priceDate: s.closeDate,
		ytdReturn: adjustedClose !== null && base !== null && base > 0 ? adjustedClose / base - 1 : null,
		high52w: range.length ? Math.max(...range.map((p) => p.close)) : null,
		low52w: range.length ? Math.min(...range.map((p) => p.close)) : null,
		marketCap: s.marketCap, epsBasic: s.epsBasic,
		peTrailing: s.close !== null && s.epsBasic !== null && s.epsBasic > 0 ? s.close / s.epsBasic : null,
		dividendYield: s.close !== null && s.close > 0 && s.dividendPerShare !== null ? s.dividendPerShare / s.close : null };
}
/**
 * Transaction nature at the granularity the BaFin CSV export offers ("Art des
 * Geschäfts" carries only Kauf/Verkauf/Sonstiges): option exercises, RSU and
 * performance-share settlements land in `settlement_or_award`, but cannot be
 * told apart from each other.
 */
export type DealingType = 'purchase' | 'sale' | 'settlement_or_award';

const DEALING_TYPE: Record<InsiderTx['side'], DealingType> = {
	buy: 'purchase',
	sell: 'sale',
	other: 'settlement_or_award'
};

export interface InsiderDealingView {
	party: string | null;
	role: InsiderTx['partyRole'];
	/** Role weight the signal applies to this party's buys. */
	roleWeight: number;
	side: InsiderTx['side'];
	dealingType: DealingType;
	instrumentType: string | null;
	/** Whether this dealing entered the severity (share dealings with a positive amount only). */
	countedInSignal: boolean;
	amount: number | null;
	currency: string | null;
	currencyStatus: string;
	qualificationReason: string | null;
	source: string;
	url: string | null;
	owners: QualifiedDealing['owners'];
	price: number | null;
	transactionDate: string;
	publishedDate: string;
	/** Role-weighted, publication-decayed EUR the signal credited; null for non-counted or sell rows. */
	decayedWeightEur: number | null;
}

/** The display uses exactly the qualification selected for the signal. */
export function toDealingView(row: QualifiedDealing, runDate: string): InsiderDealingView {
	const counted = row.qualification === 'qualified' && row.amountEur !== null && row.amountEur > 0 && row.instrumentType === COUNTED_INSTRUMENT_TYPE && ['buy', 'sell'].includes(row.side);
	return { party: row.partyName, role: row.partyRole, roleWeight: ROLE_WEIGHTS[row.partyRole], side: row.side,
		dealingType: DEALING_TYPE[row.side], instrumentType: row.instrumentType, countedInSignal: counted,
		amount: row.amount, currency: row.currency, currencyStatus: row.currencyStatus, qualificationReason: row.qualificationReason,
		source: row.source, url: row.url, owners: row.owners, price: row.price, transactionDate: row.transactionDate,
		publishedDate: row.publishedDate, decayedWeightEur: counted && row.side === 'buy' ? row.amountEur! * ROLE_WEIGHTS[row.partyRole] * publicationDecay(row.publishedDate, runDate) : null };
}
export interface NewsSummaryView {
	/** News items in the signal window (last 30 days up to the run date). */
	windowCount: number;
	latest: NewsRowView[];
}

export interface SectorConcentration {
	/** Coarse sector bucket (signals/sectors.ts); null when the source classification is unmapped. */
	superSector: string | null;
	/** Other issuers in the same bucket passing the same signal in this run; null without a bucket. */
	peersFiring: number | null;
}

/**
 * Sector concentration over the run's FULL passer set (before ignore-list
 * filtering and truncation — how crowded a sector is, is a market fact, not a
 * per-account view). Keyed by asset ID.
 */
export function sectorConcentration(
	passers: { assetId: string; issuerId: number; sector: string | null }[]
): Map<string, SectorConcentration> {
	const issuersByBucket = new Map<string, Set<number>>();
	const bucketByAssetId = new Map<string, string | null>();
	for (const row of passers) {
		const bucket = superSector(row.sector);
		bucketByAssetId.set(row.assetId, bucket);
		if (bucket === null) continue;
		const set = issuersByBucket.get(bucket) ?? new Set<number>();
		set.add(row.issuerId);
		issuersByBucket.set(bucket, set);
	}
	const out = new Map<string, SectorConcentration>();
	for (const row of passers) {
		const bucket = bucketByAssetId.get(row.assetId) ?? null;
		out.set(row.assetId, {
			superSector: bucket,
			peersFiring: bucket === null ? null : (issuersByBucket.get(bucket)?.size ?? 1) - 1
		});
	}
	return out;
}

export interface ComponentBreakdown {
	insiderConviction:
		| ({ fired: boolean; severity: number | null } & InsiderComponentsView)
		| null;
	relativeValue:
		| ({ fired: boolean; severity: number | null } & RelativeValueComponentsView)
		| null;
}

/**
 * Severity sub-components per instrument, read from the run's component-signal
 * rows (persisted for the whole universe, fired or not — so a row surfaced by
 * one signal still shows the other's inputs). Fields from engine versions
 * that predate a sub-score degrade to null.
 */
export async function loadComponentBreakdowns(
	db: Db,
	runId: number,
	instrumentIds: number[]
): Promise<Map<number, ComponentBreakdown>> {
	if (instrumentIds.length === 0) return new Map();
	const slugs = [insiderConvictionSignal.slug, relativeValueSignal.slug];
	const definitions = await db
		.select({ id: signalDefinition.id, slug: signalDefinition.slug })
		.from(signalDefinition)
		.where(inArray(signalDefinition.slug, slugs));
	const slugById = new Map(definitions.map((d) => [d.id, d.slug]));
	if (definitions.length === 0) return new Map();

	const rows = await db
		.select({
			definitionId: signal.definitionId,
			instrumentId: signal.instrumentId,
			passedGate: signal.passedGate,
			score: signal.score,
			rationale: signal.rationale
		})
		.from(signal)
		.where(
			and(
				eq(signal.runId, runId),
				inArray(signal.definitionId, definitions.map((d) => d.id)),
				inArray(signal.instrumentId, instrumentIds)
			)
		);

	const out = new Map<number, ComponentBreakdown>();
	for (const row of rows) {
		const breakdown = out.get(row.instrumentId) ?? { insiderConviction: null, relativeValue: null };
		const base = {
			fired: row.passedGate,
			severity: row.score === null ? null : Number(row.score)
		};
		if (slugById.get(row.definitionId) === insiderConvictionSignal.slug) {
			breakdown.insiderConviction = { ...base, ...parseInsiderComponents(row.rationale) };
		} else {
			breakdown.relativeValue = { ...base, ...parseRelativeValueComponents(row.rationale) };
		}
		out.set(row.instrumentId, breakdown);
	}
	return out;
}
