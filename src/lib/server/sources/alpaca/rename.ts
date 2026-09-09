import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/index.js';
import { listing, providerIdentifier } from '../../db/schema.js';
import { symbolKey } from '../sec/universe.js';
import type { ParsedAction } from './parse.js';

type Listing = typeof listing.$inferSelect;
export function renameApplies(target: Listing, action: ParsedAction, through: string): boolean {
	return action.type === 'name_changes' && action.qualification === 'qualified' &&
		target.symbol === action.metadata.old_symbol && action.exDate >= target.validFrom &&
		action.exDate <= through && target.validTo === null;
}

/** Recheck identity inside the transaction: batches can contain stale listing objects. */
export async function applyListingRename(db: Db, target: Listing, cik: string, action: ParsedAction, through: string, evidence: Record<string, unknown>) {
	if (!renameApplies(target, action, through)) return 'not_applicable';
	return db.transaction(async (tx) => {
		const [current] = await tx.select().from(listing).where(eq(listing.id, target.id)).for('update');
		if (!current || !renameApplies(current, action, through)) return 'not_applicable';
		const newSymbol = String(action.metadata.new_symbol);
		const [occupied] = await tx.select().from(listing).where(and(eq(listing.source, current.source), eq(listing.mic, current.mic), eq(listing.symbol, newSymbol), isNull(listing.validTo)));
		if (occupied) return 'conflicting_listing';
		await tx.update(providerIdentifier).set({ validTo: action.exDate }).where(and(eq(providerIdentifier.instrumentId, current.instrumentId), eq(providerIdentifier.source, 'sec_listing'), eq(providerIdentifier.externalId, `${cik}:${current.mic}:${symbolKey(current.symbol!)}`), isNull(providerIdentifier.validTo)));
		await tx.update(listing).set({ validTo: action.exDate }).where(eq(listing.id, current.id));
		await tx.insert(listing).values({ ...current, id: undefined, priceHistoryCoveredFrom: null, symbol: newSymbol, validFrom: action.exDate, validTo: null });
		await tx.insert(providerIdentifier).values({ instrumentId: current.instrumentId, source: 'sec_listing', externalId: `${cik}:${current.mic}:${symbolKey(newSymbol)}`, validFrom: action.exDate, evidence }).onConflictDoNothing();
		return 'applied';
	});
}
