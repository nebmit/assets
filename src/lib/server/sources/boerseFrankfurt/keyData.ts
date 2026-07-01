import { eq, isNull } from 'drizzle-orm';
import { fundamental, indexMembership, instrument } from '../../db/schema.js';
import { METRICS } from '../../fundamentals/metrics.js';
import type { Job, JobStats } from '../../pipeline/types.js';
import { bfRequest, BF_SOURCE } from './client.js';
import { equityKeyData } from './schemas.js';

/**
 * Fundamentals bootstrap from Börse Frankfurt equity_key_data: daily
 * point-in-time snapshot of EPS ("winPerShare"), shares outstanding, market
 * cap and dividend per share. BF publishes only current trailing values, so
 * periodEnd/publishedDate are the fetch date; the ESEF pipeline later adds
 * proper reporting periods under its own source tag.
 */
export const keyDataJob: Job = {
	name: 'bf_key_data',
	source: BF_SOURCE,
	async run(ctx): Promise<JobStats> {
		const members = await ctx.db
			.selectDistinct({ id: instrument.id, isin: instrument.isin, issuerId: instrument.issuerId })
			.from(instrument)
			.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
			.where(isNull(indexMembership.validTo));

		let rows = 0;
		let failed = 0;
		for (const member of members) {
			try {
				const data = await bfRequest('/data/equity_key_data', {
					params: { isin: member.isin },
					schema: equityKeyData
				});
				const values: [string, number | null | undefined][] = [
					[METRICS.epsBasic, data.winPerShare],
					[METRICS.sharesOutstanding, data.numberOfShares],
					[METRICS.marketCap, data.marketCapitalization],
					[METRICS.dividendPerShare, data.dividendPerShare]
				];
				for (const [metric, value] of values) {
					if (value === null || value === undefined) continue;
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
					rows++;
				}
			} catch (err) {
				failed++;
				ctx.log(`key data failed for ${member.isin}: ${String(err)}`);
			}
		}
		if (failed > 0 && failed === members.length) {
			throw new Error('key data ingestion failed for every instrument');
		}
		return { instruments: members.length, rows_upserted: rows, failed };
	}
};
