import { eq, isNull } from 'drizzle-orm';
import { eodPrice, fundamental, indexMembership, instrument } from '../../db/schema.js';
import { METRICS, type Metric } from '../../fundamentals/metrics.js';
import type { Job, JobStats } from '../../pipeline/types.js';
import { isoDate } from '../../util.js';
import { BF_SOURCE } from './client.js';

/** XETR trading dates are Berlin-calendar days regardless of worker TZ. */
const EXCHANGE_TIMEZONE = 'Europe/Berlin';
import type { EquitySearchRow } from './schemas.js';
import { fetchIndexMembers, INDICES } from './universe.js';

export interface SnapshotMapping {
	fundamentals: { metric: Metric; value: number }[];
	/** Previous close harvested from the search overview, if usable. */
	close: { tradeDate: string; close: number } | null;
}

/**
 * Map one equity_search row to fundamentals and (maybe) an EOD close.
 * overview.lastPrice is a delayed live price during trading hours, so it only
 * counts as a close when its timestamp falls on a day before runDate (the
 * pipeline runs pre-market, where lastPrice = previous close).
 */
export function mapSnapshotRow(row: EquitySearchRow, runDate: string): SnapshotMapping {
	const fundamentals: SnapshotMapping['fundamentals'] = [];
	const push = (metric: Metric, value: number | null | undefined) => {
		if (value !== null && value !== undefined) fundamentals.push({ metric, value });
	};
	push(METRICS.epsBasic, row.keyData?.earningsPerShareBasic);
	push(METRICS.marketCap, row.keyData?.marketCapitalisation);
	push(METRICS.dividendPerShare, row.keyData?.dividendPerShare);
	push(METRICS.priceToBook, row.keyData?.priceBookRatio);

	let close: SnapshotMapping['close'] = null;
	const price = row.overview?.lastPrice;
	const priceTime = row.overview?.dateTimeLastPrice;
	if (price !== null && price !== undefined && price > 0 && priceTime) {
		const tradeDate = isoDate(new Date(priceTime), EXCHANGE_TIMEZONE);
		if (tradeDate < runDate) close = { tradeDate, close: price };
	}
	return { fundamentals, close };
}

/**
 * Daily point-in-time snapshot for the whole universe from the same
 * equity_search responses the constituents job uses — one request per index
 * instead of one per instrument, to stay far below the API's rate limits.
 * BF publishes only current trailing values, so periodEnd/publishedDate are
 * the run date; the ESEF pipeline later adds real reporting periods under
 * its own source tag.
 */
export const snapshotJob: Job = {
	name: 'bf_snapshot',
	source: BF_SOURCE,
	async run(ctx): Promise<JobStats> {
		const members = await ctx.db
			.selectDistinct({ id: instrument.id, isin: instrument.isin, issuerId: instrument.issuerId })
			.from(instrument)
			.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
			.where(isNull(indexMembership.validTo));
		const byIsin = new Map(members.map((m) => [m.isin, m]));

		let fundamentalRows = 0;
		let closesInserted = 0;
		let unknownIsins = 0;
		for (const index of INDICES) {
			const rows = await fetchIndexMembers(index.isin, index.name, 'snapshot');
			for (const row of rows) {
				const member = byIsin.get(row.isin);
				if (!member) {
					unknownIsins++;
					continue;
				}
				const mapped = mapSnapshotRow(row, ctx.runDate);
				for (const { metric, value } of mapped.fundamentals) {
					await ctx.db
						.insert(fundamental)
						.values({
							issuerId: member.issuerId,
							metric,
							value: value.toString(),
							currency: 'EUR',
							periodType: 'LATEST',
							periodEnd: ctx.runDate,
							publishedDate: ctx.runDate,
							source: 'boerse_frankfurt'
						})
						.onConflictDoUpdate({
							target: [fundamental.issuerId, fundamental.metric, fundamental.periodEnd, fundamental.source],
							set: { value: value.toString(), publishedDate: ctx.runDate }
						});
					fundamentalRows++;
				}
				if (mapped.close) {
					// price_history backfill rows (with OHLC/volume) take precedence
					const inserted = await ctx.db
						.insert(eodPrice)
						.values({
							instrumentId: member.id,
							tradeDate: mapped.close.tradeDate,
							close: mapped.close.close.toString(),
							currency: 'EUR'
						})
						.onConflictDoNothing()
						.returning({ instrumentId: eodPrice.instrumentId });
					closesInserted += inserted.length;
				}
			}
		}
		return {
			universe: members.length,
			fundamental_rows: fundamentalRows,
			closes_inserted: closesInserted,
			unknown_isins: unknownIsins
		};
	}
};
