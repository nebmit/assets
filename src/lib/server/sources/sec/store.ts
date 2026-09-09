import { listedShareClasses, commonClassMembers, isUndesignatedCommonStockTitle } from './shareClasses.js';
import { parseInlineFacts, readPrimaryDocument } from './inlineFacts.js';
import { daysBetween } from '../../util.js';
import { parseFinancialHeader } from './filingHeader.js';
import { and, eq, sql } from 'drizzle-orm';
import type { JobContext } from '../../pipeline/types.js';
import { fundamental, insiderTransaction, issuer, instrument, listing, newsItem, sourceFiling } from '../../db/schema.js';
import { hash, type Evidence } from './client.js';
import { acceptanceTime, ownershipForm, type FilingRecord } from './parse.js';
import { normalizeFacts, SEC_NORMALIZATION_VERSION } from './facts.js';
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

export async function persistFacts(ctx: JobContext, entity: typeof issuer.$inferSelect, input: unknown, evidence: Evidence, cutoff: string): Promise<{ missingFilings: number }> {
	const result = normalizeFacts(input, entity.cik!, evidence.hash, cutoff);
	const [currentEntity] = await ctx.db.select().from(issuer).where(eq(issuer.id, entity.id));
	const currentFacts = currentEntity.secMetadata?.factsEvidence as Evidence | undefined;
	const factsRevision = currentFacts?.hash === evidence.hash ? String(currentEntity.secMetadata?.factsRevision ?? currentFacts.observedAt) : evidence.observedAt;
	const filings = await ctx.db.select().from(sourceFiling).where(and(eq(sourceFiling.source, 'sec'), eq(sourceFiling.issuerId, entity.id)));
	const byAccession = new Map(filings.map((f) => [f.externalId, f]));
	let missingFilings = 0, normalizedFacts = 0;
	await ctx.db.transaction(async (db) => {
		const observations: (typeof fundamental.$inferInsert)[] = [];
		async function flush() {
			for (let offset = 0; offset < observations.length; offset += 500) await db.insert(fundamental).values(observations.slice(offset, offset + 500)).onConflictDoNothing();
			observations.length = 0;
		}
		for (const fact of result.facts) {
			if (fact.filedDate > ctx.runDate) continue;
			const filing = byAccession.get(fact.accession);
			if (!filing || filing.status !== 'processed') { missingFilings++; continue; }
			const time = publicTime(filing);
			normalizedFacts++;
			observations.push({ issuerId: entity.id, metric: fact.metric, value: fact.value,
				currency: fact.currency, periodType: fact.periodType, periodStart: fact.periodStart, periodEnd: fact.periodEnd,
				unit: fact.unit, reportingBasis: fact.reportingBasis, source: 'sec', sourceRecordId: hash(JSON.stringify([fact.sourceRecordId, factsRevision])),
				filingId: filing.id, publishedAt: time, publishedDate: time.toISOString().slice(0, 10), observedAt: new Date(evidence.observedAt),
				qualification: fact.metadata.comparisonStatus === 'conflicting_source_values' ? 'conflicting' : 'unqualified', qualificationReason: fact.metadata.comparisonStatus === 'conflicting_source_values' ? 'Competing source values disagree' : 'requires_snapshot_qualification', metadata: { ...fact.metadata, shareBasisDate: filing.reportDate ?? fact.periodEnd, evidence }
			});
		}
		await flush();
		const securities = await db.select().from(instrument).where(eq(instrument.issuerId, entity.id));
		const quotes = await db.select({ assetId: listing.instrumentId, symbol: listing.symbol, from: listing.validFrom, to: listing.validTo }).from(listing).innerJoin(instrument, eq(instrument.id, listing.instrumentId)).where(eq(instrument.issuerId, entity.id));
		for (const filing of financialDocuments(filings, ctx.runDate)) {
			const document = (filing.metadata.documents as Evidence[] | undefined)?.find((e) => e.hash === filing.metadata.currentHash);
			if (!document) { missingFilings++; continue; }
			if (filing.metadata.inlineParsedHash === document.hash && filing.metadata.inlineNormalizationVersion === SEC_NORMALIZATION_VERSION) continue;
			const original = await readPrimaryDocument(document.path, filing.form);
			if (original === null) { missingFilings++; continue; }
			const inlineFacts = parseInlineFacts(original);
			const coverClasses = listedShareClasses(original);
			const commonMembers = commonClassMembers(inlineFacts.map((f) => f.classMember).filter((m): m is string => m !== null));
			for (const fact of inlineFacts) {
				if (fact.periodEnd < cutoff) continue;
				const classMatch = fact.classMember ? /Class([A-Z0-9]+?)(?:Common|Stock|Member)/i.exec(fact.classMember)?.[1]?.toLowerCase() : null;
				const matches = classMatch ? securities.filter((s) => {
					const labels = [s.securityClass ?? '', ...quotes.filter((q) => q.assetId === s.id && q.from <= ctx.runDate && (q.to === null || q.to > filing.filedDate)).map((q) => coverClasses.get(q.symbol ?? '') ?? '')];
					return labels.some((label) => new RegExp(`class\\s+${classMatch}\\b`, 'i').test(label));
				}) : fact.classMember && /(?:^|:)CommonStockMember$/.test(fact.classMember) && commonMembers.length === 1 && securities.length === 1 ? securities : fact.classMember === 'us-gaap:CommonStockMember' ? securities.filter((s) => quotes.some((q) => q.assetId === s.id && q.from <= ctx.runDate && (q.to === null || q.to > filing.filedDate) && isUndesignatedCommonStockTitle(coverClasses.get(q.symbol ?? '') ?? ''))) : [];
				if (fact.classMember && matches.length !== 1) continue;
				const days = fact.periodStart ? daysBetween(fact.periodStart, fact.periodEnd) + 1 : 0;
				const periodType = !days ? 'INSTANT' : days >= 350 && days <= 380 ? 'FY' : days >= 70 && days <= 110 ? 'Q' : days >= 150 && days <= 210 ? 'YTD_6M' : days >= 240 && days <= 300 ? 'YTD_9M' : 'UNSUPPORTED';
				if (periodType === 'UNSUPPORTED') continue;
				const time = publicTime(filing);
				observations.push({ issuerId: entity.id, instrumentId: matches[0]?.id ?? null, source: 'sec', sourceRecordId: hash(JSON.stringify([SEC_NORMALIZATION_VERSION, document.hash, fact])), filingId: filing.id,
					metric: fact.metric, value: fact.value, currency: fact.currency, unit: fact.unit, reportingBasis: fact.reportingBasis, periodStart: fact.periodStart, periodEnd: fact.periodEnd, periodType,
					publishedAt: time, publishedDate: time.toISOString().slice(0, 10), observedAt: new Date(), qualification: 'unqualified', qualificationReason: 'requires_snapshot_qualification',
					metadata: { normalizationVersion: SEC_NORMALIZATION_VERSION, decimals: fact.decimals, precisionBasis: 'reported', classMember: fact.classMember, shareBasisDate: filing.reportDate ?? fact.periodEnd, concept: fact.concept, evidence: document } });
			}
			await flush();
			await db.update(sourceFiling).set({ metadata: { ...filing.metadata, inlineParsedHash: document.hash, inlineNormalizationVersion: SEC_NORMALIZATION_VERSION, reportedShareClasses: [...new Set(inlineFacts.map((f) => f.classMember).filter(Boolean))] } }).where(eq(sourceFiling.id, filing.id));
		}

		await updateIssuerMetadata({ ...ctx, db: db as unknown as JobContext['db'] }, entity.id, {
			factsNormalizationVersion: SEC_NORMALIZATION_VERSION, factsRevision, factsEvidence: evidence, factsCheckedAt: new Date().toISOString(), factsStatus: missingFilings ? 'pending_filings' : 'processed', factsError: null,
			factIssues: { ...result.issues, missing_filing_evidence: missingFilings }, normalizedFacts
		});
	});
	return { missingFilings };
}

function itemLabel(item: string): string {
	return ({ '1.01': 'Material agreement', '1.02': 'Agreement termination', '2.01': 'Acquisition or disposal', '2.02': 'Financial results', '2.03': 'Financial obligation', '2.05': 'Restructuring costs', '2.06': 'Material impairment', '3.01': 'Listing notice', '5.02': 'Director or officer change', '5.07': 'Shareholder vote', '7.01': 'Regulation FD disclosure', '8.01': 'Other events', '9.01': 'Financial statements and exhibits' } as Record<string, string>)[item] ?? `Item ${item}`;
}
