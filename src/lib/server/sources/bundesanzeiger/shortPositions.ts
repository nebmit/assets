import { validateOpenExport } from '../../shortSellers/analysis.js';
import { inArray, max, min } from 'drizzle-orm';
import { subtractYears } from '../../../date.js';
import { instrument, shortPosition, shortPositionSnapshot } from '../../db/schema.js';
import { CookieJar, fetchSession, RateLimiter } from '../../http.js';
import type { Job, JobContext, JobStats } from '../../pipeline/types.js';
import { archiveRaw } from '../../rawArchive.js';
import { addDays, daysBetween } from '../../util.js';
import {
	assertFilterFormFields,
	buildSearchBody,
	assertOpenScope,
	extractCsvExportUrl,
	extractFilterFormAction,
	FILTER_FORM_FIELDS,
	NLP_URL,
	type NlpFilters
} from './nlp.js';
import { BUNDESANZEIGER_SOURCE, parseShortPositionsCsv, type ParsedShortPosition } from './parse.js';

/**
 * Bundesanzeiger "Netto-Leerverkaufspositionen" — net short positions >= 0.5%
 * of issued share capital, disclosed under EU SSR 236/2012 Art. 6. This is the
 * official German publication venue (firms report to BaFin at 0.1%, but only
 * the >= 0.5% positions are published, and publication happens here).
 *
 * The portal is Apache Wicket: stateful and session-based. Each run does a
 * landing GET to mint a session, optionally POSTs the filter form, then GETs
 * the CSV export link parsed out of the resulting markup — the link carries a
 * page id that changes after every POST, so it is never hardcoded.
 *
 * Two exports are pulled and unioned:
 *   - a rolling *historical* window, which is what captures the sub-0.5%
 *     closing rows (a closing position is published once, then leaves the open
 *     register — polling the open list alone would miss it);
 *   - the *open* list, because a position's last change may predate the window
 *     entirely (141 of 483 open positions last changed over three years ago).
 */

const BACKFILL_YEARS = 3;
/** Steady-state window; comfortably wider than any plausible run gap. */
const WINDOW_DAYS = 90;
/** Re-fetch a little before the newest stored row so a boundary day can't slip. */
const OVERLAP_DAYS = 7;
/** The register is append-only; a frozen upstream is otherwise silent. */
const MAX_STALENESS_DAYS = 30;
const MAX_UNPARSEABLE_RATIO = 0.01;

// a government portal, and we make ~6 requests per run — be deliberately slow
const limiter = new RateLimiter(3000);

const BROWSER_HEADERS = {
	'user-agent':
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
	accept: 'text/html,application/xhtml+xml,text/csv,*/*',
	'accept-language': 'de-DE,de;q=0.9'
};

export interface PositionCoverage {
	oldest: string | null;
	newest: string | null;
}

export interface NlpWindow {
	/** ISO date (inclusive). */
	from: string;
	/** ISO date (inclusive). */
	to: string;
	kind: 'backfill' | 'window';
}

/**
 * Pure window planner, mirroring `planHistoryRanges` for prices: the watermark
 * is derived from the stored data, not from a cursor. An empty table backfills
 * `BACKFILL_YEARS`; afterwards a rolling window is used, widened when the
 * newest stored row is older than the window would reach.
 */
export function planWindow(runDate: string, coverage: PositionCoverage): NlpWindow {
	if (coverage.newest === null) {
		return { from: subtractYears(runDate, BACKFILL_YEARS), to: runDate, kind: 'backfill' };
	}
	const rolling = addDays(runDate, -WINDOW_DAYS);
	const sinceWatermark = addDays(coverage.newest, -OVERLAP_DAYS);
	return { from: rolling < sinceWatermark ? rolling : sinceWatermark, to: runDate, kind: 'window' };
}

/** `2026-07-29` → `29.07.2026`, the format the filter form expects. */
function toGermanDate(isoDay: string): string {
	const [year, month, day] = isoDay.split('-');
	return `${day}.${month}.${year}`;
}

/**
 * Run one export flow in its own session. Keeping the historical and open
 * flows on separate cookie jars means fetching the CSV resource link can never
 * dirty the Wicket page state a later POST depends on, and lets the open flow
 * fail without taking the run down.
 */
