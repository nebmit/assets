import { and, eq, isNull } from 'drizzle-orm';
import { corporateAction, indexMembership, instrument, issuer, listing, providerIdentifier, universe } from '../../db/schema.js';
import type { JobContext } from '../../pipeline/types.js';
import type { IndexSnapshot } from './indices.js';
import type { parseTickers, Listing } from './parse.js';

export function symbolKey(symbol: string): string { return symbol.toUpperCase().replaceAll('.', '-'); }
export function exchangeMic(exchange: string): string | null {
	return ({ Q: 'XNAS', NASDAQ: 'XNAS', Nasdaq: 'XNAS', N: 'XNYS', NYSE: 'XNYS', A: 'XASE', AMEX: 'XASE', 'NYSE American': 'XASE', Z: 'BATS', BATS: 'BATS' } as Record<string, string>)[exchange] ?? null;
}

/** Preserve holding-level identity while downloads remain deduplicated by CIK. */
export async function publishSecMemberships(ctx: JobContext, snapshots: IndexSnapshot[], tickers: ReturnType<typeof parseTickers>) {
	const entities = await ctx.db.select().from(issuer);
	const byCik = new Map(entities.filter((e) => e.cik).map((e) => [e.cik!, e]));
	const reports: { index: string; selected: number; unresolved: { symbol: string; reason: string }[] }[] = [];
	for (const snapshot of snapshots) {
		const effectiveDate = [ctx.runDate, snapshot.evidence.observedAt.slice(0, 10)].sort().at(-1)!;
		const resolved: { issuerId: number; symbol: string; mic: string; securityClass: string; cik: string }[] = [];
		let unresolved = 0;
		const gaps: { symbol: string; reason: string }[] = [];
		const gap = (symbol: string, reason: string) => { unresolved++; gaps.push({ symbol, reason }); };
		for (const holding of snapshot.holdings) {
			const candidates = tickers.filter((t) => symbolKey(t.ticker) === symbolKey(holding.ticker));
			if (new Set(candidates.map((t) => t.cik)).size !== 1) { gap(holding.ticker, 'Ambiguous or missing CIK'); continue; }
			const entity = byCik.get(candidates[0].cik);
			if (!entity || entity.secMetadata?.status !== 'included') { gap(holding.ticker, 'Issuer not qualified'); continue; }
			const directories = (entity.secMetadata.listings ?? []) as Listing[];
			const matches = directories.filter((l) => !l.excludedReason && symbolKey(l.symbol) === symbolKey(holding.ticker));
			if (matches.length !== 1) { gap(holding.ticker, 'Ambiguous or missing exchange listing'); continue; }
			const mic = exchangeMic(matches[0].exchange);
			if (!mic) { gap(holding.ticker, 'Unsupported exchange'); continue; }
			resolved.push({ issuerId: entity.id, cik: entity.cik!, symbol: holding.ticker, mic, securityClass: matches[0].name });
		}
		await ctx.db.transaction(async (db) => {
			await db.insert(universe).values({ id: snapshot.index, name: snapshot.index === 'sp500' ? 'S&P 500 (IVV holdings)' : 'S&P MidCap 400 (IJH holdings)', sizeBand: snapshot.index === 'sp500' ? 'large' : 'mid', source: 'sec', basis: snapshot.basis }).onConflictDoNothing();
			const current = new Set<number>();
			for (const r of resolved) {
				const key = `${r.cik}:${r.mic}:${symbolKey(r.symbol)}`;
				const [identifier] = await db.select().from(providerIdentifier).where(and(eq(providerIdentifier.source, 'sec_listing'), eq(providerIdentifier.externalId, key), isNull(providerIdentifier.validTo)));
				let instrumentId = identifier?.instrumentId;
				if (instrumentId === undefined) {
					const existing = await db.select({ asset: instrument, quote: listing }).from(instrument).innerJoin(listing, eq(listing.instrumentId, instrument.id)).where(and(eq(instrument.issuerId, r.issuerId), isNull(listing.validTo)));
					const classKey = (name: string | null) => /class\s+([a-z0-9]+)/i.exec(name ?? '')?.[1]?.toLowerCase() ?? 'common';
					const priorClass = existing.find((e) => e.quote.symbol !== r.symbol && classKey(e.asset.securityClass) === classKey(r.securityClass));
					if (priorClass) {
						const actions = await db.select().from(corporateAction).where(eq(corporateAction.instrumentId, priorClass.asset.id));
						const rename = actions.find((a) => a.type === 'name_changes' && a.qualification === 'qualified' && a.exDate >= priorClass.quote.validFrom && a.exDate <= effectiveDate && a.observedAt <= new Date(snapshot.evidence.observedAt) && a.metadata.new_symbol === r.symbol && a.metadata.old_symbol === priorClass.quote.symbol);
						if (!rename) { gap(r.symbol, 'Symbol change lacks qualifying corporate-action evidence'); continue; }
						await db.update(providerIdentifier).set({ validTo: rename.exDate }).where(and(eq(providerIdentifier.source, 'sec_listing'), eq(providerIdentifier.externalId, `${r.cik}:${priorClass.quote.mic}:${symbolKey(String(rename.metadata.old_symbol))}`), isNull(providerIdentifier.validTo)));
						await db.update(listing).set({ validTo: rename.exDate }).where(eq(listing.id, priorClass.quote.id));
						await db.insert(listing).values({ ...priorClass.quote, id: undefined, priceHistoryCoveredFrom: null, validFrom: rename.exDate, symbol: r.symbol });
						instrumentId = priorClass.asset.id;
						await db.insert(providerIdentifier).values({ instrumentId, source: 'sec_listing', externalId: key, validFrom: rename.exDate, evidence: rename.evidence });
					}
				}
				if (instrumentId === undefined) {
					const [reused] = await db.select({ quote: listing, issuerId: instrument.issuerId }).from(listing).innerJoin(instrument, eq(instrument.id, listing.instrumentId)).where(and(eq(listing.source, 'alpaca'), eq(listing.mic, r.mic), eq(listing.symbol, r.symbol), isNull(listing.validTo)));
					if (reused) {
						if (reused.issuerId === r.issuerId) { gap(r.symbol, 'Listing identity conflicts with existing security'); continue; }
						await db.update(listing).set({ validTo: effectiveDate }).where(eq(listing.id, reused.quote.id));
						await db.update(providerIdentifier).set({ validTo: effectiveDate }).where(and(eq(providerIdentifier.instrumentId, reused.quote.instrumentId), eq(providerIdentifier.source, 'sec_listing'), isNull(providerIdentifier.validTo)));
					}
					const [asset] = await db.insert(instrument).values({ issuerId: r.issuerId, securityClass: r.securityClass, firstSeen: effectiveDate, lastSeen: effectiveDate }).returning();
					instrumentId = asset.id;
					await db.insert(listing).values({ instrumentId, mic: r.mic, symbol: r.symbol, currency: 'USD', source: 'alpaca', validFrom: effectiveDate, metadata: { identityEvidence: snapshot.evidence } });
					await db.insert(providerIdentifier).values({ instrumentId, source: 'sec_listing', externalId: key, validFrom: effectiveDate, evidence: { ...snapshot.evidence } });
				} else await db.update(instrument).set({ lastSeen: ctx.runDate }).where(eq(instrument.id, instrumentId));
				current.add(instrumentId);
				const [active] = await db.select().from(indexMembership).where(and(eq(indexMembership.instrumentId, instrumentId), eq(indexMembership.indexName, snapshot.index), isNull(indexMembership.validTo)));
				if (!active) await db.insert(indexMembership).values({ instrumentId, indexName: snapshot.index, validFrom: effectiveDate, snapshotDate: snapshot.asOf, observedAt: new Date(snapshot.evidence.observedAt), evidence: { ...snapshot.evidence } });
			}
			// An unresolved holding can be a renamed existing security. Never interpret it as removal.
			if (unresolved === 0) {
				const previous = await db.select().from(indexMembership).where(and(eq(indexMembership.indexName, snapshot.index), isNull(indexMembership.validTo)));
				for (const row of previous) if (!current.has(row.instrumentId)) await db.update(indexMembership).set({ validTo: effectiveDate }).where(eq(indexMembership.id, row.id));
			}
		});
		reports.push({ index: snapshot.index, selected: resolved.length - gaps.filter((g) => resolved.some((r) => r.symbol === g.symbol)).length, unresolved: gaps });
		ctx.log(`${snapshot.index}: ${resolved.length} securities, ${unresolved} unqualified holdings${unresolved ? '; removals withheld' : ''}`);
	}
	return reports;
}
