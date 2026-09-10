import { parseFinancialHeader } from './filingHeader.js';
import { and, eq, sql } from 'drizzle-orm';
import type { JobContext } from '../../pipeline/types.js';
import { fundamental, insiderTransaction, issuer, instrument, listing, newsItem, sourceFiling } from '../../db/schema.js';
import { hash, type Evidence } from './client.js';
import { acceptanceTime, ownershipForm, type FilingRecord } from './parse.js';
import { normalizeFacts } from './facts.js';
import { parseOwnership } from './ownership.js';

export type Filing = typeof sourceFiling.$inferSelect;
export async function rememberFiling(ctx: JobContext, f: FilingRecord, issuerId: number | null): Promise<void> {
	await ctx.db.insert(sourceFiling).values({ source: 'sec', externalId: f.accession, issuerId,
		form: f.form, filedDate: f.filedDate, reportDate: f.reportDate,
		acceptedAt: f.acceptedAt ? new Date(f.acceptedAt) : null, url: f.url,
		metadata: { archiveCik: f.cik, primaryDocument: f.primaryDocument, items: f.items }
	}).onConflictDoUpdate({ target: [sourceFiling.source, sourceFiling.externalId], set: {
		issuerId: sql`coalesce(${sourceFiling.issuerId}, excluded.issuer_id)`,
		status: sql`case when ${sourceFiling.status} in ('unmatched', 'unavailable') and excluded.issuer_id is not null then 'pending' else ${sourceFiling.status} end`,
		acceptedAt: sql`coalesce(${sourceFiling.acceptedAt}, excluded.accepted_at)`,
		reportDate: sql`coalesce(${sourceFiling.reportDate}, excluded.report_date)`,
		metadata: sql`${sourceFiling.metadata} || excluded.metadata`
	} });
}
export async function updateIssuerMetadata(ctx: JobContext, id: number, patch: Record<string, unknown>): Promise<void> {
	await ctx.db.update(issuer).set({ secMetadata: sql`coalesce(${issuer.secMetadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb` }).where(eq(issuer.id, id));
}
export function evidenceVersions(metadata: Record<string, unknown>, evidence: Evidence): Evidence[] {
	const previous = (metadata.documents ?? []) as Evidence[];
	return previous.at(-1)?.hash === evidence.hash ? previous : [...previous, evidence];
}
export function publicTime(filing: Filing): Date {
	// Date-only evidence becomes available at the end of its filing date in Eastern time.
	return filing.acceptedAt ?? new Date(new Date(acceptanceTime(`${filing.filedDate}T23:59:59`)).getTime() + 1000);
}

export const SEC_NEWS_VERSION = 1;
/** Reprocessing upgrades migrated rows instead of leaving conflict-skipped news hidden forever. */
export async function persistNews(ctx: JobContext, filing: Filing, evidence: Evidence): Promise<void> {
	if (filing.issuerId === null || ownershipForm.test(filing.form)) return;
	const [entity] = await ctx.db.select({ name: issuer.name }).from(issuer).where(eq(issuer.id, filing.issuerId));
	const time = publicTime(filing), items = String(filing.metadata.items ?? '');
	const row = {
		source: 'sec', externalId: filing.externalId, issuerId: filing.issuerId, filingId: filing.id,
		headline: `${entity.name} — ${filing.form.startsWith('10-K') ? 'Annual report' : filing.form.startsWith('10-Q') ? 'Quarterly report' : 'Current report'}${items ? `: ${items.split(',').map((i) => itemLabel(i.trim())).join('; ')}` : ''}`,
		newsType: 'regulatory_filing', publishedAt: time, publishedDate: time.toISOString().slice(0, 10),
		naturalKeyHash: hash(`sec:news:${filing.externalId}`), qualification: 'qualified', qualificationReason: null,
		observedAt: new Date(), raw: { url: filing.url, accession: filing.externalId, evidence, normalizationVersion: SEC_NEWS_VERSION }
	};
	await ctx.db.insert(newsItem).values(row).onConflictDoUpdate({ target: newsItem.naturalKeyHash, set: row });
}