async function fetchExport(
	kind: 'open' | 'historical',
	filters: NlpFilters | null
): Promise<string> {
	const jar = new CookieJar();
	let page = await fetchSession(NLP_URL, {
		headers: BROWSER_HEADERS,
		timeoutMs: 30_000,
		retries: 2,
		limiter,
		jar
	});
	if (page.text.length < 1000) {
		throw new Error(`NLP landing page suspiciously short (${page.text.length} bytes)`);
	}
	if (jar.size === 0) throw new Error('NLP landing page returned no session cookie');
	await archiveRaw(BUNDESANZEIGER_SOURCE, `nlp_page_${kind}.html`, page.text);

	if (filters) {
		assertFilterFormFields(page.text, FILTER_FORM_FIELDS);
		page = await fetchSession(extractFilterFormAction(page.text), {
			method: 'POST',
			body: buildSearchBody(filters),
			headers: { ...BROWSER_HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
			timeoutMs: 60_000,
			retries: 2,
			limiter,
			jar
		});
	}

	if (kind === 'open') assertOpenScope(page.text);

	// re-read the export link *after* the POST: the page id has changed
	const csv = await fetchSession(extractCsvExportUrl(page.text), {
		headers: BROWSER_HEADERS,
		timeoutMs: 120_000,
		retries: 2,
		limiter,
		jar
	});
	// an expired session renders HTML with status 200, so check the type, not the status
	if (!csv.contentType?.startsWith('text/csv')) {
		throw new Error(
			`NLP export returned ${csv.contentType ?? 'no content-type'} instead of text/csv: ` +
				csv.text.slice(0, 200)
		);
	}
	await archiveRaw(BUNDESANZEIGER_SOURCE, `leerverkaeufe_${kind}.csv`, csv.text);
	return csv.text;
}

async function positionCoverage(ctx: JobContext): Promise<PositionCoverage> {
	const [row] = await ctx.db
		.select({ oldest: min(shortPosition.positionDate), newest: max(shortPosition.positionDate) })
		.from(shortPosition);
	return { oldest: row?.oldest ?? null, newest: row?.newest ?? null };
}

export const shortPositionsJob: Job = {
	name: 'bundesanzeiger_short_positions',
	source: BUNDESANZEIGER_SOURCE,
	async run(ctx): Promise<JobStats> {
		const window = planWindow(ctx.runDate, await positionCoverage(ctx));
		ctx.log(`net short positions: ${window.kind} ${window.from}..${window.to}`);

		const historicalCsv = await fetchExport('historical', {
			historical: true,
			dateFrom: toGermanDate(window.from),
			dateTo: toGermanDate(window.to)
		});
		const historical = parseShortPositionsCsv(historicalCsv);
		if (historical.rows.length === 0) {
			throw new Error(`NLP historical export parsed to zero rows for ${window.from}..${window.to}`);
		}
		const seen = historical.rows.length + historical.unparseable;
		if (historical.unparseable > seen * MAX_UNPARSEABLE_RATIO) {
			throw new Error(
				`NLP historical export: ${historical.unparseable} of ${seen} rows unparseable — format change?`
			);
		}
		const newestDate = historical.rows.reduce(
			(newest, row) => (row.positionDate > newest ? row.positionDate : newest),
			historical.rows[0].positionDate
		);
		if (daysBetween(newestDate, ctx.runDate) > MAX_STALENESS_DAYS) {
			throw new Error(
				`NLP register looks frozen: newest disclosure ${newestDate}, run date ${ctx.runDate}`
			);
		}

		// non-fatal: the window already covers everything that changed recently
		let openRows: ParsedShortPosition[] = [];
		let openExportFailed = 0;
		try {
			const open = parseShortPositionsCsv(await fetchExport('open', { historical: false }), true);
			const capturedAt = new Date();
			const diagnostics = validateOpenExport(open, capturedAt);
			await ctx.db.insert(shortPositionSnapshot).values({
				source: BUNDESANZEIGER_SOURCE, capturedAt, rows: open.rows, diagnostics
			});
			openRows = open.rows;
		} catch (err) {
			openExportFailed = 1;
			ctx.log(`NLP open-position export failed (continuing): ${String(err)}`);
		}

		const byHash = new Map(historical.rows.map((row) => [row.naturalKeyHash, row]));
		let openOnly = 0;
		for (const row of openRows) {
			if (byHash.has(row.naturalKeyHash)) continue;
			byHash.set(row.naturalKeyHash, row);
			openOnly++;
		}
		const rows = [...byHash.values()];

		const isins = [...new Set(rows.map((r) => r.isin).filter((v): v is string => v !== null))];
		const instruments = isins.length
			? await ctx.db
					.select({ isin: instrument.isin, issuerId: instrument.issuerId })
					.from(instrument)
					.where(inArray(instrument.isin, isins))
			: [];
		const issuerByIsin = new Map(instruments.map((i) => [i.isin, i.issuerId]));

		let inserted = 0;
		let matched = 0;
		const batchSize = 500;
		for (let start = 0; start < rows.length; start += batchSize) {
			const batch = rows.slice(start, start + batchSize);
			const values = batch.map((row) => {
				const issuerId = row.isin === null ? null : (issuerByIsin.get(row.isin) ?? null);
				if (issuerId !== null) matched++;
				return {
					source: BUNDESANZEIGER_SOURCE,
					issuerId,
					isin: row.isin,
					issuerNameRaw: row.issuerNameRaw,
					holderNameRaw: row.holderNameRaw,
					positionPct: row.positionPct.toString(),
					positionDate: row.positionDate,
					naturalKeyHash: row.naturalKeyHash,
					raw: row.raw
				};
			});
			const result = await ctx.db
				.insert(shortPosition)
				.values(values)
				.onConflictDoNothing({ target: shortPosition.naturalKeyHash })
				.returning({ id: shortPosition.id });
			inserted += result.length;
		}

		const dates = rows.map((r) => r.positionDate).sort();
		return {
			window_kind: window.kind,
			window_from: window.from,
			window_to: window.to,
			rows_in_export: historical.rows.length,
			open_rows: openRows.length,
			open_only_rows: openOnly,
			open_export_failed: openExportFailed,
			duplicates_collapsed: historical.duplicatesCollapsed,
			unparseable: historical.unparseable,
			inserted,
			already_known: rows.length - inserted,
			matched_to_universe: matched,
			unmatched: rows.length - matched,
			distinct_holders: new Set(rows.map((r) => r.holderNameRaw)).size,
			distinct_isins: isins.length,
			oldest_date: dates[0] ?? '',
			newest_date: dates[dates.length - 1] ?? ''
		};
	}
};
