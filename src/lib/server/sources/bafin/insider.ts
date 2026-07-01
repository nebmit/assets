import { inArray } from 'drizzle-orm';
import { insiderTransaction, instrument } from '../../db/schema.js';
import { fetchText, RateLimiter } from '../../http.js';
import type { Job, JobStats } from '../../pipeline/types.js';
import { archiveRaw } from '../../rawArchive.js';
import { BAFIN_SOURCE, parseDealingsCsv } from './parse.js';

/**
 * BaFin DealingsInfo (directors' dealings, Art. 19 MAR). The portal's
 * Displaytag CSV export returns the full rolling 12-month window in one
 * request (no session needed): `d-4000784-e=1` selects CSV, `6578706f7274`
 * ("export" in hex) triggers it. ~1-2 working-day publication lag.
 */
const EXPORT_URL =
	'https://portal.mvp.bafin.de/database/DealingsInfo/sucheForm.do' +
	'?zeitraum=0&zeitraumVon=&zeitraumBis=&emittentName=&emittentIsin=&meldepflichtigerName=' +
	'&emittentButton=Suche+Emittent&d-4000784-e=1&6578706f7274=1';

const limiter = new RateLimiter(2000);

/**
 * Daily full-window sync: download the complete export, dedupe on natural-key
 * hash. Rows for issuers outside our universe are kept with issuerId null and
 * surfaced in stats (never dropped).
 */
export const insiderJob: Job = {
	name: 'bafin_insider',
	source: BAFIN_SOURCE,
	async run(ctx): Promise<JobStats> {
		const csvText = await fetchText(EXPORT_URL, {
			headers: {
				'user-agent':
					'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
				accept: 'text/csv,*/*'
			},
			timeoutMs: 120_000,
			limiter
		});
		await archiveRaw(BAFIN_SOURCE, 'dealings_export.csv', csvText);

		const dealings = parseDealingsCsv(csvText);
		if (dealings.length === 0) throw new Error('BaFin export parsed to zero rows');

		const isins = [...new Set(dealings.map((d) => d.isin).filter((v): v is string => v !== null))];
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
		for (let start = 0; start < dealings.length; start += batchSize) {
			const batch = dealings.slice(start, start + batchSize);
			const rows = batch.map((d) => {
				const issuerId = d.isin === null ? null : (issuerByIsin.get(d.isin) ?? null);
				if (issuerId !== null) matched++;
				return {
					issuerId,
					isin: d.isin,
					issuerNameRaw: d.issuerNameRaw,
					partyName: d.partyName,
					partyRole: d.partyRole,
					side: d.side,
					instrumentType: d.instrumentType,
					price: d.price?.toString(),
					amount: d.amount?.toString(),
					currency: d.currency,
					transactionDate: d.transactionDate,
					publishedDate: d.publishedDate,
					venue: d.venue,
					naturalKeyHash: d.naturalKeyHash,
					raw: d.raw
				};
			});
			const result = await ctx.db
				.insert(insiderTransaction)
				.values(rows)
				.onConflictDoNothing({ target: insiderTransaction.naturalKeyHash })
				.returning({ id: insiderTransaction.id });
			inserted += result.length;
		}

		return {
			rows_in_export: dealings.length,
			inserted,
			already_known: dealings.length - inserted,
			matched_to_universe: matched,
			unmatched: dealings.length - matched
		};
	}
};
