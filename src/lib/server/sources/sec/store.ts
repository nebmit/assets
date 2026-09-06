import { and, eq, sql } from 'drizzle-orm';
import type { JobContext } from '../../pipeline/types.js';
import { fundamental, insiderTransaction, issuer, newsItem, sourceFiling } from '../../db/schema.js';
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
		status: sql`case when ${sourceFiling.status} = 'unmatched' and excluded.issuer_id is not null then 'pending' else ${sourceFiling.status} end`,
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
	return previous.some((e) => e.hash === evidence.hash) ? previous : [...previous, evidence];
}
export function publicTime(filing: Filing): Date {
	// Date-only evidence becomes available at the end of its filing date in Eastern time.
	return filing.acceptedAt ?? new Date(new Date(acceptanceTime(`${filing.filedDate}T23:59:59`)).getTime() + 1000);
}

export async function persistFiling(ctx: JobContext, filing: Filing, content: string, evidence: Evidence): Promise<void> {
	const headerAcc = /ACCESSION NUMBER:\s*(\d{10}-\d{2}-\d{6})/.exec(content)?.[1];
	if (headerAcc && headerAcc !== filing.externalId) throw new Error('filing accession mismatch');
	await ctx.db.transaction(async (db) => {
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
			if (!/<SEC-DOCUMENT>|<DOCUMENT>/i.test(content)) throw new Error('invalid complete SEC submission');
			const headerAcc = /ACCESSION NUMBER:\s*(\d{10}-\d{2}-\d{6})/.exec(content)?.[1];
			if (headerAcc !== filing.externalId) throw new Error('filing accession mismatch');
			const time = /<ACCEPTANCE-DATETIME>(\d{14})/.exec(content)?.[1];
			if (time) acceptedAt = new Date(acceptanceTime(time));
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
					issuerNameRaw: parsed.issuerName, partyName: tx.partyName, partyRole: tx.partyRole,
					side: tx.side, instrumentType: tx.instrumentType, price: tx.price, volume: tx.volume, amount: tx.amount, currency: tx.currency,
					transactionDate: tx.transactionDate, publishedDate: time.toISOString().slice(0, 10), publishedAt: time, observedAt: new Date(evidence.observedAt),
					amendmentStatus: isAmendment ? 'unresolved' : 'original', eligibleForProduct: false,
					naturalKeyHash: tx.sourceRecordId, raw: { ...tx.raw, payloadHash: evidence.hash }
				}).onConflictDoNothing();
			}
		}
		if (issuerId !== null) {
			const [entity] = await db.select({ name: issuer.name }).from(issuer).where(eq(issuer.id, issuerId));
			const items = String(filing.metadata.items ?? '');
			await db.insert(newsItem).values({ source: 'sec', externalId: filing.externalId, issuerId, filingId: filing.id,
				headline: `${entity.name} — Form ${filing.form}${items ? `, items ${items}` : ''}`,
				newsType: 'regulatory_filing', publishedAt: time, publishedDate: time.toISOString().slice(0, 10),
				naturalKeyHash: hash(`sec:news:${filing.externalId}`), eligibleForProduct: false,
				raw: { url: filing.url, accession: filing.externalId }
			}).onConflictDoNothing();
		}
		await db.update(sourceFiling).set({ issuerId, acceptedAt, status: issuerId ? 'processed' : 'unmatched', error: null,
			metadata, updatedAt: new Date(), attempts: filing.attempts + 1 }).where(eq(sourceFiling.id, filing.id));
	});
}

export async function persistFacts(ctx: JobContext, entity: typeof issuer.$inferSelect, input: unknown, evidence: Evidence, cutoff: string): Promise<void> {
	const result = normalizeFacts(input, entity.cik!, evidence.hash, cutoff);
	const filings = await ctx.db.select().from(sourceFiling).where(and(eq(sourceFiling.source, 'sec'), eq(sourceFiling.issuerId, entity.id)));
	const byAccession = new Map(filings.map((f) => [f.externalId, f]));
	let missingFilings = 0, normalizedFacts = 0;
	await ctx.db.transaction(async (db) => {
		for (const fact of result.facts) {
			if (fact.filedDate > ctx.runDate) continue;
			const filing = byAccession.get(fact.accession);
			if (!filing || filing.status !== 'processed') { missingFilings++; continue; }
			const time = publicTime(filing);
			normalizedFacts++;
			await db.insert(fundamental).values({ issuerId: entity.id, metric: fact.metric, value: fact.value,
				currency: fact.currency, periodType: fact.periodType, periodStart: fact.periodStart, periodEnd: fact.periodEnd,
				unit: fact.unit, reportingBasis: fact.reportingBasis, source: 'sec', sourceRecordId: fact.sourceRecordId,
				filingId: filing.id, publishedAt: time, publishedDate: time.toISOString().slice(0, 10), observedAt: new Date(evidence.observedAt),
				eligibleForProduct: false, metadata: { ...fact.metadata, evidence }
			}).onConflictDoNothing();
		}
		await updateIssuerMetadata({ ...ctx, db: db as unknown as JobContext['db'] }, entity.id, {
			factsEvidence: evidence, factsCheckedAt: new Date().toISOString(), factsStatus: missingFilings ? 'pending_filings' : 'processed', factsError: null,
			factIssues: { ...result.issues, missing_filing_evidence: missingFilings }, normalizedFacts
		});
	});
}
