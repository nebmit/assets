import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { indexMembership, instrument, issuer } from '../../db/schema.js';
import type { Job, JobContext, JobStats } from '../../pipeline/types.js';
import { bfRequest, BF_SOURCE } from './client.js';
import { equityMasterData, equitySearchResponse, instrumentInformation } from './schemas.js';

export const INDICES = [
	{ name: 'DAX', isin: 'DE0008469008' },
	{ name: 'MDAX', isin: 'DE0008467416' },
	{ name: 'SDAX', isin: 'DE0009653386' }
] as const;

export type IndexName = (typeof INDICES)[number]['name'];

export interface Constituent {
	isin: string;
	wkn: string | null;
	name: string;
	slug: string | null;
}

export async function fetchConstituents(indexIsin: string, indexName: string): Promise<Constituent[]> {
	const pageSize = 200;
	const result: Constituent[] = [];
	for (let offset = 0; ; offset += pageSize) {
		const page = await bfRequest('/search/equity_search', {
			body: {
				indices: [indexIsin],
				lang: 'en',
				offset,
				limit: pageSize,
				sorting: 'NAME',
				sortOrder: 'ASC'
			},
			schema: equitySearchResponse,
			archiveName: `equity_search_${indexName}_${offset}.json`
		});
		for (const row of page.data) {
			result.push({
				isin: row.isin,
				wkn: row.wkn ?? null,
				name: (row.name.originalValue ?? row.isin).trim(),
				slug: row.slug ?? null
			});
		}
		if (result.length >= page.recordsTotal || page.data.length === 0) break;
	}
	return result;
}

/** Instrument ids for current members of an index (validTo null = open interval). */
async function activeMemberIds(ctx: JobContext, indexName: IndexName): Promise<Set<number>> {
	const rows = await ctx.db
		.select({ instrumentId: indexMembership.instrumentId })
		.from(indexMembership)
		.where(and(eq(indexMembership.indexName, indexName), isNull(indexMembership.validTo)));
	return new Set(rows.map((r) => r.instrumentId));
}

async function upsertInstruments(ctx: JobContext, members: Constituent[]): Promise<Map<string, number>> {
	const byIsin = new Map<string, number>();
	const existing = members.length
		? await ctx.db
				.select({ id: instrument.id, isin: instrument.isin })
				.from(instrument)
				.where(inArray(instrument.isin, members.map((m) => m.isin)))
		: [];
	for (const row of existing) byIsin.set(row.isin, row.id);

	for (const member of members) {
		const existingId = byIsin.get(member.isin);
		if (existingId !== undefined) {
			await ctx.db
				.update(instrument)
				.set({ lastSeen: ctx.runDate, wkn: member.wkn ?? undefined })
				.where(eq(instrument.id, existingId));
			continue;
		}
		const [newIssuer] = await ctx.db.insert(issuer).values({ name: member.name }).returning({ id: issuer.id });
		const [newInstrument] = await ctx.db
			.insert(instrument)
			.values({
				issuerId: newIssuer.id,
				isin: member.isin,
				wkn: member.wkn,
				currency: 'EUR',
				firstSeen: ctx.runDate,
				lastSeen: ctx.runDate
			})
			.returning({ id: instrument.id });
		byIsin.set(member.isin, newInstrument.id);
	}
	return byIsin;
}

/**
 * Daily universe assembly: fetch DAX/MDAX/SDAX constituents, upsert
 * issuers/instruments, and diff-update membership intervals. A member on date
 * D satisfies validFrom <= D < validTo (validTo null = still a member).
 */
export const constituentsJob: Job = {
	name: 'bf_constituents',
	source: BF_SOURCE,
	async run(ctx): Promise<JobStats> {
		const stats: JobStats = {};
		let added = 0;
		let removed = 0;
		for (const index of INDICES) {
			const members = await fetchConstituents(index.isin, index.name);
			if (members.length === 0) throw new Error(`no constituents returned for ${index.name}`);
			stats[`${index.name}_members`] = members.length;

			const idByIsin = await upsertInstruments(ctx, members);
			const active = await activeMemberIds(ctx, index.name);
			const current = new Set(idByIsin.values());

			for (const instrumentId of current) {
				if (!active.has(instrumentId)) {
					await ctx.db
						.insert(indexMembership)
						.values({ instrumentId, indexName: index.name, validFrom: ctx.runDate });
					added++;
				}
			}
			for (const instrumentId of active) {
				if (!current.has(instrumentId)) {
					await ctx.db
						.update(indexMembership)
						.set({ validTo: ctx.runDate })
						.where(
							and(
								eq(indexMembership.instrumentId, instrumentId),
								eq(indexMembership.indexName, index.name),
								isNull(indexMembership.validTo)
							)
						);
					removed++;
				}
			}
			ctx.log(`${index.name}: ${members.length} members`);
		}
		stats.memberships_opened = added;
		stats.memberships_closed = removed;
		return stats;
	}
};

/**
 * Enrich instruments missing ticker or sector via instrument_information and
 * equity_master_data (two requests per instrument, so only fetch gaps).
 */
export const masterDataJob: Job = {
	name: 'bf_master_data',
	source: BF_SOURCE,
	async run(ctx): Promise<JobStats> {
		const gaps = await ctx.db
			.select({
				instrumentId: instrument.id,
				isin: instrument.isin,
				issuerId: instrument.issuerId,
				ticker: instrument.ticker,
				sector: issuer.sector
			})
			.from(instrument)
			.innerJoin(issuer, eq(issuer.id, instrument.issuerId))
			.where(or(isNull(instrument.ticker), isNull(issuer.sector)));

		let updated = 0;
		let failed = 0;
		for (const gap of gaps) {
			try {
				if (gap.ticker === null) {
					const info = await bfRequest('/data/instrument_information', {
						params: { isin: gap.isin },
						schema: instrumentInformation
					});
					await ctx.db
						.update(instrument)
						.set({ ticker: info.exchangeSymbol ?? null, wkn: info.wkn ?? undefined })
						.where(eq(instrument.id, gap.instrumentId));
				}
				if (gap.sector === null) {
					const master = await bfRequest('/data/equity_master_data', {
						params: { isin: gap.isin },
						schema: equityMasterData
					});
					if (master.sector?.originalValue) {
						await ctx.db
							.update(issuer)
							.set({ sector: master.sector.originalValue })
							.where(eq(issuer.id, gap.issuerId));
					}
				}
				updated++;
			} catch (err) {
				// one bad instrument must not sink the job; gaps retry next run
				failed++;
				ctx.log(`master data failed for ${gap.isin}: ${String(err)}`);
			}
		}
		return { gaps: gaps.length, updated, failed };
	}
};
