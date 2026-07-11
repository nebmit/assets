import { eq, isNull, max, min } from 'drizzle-orm';
import { subtractYears } from '../../../date.js';
import { eodPrice, indexMembership, instrument } from '../../db/schema.js';
import type { Job, JobContext, JobStats } from '../../pipeline/types.js';
import { addDays } from '../../util.js';
import { bfRequest, BF_SOURCE, BfUnavailableError } from './client.js';
import { priceHistoryResponse } from './schemas.js';

const BACKFILL_YEARS = 3;
const PAGE_SIZE = 1000;

/**
 * The snapshot job supplies the daily close for every instrument, so
 * price_history (one request per instrument — expensive against the API's
 * rate limits) is only fetched for uncovered history or after multi-day gaps.
 */
const GAP_REPAIR_DAYS = 4;

interface PriceMember {
	id: number;
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
	return ctx.db
		.selectDistinct({
			id: instrument.id,
			isin: instrument.isin,
			coveredFrom: instrument.priceHistoryCoveredFrom
		})
		.from(instrument)
		.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
		.where(isNull(indexMembership.validTo));
}

/** Oldest and latest stored trade dates per instrument, one query for the whole universe. */
async function priceWatermarks(
	ctx: JobContext
): Promise<Map<number, { oldest: string; newest: string }>> {
	const rows = await ctx.db
		.select({
			instrumentId: eodPrice.instrumentId,
			oldest: min(eodPrice.tradeDate),
			newest: max(eodPrice.tradeDate)
		})
		.from(eodPrice)
		.groupBy(eodPrice.instrumentId);
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

async function fetchHistory(isin: string, range: HistoryRange) {
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
				cleanSplit: false,
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
 * Steady state makes zero requests.
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
				const watermark = watermarks.get(member.id);
				const coverage: PriceCoverage = {
					oldest: watermark?.oldest ?? null,
					newest: watermark?.newest ?? null,
					coveredFrom: member.coveredFrom
				};
				const ranges = planHistoryRanges(ctx.runDate, coverage);
				const targetFrom = subtractYears(ctx.runDate, BACKFILL_YEARS);
				const needsCoverageCheckpoint =
					member.coveredFrom === null || member.coveredFrom > targetFrom;
				if (ranges.length === 0 && !needsCoverageCheckpoint) {
					skipped++;
					continue;
				}
				let memberRows = 0;
				for (const range of ranges) {
					const rows = await fetchHistory(member.isin, range);
					requests++;
					if (range.kind === 'backfill') backfilled++;
					if (rows.length === 0) continue;
					const insertedRows = await ctx.db
						.insert(eodPrice)
						.values(
							rows.map((row) => ({
								instrumentId: member.id,
								tradeDate: row.date,
								open: row.open?.toString(),
								high: row.high?.toString(),
								low: row.low?.toString(),
								close: row.close.toString(),
								volume: row.turnoverPieces === null ? null : Math.round(row.turnoverPieces),
								currency: 'EUR'
							}))
						)
						.onConflictDoNothing()
						.returning({ instrumentId: eodPrice.instrumentId });
					memberRows += insertedRows.length;
				}
				if (needsCoverageCheckpoint) {
					await ctx.db
						.update(instrument)
						.set({ priceHistoryCoveredFrom: targetFrom })
						.where(eq(instrument.id, member.id));
				}
				inserted += memberRows;
				if (ranges.length === 0 || memberRows === 0) skipped++;
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
