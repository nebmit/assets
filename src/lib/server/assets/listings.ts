import { and, eq, isNull } from 'drizzle-orm';
import { listing, instrument, indexMembership } from '../db/schema.js';
import type { Db } from '../db/index.js';

export async function primaryListing(db: Db, instrumentId: number) {
	const [row] = await db.select().from(listing).where(and(eq(listing.instrumentId, instrumentId), eq(listing.isPrimary, true), isNull(listing.validTo)));
	return row;
}
export async function bfMembers(db: Db) {
	const rows = await db.selectDistinct({ id: instrument.id, issuerId: instrument.issuerId, isin: instrument.isin,
		listingId: listing.id, coveredFrom: listing.priceHistoryCoveredFrom })
		.from(instrument).innerJoin(listing, eq(listing.instrumentId, instrument.id))
		.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
		.where(and(eq(listing.source, 'boerse_frankfurt'), eq(listing.mic, 'XETR'), isNull(listing.validTo), isNull(indexMembership.validTo)));
	return rows.filter((r): r is typeof r & { isin: string } => r.isin !== null);
}
