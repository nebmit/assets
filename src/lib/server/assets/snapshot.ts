import type { MetricEvidence } from '$lib/server/assets/metricEvidence.js';
import { RESOLVER_VERSION } from '../sources/sec/xbrl/types.js';
import { blocksShareAdjustment } from './adjustments.js';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { instrument, issuer, listing, indexMembership, universe, eodPrice, fundamental, insiderTransaction, sourceFiling, corporateAction, fxRate, newsItem, assetSnapshot, signalRun, ingestionRun, secExtraction } from '../db/schema.js';
import { resolveFinancials, splitFactor, type Financials, type ClassPrice } from './financials.js';
import { qualifyDealings, type QualifiedDealing } from './ownership.js';
import { loadShortSellerAnalysis } from '../shortSellers/queries.js';
import { unknownShortSellers } from '../../shortSellers.js';
import { superSector, sectorFromSic } from '../signals/sectors.js';
import { addDays, daysBetween } from '../util.js';
import type { UniverseInstrument } from '../signals/types.js';
import type { PricePoint, NewsRowView } from '../../feed/types.js';
export interface ResearchSnapshot extends UniverseInstrument {
	wkn: string | null; cik: string | null; mic: string; listingId: number; source: string;
	financials: Financials; series: PricePoint[]; rawSeries: PricePoint[]; priceIds: number[]; actionIds: number[];
	insiderHistory: QualifiedDealing[];
	news: (NewsRowView & { id: number })[];
	metricHistory: { metric: string; value: number; currency: string | null; periodStart: string | null; periodEnd: string; publishedDate: string; inputId: number }[];
	coverage: Record<string, { state: string; reason: string | null } & Partial<MetricEvidence>>;
	cutoffAt: string;
}
export function runCutoff(runDate: string, now = new Date()): Date {
	// Date-only replays end at Berlin midnight; live runs freeze their actual observation cutoff.
	const midday = new Date(`${runDate}T12:00:00Z`);
	const offset = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' }).formatToParts(midday).find((p) => p.type === 'timeZoneName')!.value.replace('GMT', '');
	return new Date(Math.min(now.getTime(), new Date(`${runDate}T23:59:59.999${offset}`).getTime()));
}
function groupBy<T>(rows: T[], key: (row: T) => number | null): Map<number | null, T[]> {
	const groups = new Map<number | null, T[]>(); for (const row of rows) { const id = key(row); const group = groups.get(id) ?? []; group.push(row); groups.set(id, group); } return groups;
}
const ISSUERS_PER_BATCH = 10;

const observed = (column: typeof fundamental.observedAt, cutoff: Date) => sql`(${column} is null or ${column} <= ${cutoff.toISOString()})`;

/** One resolver owns all public selection and qualification rules. */
export async function resolveSnapshots(db: Db, runDate: string, cutoff = runCutoff(runDate), includeInactive = false): Promise<ResearchSnapshot[]> {
	// Keep raw observations bounded by issuer; all share classes stay in one batch.
	const entities = await db.selectDistinct({ id: instrument.issuerId }).from(instrument)
		.innerJoin(listing, eq(listing.instrumentId, instrument.id))
		.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
		.where(sql`${listing.isPrimary} = true and ${listing.validFrom} <= ${runDate} and (${listing.validTo} is null or ${listing.validTo} > ${runDate}) and ${indexMembership.validFrom} <= ${runDate} and (${includeInactive} or ${indexMembership.validTo} is null or ${indexMembership.validTo} > ${runDate}) and (${indexMembership.observedAt} is null or ${indexMembership.observedAt} <= ${cutoff.toISOString()})`)
		.orderBy(instrument.issuerId);
	const [rates, shorts, ingestion] = await Promise.all([
		db.select().from(fxRate).where(lte(fxRate.observedAt, cutoff)),
		loadShortSellerAnalysis(db, runDate, cutoff),
		db.select().from(ingestionRun).where(and(eq(ingestionRun.source, 'alpaca'), lte(ingestionRun.finishedAt, cutoff))).orderBy(sql`${ingestionRun.finishedAt} desc`).limit(20)
	]);
	const shared = { rates, shorts, priceSourceUnavailable: ingestion.find((r) => r.job === 'alpaca_prices')?.status === 'error' };
	const snapshots: ResearchSnapshot[] = [];
	for (let offset = 0; offset < entities.length; offset += ISSUERS_PER_BATCH) {
		snapshots.push(...await resolveSnapshotBatch(db, runDate, cutoff, includeInactive, entities.slice(offset, offset + ISSUERS_PER_BATCH).map((e) => e.id), shared));
	}
	return snapshots;
}

