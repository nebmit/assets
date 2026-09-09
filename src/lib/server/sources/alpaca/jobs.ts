import { isDeepStrictEqual } from 'node:util';
import { applyListingRename } from './rename.js';
import { storePrices } from '../../assets/observations.js';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { corporateAction, instrument, issuer, listing } from '../../db/schema.js';
import type { Job } from '../../pipeline/types.js';
import { addDays, isoDate } from '../../util.js';
import { subtractYears } from '../../../date.js';
import { fingerprint } from '../../assets/evidence.js';
import { alpacaRequest, AlpacaAccessError } from './client.js';
import { actionSymbols, parseActions, parseBars } from './parse.js';
import { acceptanceTime } from '../sec/parse.js';
import { symbolKey } from '../sec/universe.js';

export const alpacaPricesJob: Job = { name: 'alpaca_prices', source: 'alpaca', async run(ctx) {
	const listings = await ctx.db.select().from(listing).where(and(eq(listing.source, 'alpaca'), isNull(listing.validTo)));
	// A completed New York calendar day is always older than the Basic SIP delay.
	const through = [addDays(ctx.runDate, -1), addDays(isoDate(new Date(), 'America/New_York'), -1)].sort()[0];
	let inserted = 0, failed = 0, missing = 0;
	for (let offset = 0; offset < listings.length; offset += 100) {
		const batch = listings.slice(offset, offset + 100).filter((l) => l.symbol !== null);
		if (!batch.length) continue;
		const symbols = batch.map((l) => l.symbol!);
		const from = batch.some((l) => !l.priceHistoryCoveredFrom) ? subtractYears(through, 3) : addDays(through, -10);
		const seen = new Set<string>();
		try {
			let token: string | null = null; const tokens = new Set<string>();
			do {
				const response = await alpacaRequest('/v2/stocks/bars', { symbols: symbols.join(','), timeframe: '1Day', feed: 'sip', currency: 'USD', adjustment: 'raw', asof: through, start: from, end: acceptanceTime(`${through}T23:59:59`), limit: '10000', ...(token ? { page_token: token } : {}) });
				const page = parseBars(response.data, new Set(symbols), through);
				inserted += await storePrices(ctx.db, page.rows.map((row) => {
					const target = batch.find((l) => l.symbol === row.symbol)!; seen.add(row.symbol);
					const { symbol: _, ...values } = row;
					return { ...values, listingId: target.id, source: 'alpaca', currency: 'USD', feed: 'sip', sourceRecordId: fingerprint(['alpaca', target.id, values]), observedAt: new Date(response.evidence.observedAt), evidence: response.evidence };
				}));
				token = page.next;
				if (token && tokens.has(token)) throw new Error('Alpaca repeated page token'); if (token) tokens.add(token);
			} while (token);
			for (const target of batch) {
				if (!seen.has(target.symbol!)) { missing++; continue; }
				await ctx.db.update(listing).set({ priceHistoryCoveredFrom: target.priceHistoryCoveredFrom ?? from }).where(eq(listing.id, target.id));
			}
		} catch (error) { if (error instanceof AlpacaAccessError) throw error; failed++; ctx.log(String(error)); }
	}
	return { listings: listings.length, inserted, failed, missing };
} };

export const alpacaActionsJob: Job = { name: 'alpaca_actions', source: 'alpaca', async run(ctx) {
	const targets = await ctx.db.select({ listing, cik: issuer.cik }).from(listing).innerJoin(instrument, eq(instrument.id, listing.instrumentId)).innerJoin(issuer, eq(issuer.id, instrument.issuerId)).where(and(eq(listing.source, 'alpaca'), isNull(listing.validTo)));
	let inserted = 0;
	for (let offset = 0; offset < targets.length; offset += 100) {
		const batch = targets.slice(offset, offset + 100);
		const from = subtractYears(ctx.runDate, 4);
		const known = await ctx.db.select().from(corporateAction).where(inArray(corporateAction.instrumentId, batch.map((t) => t.listing.instrumentId))).orderBy(desc(corporateAction.observedAt), desc(corporateAction.id));
		const latest = new Map<string, typeof known[number]>();
		for (const action of known) if (!latest.has(`${action.instrumentId}:${action.externalId}`)) latest.set(`${action.instrumentId}:${action.externalId}`, action);
		let token: string | null = null; const tokens = new Set<string>();
		do {
			const response = await alpacaRequest('/v1/corporate-actions', { symbols: batch.map((r) => r.listing.symbol).filter(Boolean).join(','), start: from, end: ctx.runDate, limit: '1000', ...(token ? { page_token: token } : {}) });
			const page = parseActions(response.data);
			for (const action of page.actions) {
				const related = new Set(actionSymbols(action).map(symbolKey));
				const matched = batch.filter((r) => related.has(symbolKey(r.listing.symbol ?? '')));
				if (!matched.length) throw new Error(`Unmatched corporate action ${action.externalId}`);
				for (const target of matched) {
					const actionKey = `${target.listing.instrumentId}:${action.externalId}`;
					const { symbol: _, ...values } = action;
					if (action.type === 'name_changes' && target.listing.symbol === action.metadata.old_symbol && action.exDate < target.listing.validFrom) {
						values.qualification = 'unqualified';
						values.metadata = { ...values.metadata, identityQualificationReason: 'rename_predates_listing_identity' };
					}
					const renameResult = target.cik ? await applyListingRename(ctx.db, target.listing, target.cik, action, ctx.runDate, response.evidence) : 'not_applicable';
					if (renameResult === 'conflicting_listing') {
						values.qualification = 'unqualified';
						values.metadata = { ...values.metadata, identityQualificationReason: 'destination_listing_occupied' };
						ctx.log(`Unqualified rename ${action.externalId}: destination listing is already occupied`);
					}
					const previous = latest.get(actionKey);
					if (!previous || !isDeepStrictEqual(previous.metadata, values.metadata) || previous.qualification !== values.qualification) {
						const result = await ctx.db.insert(corporateAction).values({ ...values, instrumentId: target.listing.instrumentId, source: 'alpaca', sourceRecordId: fingerprint([target.listing.instrumentId, action, response.evidence.observedAt]), observedAt: new Date(response.evidence.observedAt), evidence: response.evidence }).onConflictDoNothing().returning();
						inserted += result.length; if (result[0]) latest.set(actionKey, result[0]);
					}
				}
			}
			token = page.next; if (token && tokens.has(token)) throw new Error('Alpaca repeated page token'); if (token) tokens.add(token);
		} while (token);
		for (const target of batch) await ctx.db.update(listing).set({ metadata: { ...target.listing.metadata, actionsCoveredFrom: from, actionsCheckedAt: new Date().toISOString() } }).where(eq(listing.id, target.listing.id));
	}
	return { inserted, listings: targets.length };
} };
