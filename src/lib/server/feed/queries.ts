import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { signal, signalDefinition, signalRun } from '../db/schema.js';
import { savedSnapshots, type ResearchSnapshot } from '../assets/snapshot.js';
import { FEED_VIEWS, DEFAULT_VIEW_SLUG, type FeedViewSlug } from '../../feed/views.js';
import type { CardData, FeedPayload, LifecycleState, ReasonView } from '../../feed/types.js';
import { parseHeadline, parseReasons, parseRelativeValueRationale } from './rationale.js';
import { assetLinks } from '../../externalLinks.js';
import { subtractYears } from '../../date.js';
export function idList(ids: number[]) { return sql.join(ids.map((id) => sql`${id}`), sql`, `); }
export function lifecycleFor(current: number | null, previous: number | null, hasPrevious: boolean): LifecycleState | null {
	if (!hasPrevious) return null;
	if (previous === null) return 'new';
	if (current === null) return 'persisting';
	return current - previous >= 0.05 ? 'strengthening' : current - previous <= -0.05 ? 'fading' : 'persisting';
}
export function snapshotCard(s: ResearchSnapshot, runDate: string, rank: number, reasons: ReasonView[], lifecycle: LifecycleState | null, valuation: unknown): CardData {
	const relative = parseRelativeValueRationale(valuation);
	const pe = s.close !== null && s.epsBasic !== null && s.epsBasic > 0 ? s.close / s.epsBasic : null;
	const series = s.series.filter((p) => p.date >= subtractYears(runDate, 3));
	const weekly = new Map<string, typeof series[number]>();
	for (const p of series) { const d = new Date(p.date); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); weekly.set(d.toISOString().slice(0, 10), p); }
	const range = s.series.filter((p) => p.date >= subtractYears(runDate, 1));
	return { instrumentId: s.instrumentId, assetId: s.assetId, isin: s.isin, wkn: s.wkn, ticker: s.ticker, currency: s.currency, mic: s.mic, name: s.name, sector: s.sector, rank, reasons, lifecycle,
		shortSellers: s.shortSellers, price: s.close, priceDate: s.closeDate, source: s.source, links: assetLinks(s), coverage: s.coverage,
		series: [...weekly.values()], hi52: range.length ? Math.max(...range.map((p) => p.close)) : null, lo52: range.length ? Math.min(...range.map((p) => p.close)) : null,
		pe, peerMedianPe: relative.peerMedianPe, peDeltaPct: pe !== null && relative.peerMedianPe ? (pe / relative.peerMedianPe - 1) * 100 : null, pb: s.priceToBook, eps: s.epsBasic, marketCap: s.marketCap,
		insiders: [...s.insiderHistory].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)).slice(0, 5).map((t) => ({ partyName: t.partyName, partyRole: t.partyRole, side: t.side, amount: t.amount, currency: t.currency, transactionDate: t.transactionDate, qualification: t.qualification, qualificationReason: t.qualificationReason, currencyStatus: t.currencyStatus, url: t.url })),
		news: s.news.slice(0, 2) };
}
/** Every view reads the same immutable product snapshot as the signal engine. */
export async function loadFeed(db: Db): Promise<FeedPayload | null> {
	return db.transaction((tx) => loadFeedSnapshot(tx), { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

async function loadFeedSnapshot(db: Db): Promise<FeedPayload | null> {
	const runs = await db.select().from(signalRun).where(eq(signalRun.status, 'success')).orderBy(desc(signalRun.runDate)).limit(2);
	const [run, previousRun] = runs; if (!run) return null;
	const [snapshots, rows, prior] = await Promise.all([
		savedSnapshots(db, run.runDate),
		db.select({ signal, slug: signalDefinition.slug }).from(signal).innerJoin(signalDefinition, eq(signalDefinition.id, signal.definitionId)).where(eq(signal.runId, run.id)),
		previousRun ? db.select({ signal, slug: signalDefinition.slug }).from(signal).innerJoin(signalDefinition, eq(signalDefinition.id, signal.definitionId)).where(and(eq(signal.runId, previousRun.id), eq(signal.passedGate, true))) : []
	]);
	const byId = new Map(snapshots.map((s) => [s.instrumentId, s]));
	const previous = new Map(prior.map((r) => [`${r.slug}:${r.signal.instrumentId}`, r.signal.score === null ? null : Number(r.signal.score)]));
	const values = new Map(rows.filter((r) => r.slug === 'relative_value').map((r) => [r.signal.instrumentId, r.signal.rationale]));
	const cardsByView = Object.fromEntries(FEED_VIEWS.map((v) => [v.slug, []])) as unknown as Record<FeedViewSlug, CardData[]>;
	const projections = new Map(snapshots.map((s) => [s.instrumentId, snapshotCard(s, run.runDate, 0, [], null, values.get(s.instrumentId))]));
	for (const view of FEED_VIEWS) {
		for (const { signal: r } of rows.filter((r) => r.slug === view.slug && r.signal.passedGate).sort((a, b) => (a.signal.rank ?? 0) - (b.signal.rank ?? 0))) {
			const s = byId.get(r.instrumentId); if (!s) continue;
			const score = r.score === null ? null : Number(r.score);
			const reasons = view.slug === DEFAULT_VIEW_SLUG ? parseReasons(r.rationale) : [{ signal: view.slug, severity: score ?? 0, headline: parseHeadline(r.rationale) }];
			cardsByView[view.slug].push({ ...projections.get(s.instrumentId)!, rank: r.rank ?? 0, reasons, lifecycle: lifecycleFor(score, previous.get(`${view.slug}:${r.instrumentId}`) ?? null, previousRun !== undefined) });
		}
	}
	return { runDate: run.runDate, universeSize: run.universeSize, views: [...FEED_VIEWS], cardsByView, shortSellersByAssetId: Object.fromEntries(snapshots.map((s) => [s.assetId, s.shortSellers])), catalog: snapshots.map((s) => ({ assetId: s.assetId, isin: s.isin, ticker: s.ticker, name: s.name, wkn: s.wkn, sector: s.sector, currency: s.currency, mic: s.mic, links: assetLinks(s) })) };
}
