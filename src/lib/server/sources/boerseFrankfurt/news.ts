import { eq, isNull } from 'drizzle-orm';
import { indexMembership, instrument, newsItem } from '../../db/schema.js';
import type { Job, JobContext, JobStats } from '../../pipeline/types.js';
import { isoDate, md5 } from '../../util.js';
import { bfRequest, BF_SOURCE, BfUnavailableError } from './client.js';
import { instrumentNewsResponse, type InstrumentNewsItem } from './schemas.js';

/** News timestamps carry a UTC offset; the PIT guard day is Berlin-calendar. */
const EXCHANGE_TIMEZONE = 'Europe/Berlin';
/**
 * One newest page per ISIN per run — the natural-key dedupe absorbs the daily
 * overlap, and history beyond the latest page is out of scope (headlines only,
 * no backfill). Bump if an ISIN ever exceeds this in a single day.
 */
const PAGE_LIMIT = 50;

/**
 * A `{}` response from a handshake-gated endpoint: systemic (salt rotated?),
 * not per-ISIN — rethrown job-fatal instead of grinding through the rest.
 */
class BfHandshakeError extends Error {}

export interface NewsMember {
	id: number;
	issuerId: number;
	isin: string;
}

export interface MappedNewsItem {
	source: string;
	externalId: string;
	instrumentId: number;
	issuerId: number;
	isin: string;
	headline: string;
	newsType: string | null;
	publishedAt: Date;
	publishedDate: string;
	naturalKeyHash: string;
	raw: unknown;
}

/**
 * Map one instrument_news page to news_item rows. Items with an unparseable
 * timestamp are skipped and counted, never fatal. The natural key spans
 * source|externalId|isin so the same story linked to two share classes keeps
 * one row per instrument.
 */
export function mapInstrumentNews(
	items: InstrumentNewsItem[],
	member: NewsMember
): { rows: MappedNewsItem[]; unparseable: number } {
	const rows: MappedNewsItem[] = [];
	let unparseable = 0;
	for (const item of items) {
		const publishedAt = new Date(item.time);
		if (Number.isNaN(publishedAt.getTime())) {
			unparseable++;
			continue;
		}
		const externalId = String(item.id);
		rows.push({
			source: BF_SOURCE,
			externalId,
			instrumentId: member.id,
			issuerId: member.issuerId,
			isin: member.isin,
			headline: item.headline,
			newsType: item.newsType ?? null,
			publishedAt,
			publishedDate: isoDate(publishedAt, EXCHANGE_TIMEZONE),
			naturalKeyHash: md5(`${BF_SOURCE}|${externalId}|${member.isin}`),
			raw: item
		});
	}
	return { rows, unparseable };
}

async function fetchInstrumentNews(isin: string) {
	// newsType accepts ALL | AD_HOC (EnumInstrumentNewsType); no per-item type
	// comes back, so ad-hoc tagging would cost a second request per ISIN and is
	// deliberately left out — the detail endpoint (data/news?id=) has categories.
	const page = await bfRequest('/data/instrument_news', {
		params: { isin, newsType: 'ALL', lang: 'de', offset: 0, limit: PAGE_LIMIT, withPaging: true },
		schema: instrumentNewsResponse,
		archiveName: `instrument_news_${isin}.json`
	});
	if (page.data === undefined) {
		throw new BfHandshakeError(
			`instrument_news returned empty object for ${isin} — tracing handshake likely broken`
		);
	}
	return page.data;
}

async function currentMembers(ctx: JobContext): Promise<NewsMember[]> {
	return ctx.db
		.selectDistinct({ id: instrument.id, issuerId: instrument.issuerId, isin: instrument.isin })
		.from(instrument)
		.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
		.where(isNull(indexMembership.validTo));
}

/**
 * Company-news headlines for current index members: one instrument_news
 * request per ISIN per day (~160 × 2.5s limiter ≈ 7 min), newest page only.
 * Re-fetched headlines dedupe on the unique natural-key hash, so re-runs are
 * idempotent and `already_known` ≈ `fetched` on a normal day.
 */
export const newsJob: Job = {
	name: 'bf_news',
	source: BF_SOURCE,
	async run(ctx): Promise<JobStats> {
		const members = await currentMembers(ctx);
		let fetched = 0;
		let inserted = 0;
		let unparseable = 0;
		let failed = 0;
		for (const member of members) {
			try {
				const items = await fetchInstrumentNews(member.isin);
				const mapped = mapInstrumentNews(items, member);
				fetched += items.length;
				unparseable += mapped.unparseable;
				if (mapped.rows.length === 0) continue;
				const result = await ctx.db
					.insert(newsItem)
					.values(mapped.rows)
					.onConflictDoNothing({ target: newsItem.naturalKeyHash })
					.returning({ id: newsItem.id });
				inserted += result.length;
			} catch (err) {
				// API in the penalty box or handshake rejected: abort instead of
				// grinding through the rest
				if (err instanceof BfUnavailableError || err instanceof BfHandshakeError) throw err;
				failed++;
				ctx.log(`news failed for ${member.isin}: ${String(err)}`);
			}
		}
		if (failed > 0 && failed === members.length) {
			throw new Error('news ingestion failed for every instrument');
		}
		return {
			instruments: members.length,
			fetched,
			inserted,
			already_known: fetched - unparseable - inserted,
			unparseable,
			failed
		};
	}
};
