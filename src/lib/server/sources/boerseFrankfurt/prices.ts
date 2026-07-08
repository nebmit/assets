import { eq, isNull, max } from 'drizzle-orm';
import { eodPrice, indexMembership, instrument } from '../../db/schema.js';
import type { Job, JobContext, JobStats } from '../../pipeline/types.js';
import { addDays } from '../../util.js';
import { bfRequest, BF_SOURCE, BfUnavailableError } from './client.js';
import { priceHistoryResponse } from './schemas.js';

const BACKFILL_DAYS = 730;
const PAGE_SIZE = 1000;
/**
 * The snapshot job supplies the daily close for every instrument, so
 * price_history (one request per instrument — expensive against the API's
 * rate limits) is only fetched for new instruments or after multi-day gaps.
 */
const GAP_REPAIR_DAYS = 4;

async function currentMembers(ctx: JobContext): Promise<{ id: number; isin: string }[]> {
	return ctx.db
		.selectDistinct({ id: instrument.id, isin: instrument.isin })
		.from(instrument)
		.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
		.where(isNull(indexMembership.validTo));
}

/** Latest stored trade date per instrument, one query for the whole universe. */
async function priceWatermarks(ctx: JobContext): Promise<Map<number, string>> {
	const rows = await ctx.db
		.select({ instrumentId: eodPrice.instrumentId, watermark: max(eodPrice.tradeDate) })
		.from(eodPrice)
		.groupBy(eodPrice.instrumentId);
	const byInstrument = new Map<number, string>();
	for (const row of rows) {
		if (row.watermark !== null) byInstrument.set(row.instrumentId, row.watermark);
	}
	return byInstrument;
}

async function fetchHistory(isin: string, minDate: string, maxDate: string, archive: boolean) {
	const rows: { date: string; open: number | null; high: number | null; low: number | null; close: number; turnoverPieces: number | null }[] = [];
	for (let offset = 0; ; offset += PAGE_SIZE) {
		const page = await bfRequest('/data/price_history', {
			params: {
				isin,
				mic: 'XETR',
				minDate,
				maxDate,
				cleanSplit: false,
				cleanPayout: false,
				cleanSubscription: false,
				limit: PAGE_SIZE,
				offset
			},
			schema: priceHistoryResponse,
			archiveName: archive ? `price_history_${isin}.json` : undefined
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
 * EOD price history for current index members: ~2-year backfill for new
 * instruments, gap repair when the snapshot closes have fallen behind.
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
		for (const member of members) {
			try {
				const watermark = watermarks.get(member.id) ?? null;
				if (watermark !== null && watermark >= addDays(ctx.runDate, -GAP_REPAIR_DAYS)) {
					skipped++;
					continue;
				}
				const minDate = watermark ? addDays(watermark, 1) : addDays(ctx.runDate, -BACKFILL_DAYS);
				const rows = await fetchHistory(member.isin, minDate, ctx.runDate, watermark === null);
				if (rows.length === 0) {
					skipped++;
					continue;
				}
				await ctx.db
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
					.onConflictDoNothing();
				inserted += rows.length;
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
		return { instruments: members.length, rows_inserted: inserted, skipped, failed };
	}
};