export async function persistFiling(ctx: JobContext, filing: Filing, content: string, evidence: Evidence): Promise<void> {
	const headerAcc = /ACCESSION NUMBER:\s*(\d{10}-\d{2}-\d{6})/.exec(content)?.[1];
	if (headerAcc && headerAcc !== filing.externalId) throw new Error('filing accession mismatch');
	await ctx.db.transaction(async (db) => {
		[filing] = await db.select().from(sourceFiling).where(eq(sourceFiling.id, filing.id)).for('update');
		let issuerId = filing.issuerId;
		let acceptedAt = filing.acceptedAt;
		let parsed: ReturnType<typeof parseOwnership> | null = null;
		if (ownershipForm.test(filing.form)) {
			parsed = parseOwnership(content, filing.externalId, evidence.hash);
			if (parsed.form !== filing.form) throw new Error('ownership form mismatch');
			const [target] = await db.select().from(issuer).where(eq(issuer.cik, parsed.issuerCik));
			issuerId = target?.id ?? null;
			if (parsed.acceptedAt) acceptedAt = new Date(parsed.acceptedAt);
		} else {
			acceptedAt = parseFinancialHeader(content, filing.externalId) ?? acceptedAt;
		}
		const time = publicTime({ ...filing, acceptedAt });
		const isAmendment = filing.form.endsWith('/A');
		const metadata: Record<string, unknown> = { ...filing.metadata, documents: evidenceVersions(filing.metadata, evidence), currentHash: evidence.hash, parsed: parsed?.metadata ?? null,
			amendmentStatus: isAmendment ? 'unresolved' : 'original', sourceState: 'present' };
		if (parsed && isAmendment && parsed.originalSubmissionDate && issuerId) {
			const candidates = await db.select({ id: sourceFiling.id, metadata: sourceFiling.metadata }).from(sourceFiling).where(and(eq(sourceFiling.source, 'sec'), eq(sourceFiling.issuerId, issuerId), eq(sourceFiling.filedDate, parsed.originalSubmissionDate), eq(sourceFiling.form, filing.form.replace('/A', ''))));
			const ids = candidates.filter((c) => {
				const data = c.metadata.parsed as { owners?: { cik: string }[] } | undefined;
				return data?.owners?.map((o) => o.cik).sort().join(',') === parsed!.owners.map((o) => o.cik).sort().join(',');
			}).map((c) => c.id);
			metadata.amendmentCandidateIds = ids;
		}
		if (parsed) {
			for (const tx of parsed.transactions) {
				await db.insert(insiderTransaction).values({
					issuerId, source: 'sec', sourceRecordId: tx.sourceRecordId, filingId: filing.id,
					economicKey: `${filing.externalId}:${tx.raw.tableName}:${tx.raw.ordinal}`,
					issuerNameRaw: parsed.issuerName, partyName: tx.partyName, partyRole: tx.partyRole,
					side: tx.side, instrumentType: tx.instrumentType, price: tx.price, volume: tx.volume, amount: tx.amount, currency: tx.currency,
					transactionDate: tx.transactionDate, publishedDate: time.toISOString().slice(0, 10), publishedAt: time, observedAt: new Date(evidence.observedAt),
					amendmentStatus: isAmendment ? 'unresolved' : 'original', qualification: 'unqualified', qualificationReason: 'requires_snapshot_qualification',
					naturalKeyHash: tx.sourceRecordId, raw: { ...tx.raw, payloadHash: evidence.hash }
				}).onConflictDoNothing();
			}
		}
		if (issuerId !== null && !ownershipForm.test(filing.form)) await persistNews({ ...ctx, db: db as unknown as JobContext['db'] }, { ...filing, issuerId, acceptedAt }, evidence);

		await db.update(sourceFiling).set({ issuerId, acceptedAt, status: issuerId ? 'processed' : 'unmatched', error: null,
			metadata, updatedAt: new Date(), attempts: filing.attempts + 1 }).where(eq(sourceFiling.id, filing.id));
	});
}

/** Current annual/quarterly filings carry their comparative periods; unchanged older documents stay archived. */
export function financialDocuments(filings: Filing[], runDate: string): Filing[] {
	const eligible = filings.filter((f) => f.status === 'processed' && f.filedDate <= runDate && /^10-(K|Q)(\/A)?$/.test(f.form));
	const selected = new Map<number, Filing>();
	for (const form of ['10-K', '10-Q']) {
		const family = eligible.filter((f) => f.form.startsWith(form)).sort((a, b) => b.filedDate.localeCompare(a.filedDate) || b.id - a.id);
		const original = family.find((f) => f.form === form) ?? family[0];
		if (!original) continue;
		selected.set(original.id, original);
		for (const amendment of family.filter((f) => f.form.endsWith('/A') && f.filedDate >= original.filedDate)) selected.set(amendment.id, amendment);
	}
	return [...selected.values()];
}

/** Comparison evidence cannot create or override authoritative filing observations. */
export async function recordCompanyFactsComparison(ctx: JobContext, entity: typeof issuer.$inferSelect, input: unknown, evidence: Evidence, cutoff: string): Promise<void> {
	const comparison = normalizeFacts(input, entity.cik!, evidence.hash, cutoff);
	const rows = await ctx.db.select({ fact: fundamental, accession: sourceFiling.externalId }).from(fundamental).innerJoin(sourceFiling, eq(sourceFiling.id, fundamental.filingId)).where(and(eq(fundamental.issuerId, entity.id), eq(fundamental.source, 'sec'), sql`${fundamental.metadata}->>'scope' = 'issuer'`));
	let matched = 0, different = 0;
	for (const observed of comparison.facts) {
		const candidates = rows.filter((r) => r.accession === observed.accession && r.fact.metric === observed.metric && r.fact.periodStart === observed.periodStart && r.fact.periodEnd === observed.periodEnd && r.fact.unit === observed.unit);
		if (!candidates.length) continue;
		if (candidates.some((r) => r.fact.value === observed.value)) matched++; else different++;
	}
	await updateIssuerMetadata(ctx, entity.id, { factsEvidence: evidence, comparisonIssues: comparison.issues, companyFactsComparison: { matched, different, normalized: comparison.facts.length, checkedAt: new Date().toISOString() } });
}

function itemLabel(item: string): string {
	return ({ '1.01': 'Material agreement', '1.02': 'Agreement termination', '2.01': 'Acquisition or disposal', '2.02': 'Financial results', '2.03': 'Financial obligation', '2.05': 'Restructuring costs', '2.06': 'Material impairment', '3.01': 'Listing notice', '5.02': 'Director or officer change', '5.07': 'Shareholder vote', '7.01': 'Regulation FD disclosure', '8.01': 'Other events', '9.01': 'Financial statements and exhibits' } as Record<string, string>)[item] ?? `Item ${item}`;
}