async function resolveSnapshotBatch(db: Db, runDate: string, cutoff: Date, includeInactive: boolean, issuerIds: number[], shared: { rates: (typeof fxRate.$inferSelect)[]; shorts: Awaited<ReturnType<typeof loadShortSellerAnalysis>>; priceSourceUnavailable: boolean }): Promise<ResearchSnapshot[]> {
	const assetIds = db.select({ id: instrument.id }).from(instrument).where(inArray(instrument.issuerId, issuerIds));
	const listingIdsQuery = db.select({ id: listing.id }).from(listing).where(inArray(listing.instrumentId, assetIds));
	const members = await db.select({ asset: instrument, entity: issuer, quote: listing, membership: indexMembership, universe })
		.from(instrument).innerJoin(issuer, eq(issuer.id, instrument.issuerId))
		.innerJoin(listing, eq(listing.instrumentId, instrument.id))
		.innerJoin(indexMembership, eq(indexMembership.instrumentId, instrument.id))
		.innerJoin(universe, eq(universe.id, indexMembership.indexName))
		.where(sql`${inArray(instrument.issuerId, issuerIds)} and ${listing.isPrimary} = true and ${listing.validFrom} <= ${runDate} and (${listing.validTo} is null or ${listing.validTo} > ${runDate}) and ${indexMembership.validFrom} <= ${runDate} and (${includeInactive} or ${indexMembership.validTo} is null or ${indexMembership.validTo} > ${runDate}) and (${indexMembership.observedAt} is null or ${indexMembership.observedAt} <= ${cutoff.toISOString()})`);
	const unique = new Map<number, typeof members[number]>();
	const bands = { large: 0, mid: 1, small: 2 };
	for (const row of members.sort((a, b) => bands[a.universe.sizeBand] - bands[b.universe.sizeBand] || a.membership.indexName.localeCompare(b.membership.indexName))) if (!unique.has(row.asset.id)) unique.set(row.asset.id, row);
	const { rates, shorts, priceSourceUnavailable } = shared;
	const [allAssets, quotes, prices, facts, dealings, filings, actions, headlines, extractions] = await Promise.all([
		db.select().from(instrument).where(inArray(instrument.issuerId, issuerIds)), db.select().from(listing).where(inArray(listing.instrumentId, assetIds)),
		db.select().from(eodPrice).where(and(inArray(eodPrice.listingId, listingIdsQuery), lte(eodPrice.tradeDate, runDate), sql`(${eodPrice.observedAt} is null or ${eodPrice.observedAt} <= ${cutoff.toISOString()})`)),
		db.select().from(fundamental).where(and(inArray(fundamental.issuerId, issuerIds), lte(fundamental.publishedDate, runDate), sql`(${fundamental.source} <> 'sec' or ${fundamental.metadata}->>'resolverVersion' = ${String(RESOLVER_VERSION)})`, observed(fundamental.observedAt, cutoff), sql`(${fundamental.publishedAt} is null or ${fundamental.publishedAt} <= ${cutoff.toISOString()})`)),
		db.select().from(insiderTransaction).where(and(inArray(insiderTransaction.issuerId, issuerIds), lte(insiderTransaction.publishedDate, runDate), lte(insiderTransaction.transactionDate, runDate), sql`(${insiderTransaction.observedAt} is null or ${insiderTransaction.observedAt} <= ${cutoff.toISOString()}) and (${insiderTransaction.publishedAt} is null or ${insiderTransaction.publishedAt} <= ${cutoff.toISOString()})`)),
		db.select().from(sourceFiling).where(and(inArray(sourceFiling.issuerId, issuerIds), lte(sourceFiling.filedDate, runDate), lte(sourceFiling.observedAt, cutoff))),
		db.select().from(corporateAction).where(and(inArray(corporateAction.instrumentId, assetIds), lte(corporateAction.exDate, runDate), lte(corporateAction.observedAt, cutoff))),
		db.select().from(newsItem).where(and(inArray(newsItem.issuerId, issuerIds), lte(newsItem.publishedAt, cutoff), sql`(${newsItem.observedAt} is null or ${newsItem.observedAt} <= ${cutoff.toISOString()})`)),
		db.select().from(secExtraction).where(inArray(secExtraction.filingId, db.select({ id: sourceFiling.id }).from(sourceFiling).where(inArray(sourceFiling.issuerId, issuerIds))))
	]);
	const selectedDocuments = new Map(filings.map((f) => [f.id, ((f.metadata.documents ?? []) as { hash: string; observedAt: string }[]).filter((d) => d.observedAt <= cutoff.toISOString()).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0]?.hash]));
	const extractionById = new Map(extractions.map((e) => [e.id, e]));
	const currentFacts = facts.filter((f) => {
		if (f.source !== 'sec') return true;
		if (f.metadata?.resolverVersion !== RESOLVER_VERSION) return false;
		const extraction = extractionById.get(Number(f.metadata?.extractionId));
		return extraction !== undefined && extraction.manifest.submissionHash === selectedDocuments.get(f.filingId ?? -1);
	});
	const assetsByIssuer = groupBy(allAssets, (a) => a.issuerId), quotesByAsset = groupBy(quotes, (q) => q.instrumentId), pricesByListing = groupBy(prices, (p) => p.listingId), factsByIssuer = groupBy(currentFacts, (f) => f.issuerId), dealingsByIssuer = groupBy(dealings, (t) => t.issuerId), filingsByIssuer = groupBy(filings, (f) => f.issuerId), actionsByAsset = groupBy(actions, (a) => a.instrumentId), newsByIssuer = groupBy(headlines, (n) => n.issuerId);
	const filingById = new Map(filings.map((f) => [f.id, f]));
	const ownershipByIssuer = new Map<number, Map<number, QualifiedDealing[]>>();
	const previousMetrics = await db.select({ instrumentId: assetSnapshot.instrumentId, date: signalRun.runDate, financials: sql<Financials>`${assetSnapshot.payload}->'financials'` }).from(assetSnapshot).innerJoin(signalRun, eq(signalRun.id, assetSnapshot.runId)).where(sql`${inArray(assetSnapshot.instrumentId, assetIds)} and ${signalRun.status} = 'success' and ${signalRun.isCurrent} = true and ${signalRun.runDate} < ${runDate} and ${signalRun.cutoffAt} <= ${cutoff.toISOString()}`);
	const previousByAsset = groupBy(previousMetrics, (p) => p.instrumentId);
	const snapshots: ResearchSnapshot[] = [];
	for (const { asset, entity, quote, universe: group } of unique.values()) {
		const identities = (assetsByIssuer.get(entity.id) ?? []).map((a) => ({ instrumentId: a.id, isin: a.isin, securityClass: a.securityClass, currency: quotesByAsset.get(a.id)?.find((q) => q.isPrimary && q.validTo === null)?.currency ?? '' }));

		const assetActions = new Map<string, typeof actions[number]>();
		for (const a of (actionsByAsset.get(asset.id) ?? []).sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())) if (!assetActions.has(a.externalId)) assetActions.set(a.externalId, a);
		const actionRows = [...assetActions.values()];
		const actionsComplete = (typeof quote.metadata.actionsCoveredFrom === 'string' && quote.metadata.actionsCoveredFrom <= addDays(runDate, -3 * 366) && typeof quote.metadata.actionsCheckedAt === 'string' && quote.metadata.actionsCheckedAt <= cutoff.toISOString() && daysBetween(quote.metadata.actionsCheckedAt.slice(0, 10), runDate) <= 10);
		const unsupported = actionRows.some((a) => blocksShareAdjustment(a, quote.symbol));
		const listingIds = new Set((quotesByAsset.get(asset.id) ?? []).filter((q) => q.currency === quote.currency).map((q) => q.id));
		const byDate = new Map<string, typeof prices[number]>();
		for (const p of [...listingIds].flatMap((id) => pricesByListing.get(id) ?? []).filter((p) => p.currency === quote.currency && p.adjustment === 'raw').sort((a, b) => (b.observedAt?.getTime() ?? 0) - (a.observedAt?.getTime() ?? 0) || Number(b.open !== null) - Number(a.open !== null) || b.id - a.id)) if (!byDate.has(p.tradeDate)) byDate.set(p.tradeDate, p);
		const priceRows = [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
		const latest = priceRows.at(-1), close = latest ? Number(latest.close) : null;
		const rawSeries = priceRows.map((p) => ({ date: p.tradeDate, close: Number(p.close) }));
		let series = actionsComplete && !unsupported ? rawSeries.map((p) => ({ ...p, close: Number(p.close) / splitFactor(actionRows, p.date, runDate).toNumber() })) : [];
		if (quote.source === 'boerse_frankfurt') {
			const adjusted = new Map<string, typeof prices[number]>();
			for (const p of [...listingIds].flatMap((id) => pricesByListing.get(id) ?? []).filter((p) => p.adjustment === 'split' && p.currency === quote.currency).sort((a, b) => (b.observedAt?.getTime() ?? 0) - (a.observedAt?.getTime() ?? 0) || b.id - a.id)) if (!adjusted.has(p.tradeDate)) adjusted.set(p.tradeDate, p);
			const basis = [...adjusted.values()][0]?.observedAt;
			if (basis && daysBetween(basis.toISOString().slice(0, 10), runDate) <= 10) series = [...adjusted.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).map((p) => ({ date: p.tradeDate, close: Number(p.close) }));
		}
		const issuerFacts = factsByIssuer.get(entity.id) ?? [];
		const latestReport = (filingsByIssuer.get(entity.id) ?? []).filter((f) => /^10-(K|Q)/.test(f.form)).sort((a, b) => (b.reportDate ?? '').localeCompare(a.reportDate ?? '') || b.filedDate.localeCompare(a.filedDate))[0];
		const inventoryFact = issuerFacts.filter((f) => f.filingId === latestReport?.id).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
		const classes = (inventoryFact?.metadata?.classInventory ?? []) as string[];
		const bindings = (inventoryFact?.metadata?.classBindings ?? {}) as Record<string, number>;
		const earnings = Object.entries(bindings).find(([, id]) => id === asset.id)?.[0] ?? null;
		const classPrices: ClassPrice[] = classes.flatMap((classId) => {
			const id = bindings[classId]; if (!id) return [];
			const listing = (quotesByAsset.get(id) ?? []).find((q) => q.isPrimary && q.validFrom <= runDate && (!q.validTo || q.validTo > runDate) && q.currency === quote.currency);
			if (!listing) return [];
			const price = (pricesByListing.get(listing.id) ?? []).filter((p) => p.adjustment === 'raw' && p.currency === quote.currency).sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.id - a.id)[0];
			const seen = new Set<string>();
			const classActions = (actionsByAsset.get(id) ?? []).sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()).filter((a) => { if (seen.has(a.externalId)) return false; seen.add(a.externalId); return true; });
			return [{ classId, close: price ? Number(price.close) : null, priceDate: price?.tradeDate ?? null, priceId: price?.id, actions: classActions, actionsComplete: typeof listing.metadata.actionsCoveredFrom === 'string' && listing.metadata.actionsCoveredFrom <= addDays(runDate, -3 * 366) && typeof listing.metadata.actionsCheckedAt === 'string' && listing.metadata.actionsCheckedAt <= cutoff.toISOString() && daysBetween(listing.metadata.actionsCheckedAt.slice(0, 10), runDate) <= 10, symbol: listing.symbol }];
		});
		const financials = resolveFinancials({ facts: issuerFacts.filter((f) => f.source === (quote.source === 'boerse_frankfurt' ? 'boerse_frankfurt' : 'sec')), instrumentId: asset.id, scope: { earnings: quote.source === 'alpaca' ? earnings : 'issuer', classes, inventoryComplete: inventoryFact?.metadata?.inventoryComplete === true }, classPrices, latestReportEnd: quote.source === 'alpaca' ? latestReport?.reportDate : null, priceIds: latest ? [latest.id] : [], currency: quote.currency, close, priceDate: latest?.tradeDate, runDate, actions: actionRows, actionsComplete, adjustmentSymbol: quote.symbol });
		if (quote.source === 'alpaca' && (!latestReport || !inventoryFact)) for (const key of ['eps', 'pb', 'marketCap'] as const) {
			Object.assign(financials[key], { value: null, state: 'unavailable', reason: 'Latest financial filing is awaiting successful processing', reasonCode: 'latest_filing_unprocessed', method: null, asOf: null, periodStart: null, periodEnd: null, inputIds: [], evidence: { facts: [], prices: [], actions: [], rules: ['sec-financial-resolver:1'] } });
		}
		if (!ownershipByIssuer.has(entity.id)) ownershipByIssuer.set(entity.id, qualifyDealings(dealingsByIssuer.get(entity.id) ?? [], filingsByIssuer.get(entity.id) ?? [], identities, rates, cutoff));
		const history = ownershipByIssuer.get(entity.id)!.get(asset.id) ?? [];
		const metricHistory: ResearchSnapshot['metricHistory'] = [];
		for (const item of [...(previousByAsset.get(asset.id) ?? []), { date: runDate, financials }]) {
			for (const [key, metric] of [['eps', 'eps_basic'], ['marketCap', 'market_cap'], ['dividend', 'dividend_per_share']] as const) {
				const v = item.financials?.[key]; if (v?.value !== null && v?.value !== undefined && v.state === 'qualified') metricHistory.push({ metric, value: v.value, currency: v.currency, periodStart: v.periodStart, periodEnd: v.periodEnd ?? item.date, publishedDate: item.date, inputId: v.inputIds[0] ?? 0 });
			}
		}
		const window = history.filter((t) => t.transactionDate > addDays(runDate, -30));
		const range = series.filter((p) => p.date > addDays(runDate, -365));
		const hi = range.length ? Math.max(...range.map((p) => p.close)) : null, lo = range.length ? Math.min(...range.map((p) => p.close)) : null;
		const reference = (days: number) => series.filter((p) => p.date <= addDays(runDate, -days) && p.date > addDays(runDate, -days - 10)).at(-1)?.close ?? null;
		const adjustedClose = series.at(-1)?.close ?? null;
		const ret = (days: number) => { const base = reference(days); return adjustedClose !== null && base !== null && base > 0 ? adjustedClose / base - 1 : null; };
		const sector = entity.sector ? superSector(entity.sector) : sectorFromSic(String((entity.secMetadata?.submissions as Record<string, unknown> | undefined)?.sic ?? ''));
		snapshots.push({ assetId: asset.assetId, instrumentId: asset.id, issuerId: entity.id, isin: asset.isin, wkn: asset.wkn, ticker: quote.symbol, cik: entity.cik, name: entity.name, sector, currency: quote.currency, mic: quote.mic, listingId: quote.id, source: quote.source, sizeBand: group.sizeBand,
			shortSellers: asset.shortDisclosureSource ? shorts.get(entity.id) ?? unknownShortSellers() : { ...unknownShortSellers(), status: 'unavailable' },
			close, closeDate: latest?.tradeDate ?? null, epsBasic: financials.eps.value, marketCap: financials.marketCap.value, dividendPerShare: financials.dividend.value, priceToBook: financials.pb.value,
			return3m: ret(91), return6m: ret(182), drawdown52w: adjustedClose !== null && hi ? adjustedClose / hi - 1 : null, above52wLow: adjustedClose !== null && lo ? adjustedClose / lo - 1 : null,
			insiderTx: window, insiderHistory: history, financials, series, rawSeries, priceIds: [...listingIds].flatMap((id) => pricesByListing.get(id) ?? []).filter((p) => p.currency === quote.currency).map((p) => p.id), actionIds: actionRows.map((a) => a.id),
			news: (newsByIssuer.get(entity.id) ?? []).filter((n) => (n.instrumentId === null || n.instrumentId === asset.id) && n.qualification === 'qualified').sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).map((n) => ({ id: n.id, headline: n.headline, newsType: n.source === 'sec' ? filingById.get(n.filingId ?? -1)?.form ?? n.newsType : n.newsType, form: n.source === 'sec' ? filingById.get(n.filingId ?? -1)?.form ?? null : null, accession: n.source === 'sec' ? filingById.get(n.filingId ?? -1)?.externalId ?? null : null, publishedAt: n.publishedAt.toISOString(), source: n.source, url: typeof (n.raw as Record<string, unknown> | null)?.url === 'string' ? String((n.raw as Record<string, unknown>).url) : null })),
			metricHistory,
			coverage: { ...(entity.cik ? Object.fromEntries([['filings', /^(10-K|10-Q|8-K)/, 'financial'], ['insiderFilings', /^(3|4|5)(\/A)?$/, 'insider']].map(([key, pattern, label]) => {
				const rows = (filingsByIssuer.get(entity.id) ?? []).filter((f) => (pattern as RegExp).test(f.form));
				const unavailable = rows.some((f) => f.status === 'unavailable' && f.updatedAt <= cutoff);
				const incomplete = !rows.length || rows.some((f) => !['processed', 'unavailable'].includes(f.status) || f.updatedAt > cutoff);
				return [key, { state: incomplete ? 'missing' : unavailable ? 'unavailable' : 'qualified', reason: incomplete ? `Some ${label} filings are awaiting processing or retry` : unavailable ? `SEC no longer provides some ${label} filings; absence verified against its archive and filing inventories` : null }];
			})) : {}), observations: { state: priceRows.some((p) => p.observedAt === null) || issuerFacts.some((f) => f.observedAt === null) ? 'unqualified' : 'qualified', reason: priceRows.some((p) => p.observedAt === null) || issuerFacts.some((f) => f.observedAt === null) ? 'Legacy evidence has unknown observation times' : null }, prices: { state: close === null ? quote.source === 'alpaca' && priceSourceUnavailable ? 'unavailable' : 'missing' : latest && daysBetween(latest.tradeDate, runDate) > 10 ? 'stale' : 'qualified', reason: close === null ? quote.source === 'alpaca' && priceSourceUnavailable ? 'Daily market data is currently unavailable' : 'No completed daily close' : null }, adjustments: { state: series.length ? 'qualified' : 'unqualified', reason: series.length ? null : unsupported ? 'Unsupported corporate action' : actionsComplete ? null : 'Corporate action coverage unavailable' }, ...Object.fromEntries(Object.entries(financials).map(([key, v]) => [key, { state: v.state, reason: v.reason, reasonCode: v.reasonCode, scope: v.scope, method: v.method, asOf: v.asOf, evidence: v.evidence }])) }, cutoffAt: cutoff.toISOString() });
	}
	return snapshots;
}
export async function savedSnapshots(db: Db, runDate: string, assetId?: string): Promise<ResearchSnapshot[]> {
	const rows = await db.select({ payload: assetSnapshot.payload }).from(assetSnapshot).innerJoin(signalRun, eq(signalRun.id, assetSnapshot.runId)).where(and(eq(signalRun.runDate, runDate), and(eq(signalRun.status, 'success'), eq(signalRun.isCurrent, true)), assetId ? sql`${assetSnapshot.payload}->>'assetId' = ${assetId}` : undefined));
	return rows.map((r) => r.payload as ResearchSnapshot);
}
