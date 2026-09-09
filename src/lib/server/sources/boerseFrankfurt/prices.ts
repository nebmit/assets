import { storePrices } from '../../assets/observations.js';
import { bfMembers } from '../../assets/listings.js';
import { fingerprint } from '../../assets/evidence.js';
import { and, eq, max, min } from 'drizzle-orm';
import { subtractYears } from '../../../date.js';
import { eodPrice, listing } from '../../db/schema.js';
import type { Job, JobContext, JobStats } from '../../pipeline/types.js';
import { addDays } from '../../util.js';
import { bfRequest, BF_SOURCE, BfUnavailableError } from './client.js';
import { priceHistoryResponse } from './schemas.js';

const BACKFILL_YEARS = 3;
const PAGE_SIZE = 1000;

/**
 * The snapshot job supplies the daily close for every instrument, so
 * raw price_history is fetched for uncovered history or after multi-day gaps.
 * The separate split-adjusted history is refreshed daily.
 */
const GAP_REPAIR_DAYS = 4;

interface PriceMember {
	id: number;
	listingId: number;
	isin: string;
	coveredFrom: string | null;
}

export interface PriceCoverage {
	oldest: string | null;
	newest: string | null;
	coveredFrom: string | null;
}

export interface HistoryRange {
	minDate: string;
	maxDate: string;
	kind: 'backfill' | 'gap';
}

async function currentMembers(ctx: JobContext): Promise<PriceMember[]> {
	return bfMembers(ctx.db);
}

/** Oldest and latest stored trade dates per instrument, one query for the whole universe. */
async function priceWatermarks(
	ctx: JobContext
): Promise<Map<number, { oldest: string; newest: string }>> {
	const rows = await ctx.db
		.select({
			instrumentId: eodPrice.listingId,
			oldest: min(eodPrice.tradeDate),
			newest: max(eodPrice.tradeDate)
		})
		.from(eodPrice)
		.where(and(eq(eodPrice.source, BF_SOURCE), eq(eodPrice.feed, 'XETR'), eq(eodPrice.adjustment, 'raw')))
		.groupBy(eodPrice.listingId);
	const byInstrument = new Map<number, { oldest: string; newest: string }>();
	for (const row of rows) {
		if (row.oldest !== null && row.newest !== null) {
			byInstrument.set(row.instrumentId, { oldest: row.oldest, newest: row.newest });
		}
	}
	return byInstrument;
}

/** Pure range planner: historical-prefix repair and recent-gap repair are independent. */
export function planHistoryRanges(runDate: string, coverage: PriceCoverage): HistoryRange[] {
	const targetFrom = subtractYears(runDate, BACKFILL_YEARS);
	const ranges: HistoryRange[] = [];

	if (coverage.oldest === null || coverage.newest === null) {
		if (coverage.coveredFrom === null || coverage.coveredFrom > targetFrom) {
			ranges.push({
				minDate: targetFrom,
				maxDate:
					coverage.coveredFrom === null ? runDate : addDays(coverage.coveredFrom, -1),
				kind: 'backfill'
			});
		}
		return ranges;
	}

	if (coverage.coveredFrom === null || coverage.coveredFrom > targetFrom) {
		const prefixEnd = addDays(coverage.oldest, -1);
		if (targetFrom <= prefixEnd) {
			ranges.push({ minDate: targetFrom, maxDate: prefixEnd, kind: 'backfill' });
		}
	}
	if (coverage.newest < addDays(runDate, -GAP_REPAIR_DAYS)) {
		ranges.push({ minDate: addDays(coverage.newest, 1), maxDate: runDate, kind: 'gap' });
	}
	return ranges;
}

