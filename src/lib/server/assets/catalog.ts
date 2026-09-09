import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, listing } from '../db/schema.js';
import { assetLinks } from '../../externalLinks.js';
export async function assetCatalog(db: Db) {
	const rows = await db.select({ asset: instrument, issuer, listing }).from(instrument).innerJoin(issuer, eq(issuer.id, instrument.issuerId)).leftJoin(listing, eq(listing.instrumentId, instrument.id));
	const assets = new Map<string, { assetId: string; isin: string | null; ticker: string | null; name: string; wkn: string | null; sector: string | null; currency: string; mic: string; links: ReturnType<typeof assetLinks> }>();
	for (const { asset, issuer: entity, listing: quote } of rows.sort((a, b) => Number(b.listing?.validTo === null && b.listing?.isPrimary) - Number(a.listing?.validTo === null && a.listing?.isPrimary) || (b.listing?.validFrom ?? '').localeCompare(a.listing?.validFrom ?? ''))) {
		if (assets.has(asset.assetId)) continue;
		assets.set(asset.assetId, { assetId: asset.assetId, isin: asset.isin, ticker: quote?.symbol ?? null, name: entity.name, wkn: asset.wkn, sector: entity.sector, currency: quote?.currency ?? '', mic: quote?.mic ?? '', links: assetLinks({ isin: asset.isin, cik: entity.cik, ticker: quote?.symbol ?? null, source: quote?.source ?? '' }) });
	}
	return [...assets.values()];
}
