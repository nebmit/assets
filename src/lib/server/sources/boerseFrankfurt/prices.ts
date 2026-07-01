import { and, eq, isNull, max } from 'drizzle-orm';
import { eodPrice, indexMembership, instrument } from '../../db/schema.js';
import type { Job, JobContext, JobStats } from '../../pipeline/types.js';
import { addDays } from '../../util.js';
import { bfRequest, BF_SOURCE } from './client.js';
import { priceHistoryResponse } from './schemas.js';

const BACKFILL_DAYS = 730;
const PAGE_SIZE = 1000;

async function currentMembers(ctx: JobContext): Promise<{ id: number; isin: string }[]> {
	return ctx.db
		.selectDistinct({ id: instrument.id, isin: instrument.isin })
		.from(instrument)
		.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
		.where(isNull(indexMembership.validTo));
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
 * EOD price ingestion for current index members. Incremental per instrument
 * from its last stored trade date; first run backfills ~2 years.
 */
export const pricesJob: Job = {
	name: 'bf_prices',
	source: BF_SOURCE,
	async run(ctx): Promise<JobStats> {
		const members = await currentMembers(ctx);
		let inserted = 0;
		let skipped = 0;
		let failed = 0;
		for (const member of members) {
			try {
				const [{ watermark }] = await ctx.db
					.select({ watermark: max(eodPrice.tradeDate) })
					.from(eodPrice)
					.where(eq(eodPrice.instrumentId, member.id));
				const minDate = watermark ? addDays(watermark, 1) : addDays(ctx.runDate, -BACKFILL_DAYS);
				if (minDate > ctx.runDate) {
					skipped++;
					continue;
				}
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