async function fetchHistory(isin: string, range: HistoryRange, cleanSplit = false) {
	const rows: {
		date: string;
		open: number | null;
		high: number | null;
		low: number | null;
		close: number;
		turnoverPieces: number | null;
	}[] = [];
	for (let offset = 0; ; offset += PAGE_SIZE) {
		const page = await bfRequest('/data/price_history', {
			params: {
				isin,
				mic: 'XETR',
				minDate: range.minDate,
				maxDate: range.maxDate,
				cleanSplit,
				cleanPayout: false,
				cleanSubscription: false,
				limit: PAGE_SIZE,
				offset
			},
			schema: priceHistoryResponse,
			archiveName:
				range.kind === 'backfill'
					? `price_history_${isin}_${range.minDate}_${range.maxDate}_${offset}.json`
					: undefined
		});
		if (page.data === undefined) {
			// `{}` response: the handshake was rejected (salt rotated?) — fail loudly
			throw new Error(`price_history returned empty object for ${isin} — tracing handshake likely broken`);
		}
		rows.push(...page.data);
		if (page.data.length < PAGE_SIZE || rows.length >= (page.totalCount ?? rows.length)) break;
	}
	return rows;
}

/**
 * EOD price history for current index members: three-year backfill for new
 * instruments and legacy prefixes, plus gap repair when snapshot closes lag.
 * Split-adjusted history is refreshed daily to keep the chart basis consistent.
 */
export const pricesJob: Job = {
	name: 'bf_prices',
	source: BF_SOURCE,
	async run(ctx): Promise<JobStats> {
		const members = await currentMembers(ctx);
		const watermarks = await priceWatermarks(ctx);
		let inserted = 0;
		let skipped = 0;
		let failed = 0;
		let requests = 0;
		let backfilled = 0;
		for (const member of members) {
			try {
				const watermark = watermarks.get(member.listingId);
				const coverage: PriceCoverage = {
					oldest: watermark?.oldest ?? null,
					newest: watermark?.newest ?? null,
					coveredFrom: member.coveredFrom
				};
				const ranges: (HistoryRange & { split?: boolean })[] = [...planHistoryRanges(ctx.runDate, coverage), { minDate: subtractYears(ctx.runDate, BACKFILL_YEARS), maxDate: addDays(ctx.runDate, -1), kind: 'gap', split: true }];
				const targetFrom = subtractYears(ctx.runDate, BACKFILL_YEARS);
				const needsCoverageCheckpoint =
					member.coveredFrom === null || member.coveredFrom > targetFrom;
				let memberRows = 0;
				for (const range of ranges) {
					const rows = await fetchHistory(member.isin, range, range.split);
					requests++;
					if (range.kind === 'backfill') backfilled++;
					if (rows.length === 0) continue;
					const insertedRows = await storePrices(ctx.db,
							rows.map((row) => ({
								listingId: member.listingId,
								source: BF_SOURCE, feed: 'XETR', observedAt: new Date(),
								adjustment: range.split ? 'split' : 'raw',
								evidence: { cleanSplit: range.split === true, cleanPayout: false, cleanSubscription: false, through: range.maxDate },
								sourceRecordId: fingerprint([BF_SOURCE, member.listingId, range.split ? 'split' : 'raw', row]),
								tradeDate: row.date,
								open: row.open?.toString(),
								high: row.high?.toString(),
								low: row.low?.toString(),
								close: row.close.toString(),
								volume: row.turnoverPieces === null ? null : Math.round(row.turnoverPieces),
								currency: 'EUR'
							}))
						);
					memberRows += insertedRows;
				}
				if (needsCoverageCheckpoint) {
					await ctx.db
						.update(listing)
						.set({ priceHistoryCoveredFrom: targetFrom })
						.where(eq(listing.id, member.listingId));
				}
				inserted += memberRows;
				if (memberRows === 0) skipped++;
			} catch (err) {
				// API in the penalty box: abort instead of grinding through the rest
				if (err instanceof BfUnavailableError) throw err;
				failed++;
				ctx.log(`prices failed for ${member.isin}: ${String(err)}`);
			}
		}
		if (failed > 0 && failed === members.length) {
			throw new Error('price ingestion failed for every instrument');
		}
		return { instruments: members.length, requests, backfilled, rows_inserted: inserted, skipped, failed };
	}
};
