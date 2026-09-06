import { fetchIndexSnapshots, resolveIndexCiks } from './indices.js';
import { selectedEntities, filingScope, isScoped, secJobName } from './selection.js';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { issuer, sourceFiling, ingestionRun } from '../../db/schema.js';
import type { Job, JobContext, JobStats } from '../../pipeline/types.js';
import { addDays } from '../../util.js';
import { archiveEvidence, fetchFinancialSubmission, fetchSecText, readZip, SecAccessError } from './client.js';
import { cik, classifyIssuer, financialForm, ownershipForm, parseDirectory, parseMasterIndex, parseInsiderDataset, parseSubmissions, parseTickers, type Listing } from './parse.js';
import { persistFacts, persistFiling, rememberFiling, updateIssuerMetadata } from './store.js';

export const SEC_SUBMISSIONS_ZIP = 'https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip';
export const SEC_FACTS_ZIP = 'https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip';
const tickerUrl = 'https://www.sec.gov/files/company_tickers_exchange.json';
const directoryRoot = 'https://www.nasdaqtrader.com/dynamic/SymDir/';
function financialCutoff(runDate: string): string { return `${Number(runDate.slice(0, 4)) - 4}-01-01`; }
function ownershipCutoff(runDate: string): string { return addDays(runDate, -366); }
const entities = selectedEntities;
async function included(ctx: JobContext) { return (await entities(ctx)).filter((r) => r.secMetadata?.status === 'included'); }
async function jsonEvidence(url: string) {
	const text = await fetchSecText(url); const input: unknown = JSON.parse(text);
	const evidence = await archiveEvidence(url, text); return { input, evidence };
}
async function ingestSubmissions(ctx: JobContext, entityId: number, id: string, input: unknown, listings: Listing[], evidence: unknown, refreshHistory = false): Promise<void> {
	const [previousEntity] = await ctx.db.select().from(issuer).where(eq(issuer.id, entityId));
	const loadedFiles = new Set((previousEntity.secMetadata?.loadedSubmissionsFiles ?? []) as string[]);
	const parsed = parseSubmissions(input, id);
	const raw = input as { filings?: { recent?: { form?: string[] } } };
	const classification = classifyIssuer(parsed.metadata, listings, raw.filings?.recent?.form ?? []);
	await updateIssuerMetadata(ctx, entityId, { ...classification, listings, submissions: parsed.metadata, submissionsFiles: parsed.files,
		submissionsEvidence: evidence, ...(classification.status !== 'included' ? { submissionsCheckedAt: new Date().toISOString() } : {}) });
	if (classification.status !== 'included') return;
	for (const f of parsed.filings) {
		if (f.filedDate <= ctx.runDate && f.filedDate >= (financialForm.test(f.form) ? financialCutoff(ctx.runDate) : ownershipCutoff(ctx.runDate))) await rememberFiling(ctx, f, entityId);
	}
	for (const file of parsed.files) {
		if (file.filingTo < financialCutoff(ctx.runDate) || (loadedFiles.has(file.name) && !refreshHistory)) continue;
		const url = `https://data.sec.gov/submissions/${file.name}`;
		const payload = await jsonEvidence(url);
		for (const f of parseSubmissions(payload.input, id).filings) {
			if (f.filedDate <= ctx.runDate && f.filedDate >= (financialForm.test(f.form) ? financialCutoff(ctx.runDate) : ownershipCutoff(ctx.runDate))) await rememberFiling(ctx, f, entityId);
		}
		loadedFiles.add(file.name);
		await updateIssuerMetadata(ctx, entityId, { loadedSubmissionsFiles: [...loadedFiles] });
	}
	await updateIssuerMetadata(ctx, entityId, { submissionsCheckedAt: new Date().toISOString() });
}

export const secUniverseJob: Job = {
	name: 'sec_universe', source: 'sec', async run(ctx) {
		const tickersPayload = await jsonEvidence(tickerUrl);
		const tickers = parseTickers(tickersPayload.input);
		const snapshots = ctx.issuerSelection?.indices ? await fetchIndexSnapshots(ctx.issuerSelection.indices) : [];
		const membership = resolveIndexCiks(snapshots, tickers);
		if (snapshots.length) {
			if (!membership.members.size) throw new Error('No index holdings resolved to SEC issuers');
			for (const snapshot of snapshots) {
				const missing = membership.unresolved.filter((row) => row.index === snapshot.index).length;
				if (missing > snapshot.holdings.length * 0.05) throw new Error(`Too many unresolved ${snapshot.index} holdings: ${missing}/${snapshot.holdings.length}`);
			}
			ctx.issuerSelection!.ciks = [...membership.members.keys()].sort();
			ctx.log(`selected ${membership.members.size} issuers from ${snapshots.map((s) => s.index).join(' + ')}; ${membership.unresolved.length} unresolved holdings`);
		}

		const listings: Listing[] = [];
		for (const file of ['nasdaqlisted.txt', 'otherlisted.txt']) {
			const url = directoryRoot + file, text = await fetchSecText(url);
			await archiveEvidence(url, text); listings.push(...parseDirectory(text));
		}
		// Exact symbols only. Punctuation/venue ambiguity is reported instead of guessed.
		const listingsBySymbol = new Map<string, Listing[]>();
		for (const l of listings) { const bucket = listingsBySymbol.get(l.symbol) ?? []; bucket.push(l); listingsBySymbol.set(l.symbol, bucket); }
		const tickerCiks = new Map<string, Set<string>>();
		for (const t of tickers) { const ids = tickerCiks.get(t.ticker) ?? new Set(); ids.add(t.cik); tickerCiks.set(t.ticker, ids); }
		const grouped = new Map<string, { name: string; listings: Listing[] }>();
		for (const t of tickers) {
			if (ctx.cik && t.cik !== ctx.cik) continue;
			if (snapshots.length && !membership.members.has(t.cik)) continue;
			const matches = listingsBySymbol.get(t.ticker) ?? [];
			if (!matches.length && !ctx.cik && !snapshots.length) continue;
			const group = grouped.get(t.cik) ?? { name: t.name, listings: [] };
			if (tickerCiks.get(t.ticker)?.size === 1) group.listings.push(...matches);
			grouped.set(t.cik, group);
		}
		if (!grouped.size) throw new Error('no SEC issuer candidates resolved');
		const refresh = new Map<string, { id: number; listings: Listing[] }>();
		for (const [id, group] of grouped) {
			const [entity] = await ctx.db.insert(issuer).values({ name: group.name, cik: id, secMetadata: { status: 'pending', reason: 'submissions_pending' } })
				.onConflictDoUpdate({ target: issuer.cik, set: { cik: id } }).returning();
			await updateIssuerMetadata(ctx, entity.id, { listings: group.listings, listingObservedAt: new Date().toISOString(), tickerEvidence: tickersPayload.evidence });
			if (!entity.secMetadata?.submissionsCheckedAt || entity.secMetadata?.status === 'pending' || JSON.stringify(entity.secMetadata?.listings) !== JSON.stringify(group.listings) || String(entity.secMetadata?.submissionsCheckedAt ?? '') < addDays(ctx.runDate,-7)) refresh.set(id, { id: entity.id, listings: group.listings });
		}
		// Preserve delisted entities and past observations, but don't claim they're current members.
		if (!isScoped(ctx)) for (const entity of await entities(ctx)) if (!grouped.has(entity.cik!)) await updateIssuerMetadata(ctx, entity.id, { status: 'excluded', reason: 'not_in_current_directories', listingObservedAt: new Date().toISOString() });
		let processed = 0;
		if (refresh.size > 20 && !isScoped(ctx)) {
			await readZip(SEC_SUBMISSIONS_ZIP, (name) => /^CIK\d{10}\.json$/.test(name) && refresh.has(name.slice(3,13)), async (name, text) => {
				const id = name.slice(3,13), entry = refresh.get(id)!;
				const evidence = await archiveEvidence(`${SEC_SUBMISSIONS_ZIP}#${name}`, text);
				await ingestSubmissions(ctx, entry.id, id, JSON.parse(text), entry.listings, evidence); processed++;
			});
		} else {
			for (const [id, entry] of refresh) {
				const p = await jsonEvidence(`https://data.sec.gov/submissions/CIK${id}.json`);
				await ingestSubmissions(ctx, entry.id, id, p.input, entry.listings, p.evidence); processed++;
			}
		}
		const unresolved = listings.filter((l) => !l.excludedReason && tickerCiks.get(l.symbol)?.size !== 1);
		const report = await archiveEvidence('sec:universe-reconciliation', JSON.stringify({ observedAt: new Date().toISOString(), listings, unresolved, indexSnapshots: snapshots, unresolvedIndexHoldings: membership.unresolved, selectedCiks: ctx.issuerSelection?.ciks }));
		return { ...(snapshots.length ? { indices: snapshots.map((s) => s.index).join(','), membership_basis: 'etf_holdings_proxy', selection_ciks: JSON.stringify(ctx.issuerSelection!.ciks), unresolved_index_holdings: membership.unresolved.length, holdings_as_of: snapshots.map((s) => `${s.index}:${s.asOf}`).join(',') } : {}), candidates: grouped.size, refreshed: processed, refresh_missing: refresh.size - processed, unresolved_listings: unresolved.length, directory_listings: listings.length, reconciliation_path: report.path };
	}
};

function quarters(from: string, to: string): { year: number; quarter: number }[] {
	const output = []; let y = Number(from.slice(0,4)), q = Math.floor((Number(from.slice(5,7))-1)/3)+1;
	while (`${y}-${String((q-1)*3+1).padStart(2,'0')}-01` <= to) { output.push({ year: y, quarter: q }); if (++q === 5) { q = 1; y++; } }
	return output;
}
async function discover(ctx: JobContext, from: string, reconcile = false): Promise<{ indexes: number; newest: string }> {
	const entityRows = await included(ctx), byCik = new Map(entityRows.map((e) => [e.cik, e.id]));
	let indexes = 0, newest = from;
	for (const { year, quarter } of quarters(from, ctx.runDate)) {
		const root = `https://www.sec.gov/Archives/edgar/${reconcile ? 'full-index' : 'daily-index'}/${year}/QTR${quarter}/`;
		let urls: string[];
		if (reconcile) urls = [root + 'master.idx'];
		else {
			const directory = await jsonEvidence(root + 'index.json');
			const entries = z.object({ directory: z.object({ item: z.array(z.object({ name: z.string() })) }) }).parse(directory.input).directory.item;
			urls = entries.map((e) => e.name).filter((name) => {
				const m = /^master\.(\d{4})(\d{2})(\d{2})\.idx$/.exec(name); if (!m) return false;
				const d = `${m[1]}-${m[2]}-${m[3]}`; return d >= from && d <= ctx.runDate;
			}).sort().map((name) => root + name);
		}
		for (const url of urls) {
			const text = await fetchSecText(url);
			const evidence = await archiveEvidence(url, text);
			let rows: ReturnType<typeof parseMasterIndex>;
			try { rows = parseMasterIndex(text); }
			catch (error) { throw new Error(`Invalid EDGAR index ${url}: ${error instanceof Error ? error.message : String(error)}; archived at ${evidence.path}`, { cause: error }); }
			indexes++;
			const seen = new Set<string>();
			for (const f of rows) {
				seen.add(f.accession);
				if (f.filedDate > newest) newest = f.filedDate;
				if (f.filedDate < from || f.filedDate > ctx.runDate || (!financialForm.test(f.form) && f.filedDate < ownershipCutoff(ctx.runDate))) continue;
				const id = byCik.get(f.cik) ?? null;
				// In a targeted run issuer submissions provide the ownership set. Broad runs inspect all unknown ownership issuers.
				if (id !== null || (!ctx.cik && ownershipForm.test(f.form))) await rememberFiling(ctx, f, id);
			}
			if (reconcile) {
				const begin = `${year}-${String((quarter-1)*3+1).padStart(2,'0')}-01`;
				const end = quarter === 4 ? `${year+1}-01-01` : `${year}-${String(quarter*3+1).padStart(2,'0')}-01`;
				const known = await ctx.db.select().from(sourceFiling).where(and(eq(sourceFiling.source,'sec'), sql`${sourceFiling.filedDate} >= ${begin} and ${sourceFiling.filedDate} < ${end}`));
				for (const f of known) {
					if (ctx.cik && !entityRows.some((e) => e.id === f.issuerId)) continue;
					const sourceState = seen.has(f.externalId) ? 'present' : 'missing_from_rebuilt_index';
					await ctx.db.update(sourceFiling).set({ metadata: { ...f.metadata, sourceState, reconciledAt: new Date().toISOString() } }).where(eq(sourceFiling.id,f.id));
				}
			}
		}
	}
	return { indexes, newest };
}
async function processFilings(ctx: JobContext, ownership: boolean): Promise<JobStats> {
	const ids = (await included(ctx)).map((e) => e.id);
	const rows = await ctx.db.select().from(sourceFiling).where(and(eq(sourceFiling.source, 'sec'), inArray(sourceFiling.status, ['pending', 'error']), filingScope(ctx, ids)));
	ctx.log(`${ownership ? 'ownership' : 'financial/news'} queue: ${rows.filter((f) => ownershipForm.test(f.form) === ownership && f.filedDate <= ctx.runDate).length} filings for ${ids.length} issuers`);
	let processed = 0, failed = 0;
	for (const f of rows) {
		if (f.filedDate > ctx.runDate || ownershipForm.test(f.form) !== ownership) continue;
		try {
			if (ownership) {
				const text = await fetchSecText(f.url);
				await persistFiling(ctx, f, text, await archiveEvidence(f.url, text));
			} else {
				const { header, evidence } = await fetchFinancialSubmission(f.url, f.externalId);
				await persistFiling(ctx, f, header, evidence);
			}
			processed++;
			if (processed % 100 === 0) ctx.log(`processed ${processed} ${ownership ? 'ownership' : 'financial/news'} filings; ${failed} failed`);
		} catch (error) {
			if (error instanceof SecAccessError) throw error;
			failed++;
			await ctx.db.update(sourceFiling).set({ status: 'error', error: String(error), attempts: f.attempts + 1, updatedAt: new Date() }).where(eq(sourceFiling.id, f.id));
			ctx.log(`${f.externalId}: ${String(error)}`);
		}
	}
	return { processed, failed };
}
export const secFilingsJob: Job = {
	name: 'sec_filings', source: 'sec', async run(ctx) {
		if (isScoped(ctx)) {
			const cohort = await included(ctx);
			if (!cohort.length) throw new Error('No selected eligible issuers; run --source=sec to discover the index universe first');
			ctx.log(`refreshing submissions for ${cohort.length} selected issuers`);
			for (const e of cohort) {
				const payload = await jsonEvidence(`https://data.sec.gov/submissions/CIK${e.cik}.json`);
				await ingestSubmissions(ctx,e.id,e.cik!,payload.input,(e.secMetadata?.listings ?? []) as Listing[],payload.evidence);
			}
			return { discovery: 'issuer_submissions', issuers: cohort.length, ...await processFilings(ctx,false) };
		}
		const [last] = await ctx.db.select().from(ingestionRun).where(and(eq(ingestionRun.source,'sec'), eq(ingestionRun.job, secJobName('sec_filings', ctx)), sql`${ingestionRun.stats}->>'completed_through' is not null`)).orderBy(sql`${ingestionRun.finishedAt} desc`).limit(1);
		const stats = last?.stats as Record<string, unknown> | null;
		const previous = typeof stats?.completed_through === 'string' ? stats.completed_through : ownershipCutoff(ctx.runDate);
		const from = previous < addDays(ctx.runDate,-7) ? previous : addDays(ctx.runDate,-7);
		const discovery = await discover(ctx, from);
		// Refresh changed company metadata/history and retain historical chunks on bootstrap.
		const changed = await ctx.db.selectDistinct({ issuerId: sourceFiling.issuerId }).from(sourceFiling).where(and(eq(sourceFiling.source,'sec'), eq(sourceFiling.status,'pending')));
		const changedIds = new Set(changed.map((f) => f.issuerId));
		for (const e of await included(ctx)) if (changedIds.has(e.id)) {
			const p = await jsonEvidence(`https://data.sec.gov/submissions/CIK${e.cik}.json`);
			await ingestSubmissions(ctx,e.id,e.cik!,p.input,(e.secMetadata?.listings ?? []) as Listing[],p.evidence);
		}
		return { indexes: discovery.indexes, completed_through: discovery.newest, ...await processFilings(ctx, false) };
	}
};
export const secInsidersJob: Job = { name: 'sec_insiders', source: 'sec', run: (ctx) => processFilings(ctx, true) };

export const secFundamentalsJob: Job = {
	name: 'sec_fundamentals', source: 'sec', async run(ctx) {
		const all = await included(ctx);
		const pending = new Map<string, typeof all[number]>();
		for (const e of all) {
			const [latest] = await ctx.db.select({ updatedAt: sourceFiling.updatedAt }).from(sourceFiling).where(and(eq(sourceFiling.issuerId,e.id), eq(sourceFiling.source,'sec'), sql`${sourceFiling.form} ~ '^10-(K|Q)'`)).orderBy(sql`${sourceFiling.updatedAt} desc`).limit(1);
			if (e.secMetadata?.factsStatus !== 'processed' || (latest && latest.updatedAt.toISOString() > String(e.secMetadata?.factsCheckedAt ?? ''))) pending.set(e.cik!, e);
		}
		let processed = 0, failed = 0;
		async function consume(id: string, text: string, url: string) {
			const e = pending.get(id)!;
			try { const evidence = await archiveEvidence(url,text); await persistFacts(ctx,e,JSON.parse(text),evidence,financialCutoff(ctx.runDate)); processed++; }
			catch (error) {
				if (error instanceof SecAccessError) throw error;
				failed++;
				ctx.log(`fundamentals failed for CIK ${id} (${url}): ${String(error)}`);
				await updateIssuerMetadata(ctx,e.id,{ factsStatus: 'error', factsError: String(error) });
			}
		}
		if (pending.size > 20 && !isScoped(ctx)) {
			const seen = new Set<string>();
			await readZip(SEC_FACTS_ZIP,(name) => /^CIK\d{10}\.json$/.test(name) && pending.has(name.slice(3,13)),async (name,text) => { const id = name.slice(3,13); seen.add(id); await consume(id,text,`${SEC_FACTS_ZIP}#${name}`); });
			for (const [id,e] of pending) if (!seen.has(id)) { failed++; await updateIssuerMetadata(ctx,e.id,{ factsStatus: 'unavailable', factsError: 'missing_from_companyfacts_archive' }); }
		} else for (const [id,e] of pending) {
			const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`;
			try { await consume(id,await fetchSecText(url),url); }
			catch (error) {
				if (error instanceof SecAccessError) throw error;
				failed++;
				ctx.log(`fundamentals failed for CIK ${id} (${url}): ${String(error)}`);
				await updateIssuerMetadata(ctx,e.id,{ factsStatus: 'error', factsError: String(error) });
			}
		}
		return { issuers: all.length, refreshed: processed, failed };
	}
};

export const secReconcileJob: Job = {
	name: 'sec_reconcile', source: 'sec', async run(ctx): Promise<JobStats> {
		if (isScoped(ctx)) {
			const cohort = await included(ctx);
			for (const e of cohort) {
				const payload = await jsonEvidence(`https://data.sec.gov/submissions/CIK${e.cik}.json`);
				await ingestSubmissions(ctx,e.id,e.cik!,payload.input,(e.secMetadata?.listings ?? []) as Listing[],payload.evidence,true);
				await updateIssuerMetadata(ctx,e.id,{ factsStatus: 'reconciliation_pending' });
				await ctx.db.update(sourceFiling).set({ status: 'pending' }).where(and(eq(sourceFiling.source,'sec'),eq(sourceFiling.issuerId,e.id)));
			}
			return { issuers: cohort.length, reconciliation: 'issuer_submissions', global_index_and_insider_archives: 'not_checked_scoped_run' };
		}
		const all = await included(ctx), byCik = new Map(all.map((e) => [e.cik!,e]));
		for (const e of all) await updateIssuerMetadata(ctx,e.id,{ loadedSubmissionsFiles: [] });
		await readZip(SEC_SUBMISSIONS_ZIP,(name) => /^CIK\d{10}\.json$/.test(name) && byCik.has(name.slice(3,13)),async (name,text) => {
			const id = name.slice(3,13), e = byCik.get(id)!;
			await ingestSubmissions(ctx,e.id,id,JSON.parse(text),(e.secMetadata?.listings ?? []) as Listing[],await archiveEvidence(`${SEC_SUBMISSIONS_ZIP}#${name}`,text),true);
		});
		const discovery = await discover(ctx, financialCutoff(ctx.runDate), true);
		// Recheck originals, retaining changed hashes; no destructive reconciliation.
		for (const e of all) {
			await updateIssuerMetadata(ctx,e.id,{ factsStatus: 'reconciliation_pending' });
			await ctx.db.update(sourceFiling).set({ status: 'pending' }).where(and(eq(sourceFiling.source,'sec'),eq(sourceFiling.issuerId,e.id),sql`${sourceFiling.metadata}->>'sourceState' = 'present'`));
		}
		return { indexes: discovery.indexes, issuers: all.length, ...await reconcileInsiderDatasets(ctx) };
	}
};

async function reconcileInsiderDatasets(ctx: JobContext): Promise<JobStats> {
	const page = 'https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets';
	const html = await fetchSecText(page); await archiveEvidence(page,html);
	const links = [...html.matchAll(/href=["']([^"']+\.zip)["']/gi)].map((m) => new URL(m[1],page).href);
	const years = new Set(quarters(ownershipCutoff(ctx.runDate),ctx.runDate).map((q) => `${q.year}q${q.quarter}`));
	const selected = [...new Set(links)].filter((url) => [...years].some((q) => url.toLowerCase().includes(q)));
	let accessions = 0, missing = 0;
	const known = new Set((await ctx.db.select({ id: sourceFiling.externalId }).from(sourceFiling).where(eq(sourceFiling.source,'sec'))).map((f) => f.id));
	const targetCiks = new Map((await included(ctx)).map((e) => [e.cik!, e.id]));
	for (const url of selected) {
		let found = false;
		await readZip(url,(name) => /(^|\/)SUBMISSION\.tsv$/i.test(name),async (_name,text) => {
			found = true;
			await archiveEvidence(url + '#SUBMISSION.tsv',text);
			for (const row of parseInsiderDataset(text)) {
				const id = targetCiks.get(row.cik);
				if (!id || row.filedDate < ownershipCutoff(ctx.runDate) || row.filedDate > ctx.runDate) continue;
				accessions++;
				if (!known.has(row.accession)) {
					missing++;
					await rememberFiling(ctx, { ...row, url: `https://www.sec.gov/Archives/edgar/data/${Number(row.cik)}/${row.accession.replaceAll('-', '')}/${row.accession}.txt` },id);
				}
			}
		});
		if (!found) throw new Error('insider archive missing SUBMISSION.tsv');
	}
	return { insider_archives: selected.length, insider_archive_status: selected.length ? 'checked' : 'unavailable', insider_dataset_accessions: accessions, insider_dataset_missing: missing };
}

export const secJobs = [secUniverseJob, secFilingsJob, secFundamentalsJob, secInsidersJob];
export async function secReport(ctx: JobContext): Promise<Record<string, unknown>> {
	const all = await entities(ctx);
	const filingCounts = await ctx.db.execute(sql`
		select issuer_id, count(*)::int as filings,
			min(filed_date) as earliest_filing, max(filed_date) as latest_filing,
			count(*) filter (where status = 'pending')::int as pending,
			count(*) filter (where status = 'error')::int as failed,
			count(*) filter (where metadata->>'amendmentStatus' = 'unresolved')::int as unresolved_amendments,
			count(*) filter (where metadata->>'sourceState' = 'missing_from_rebuilt_index')::int as missing_from_index
		from source_filing where source = 'sec' ${isScoped(ctx) ? sql`and ${filingScope(ctx, all.map((e) => e.id))}` : sql``} group by issuer_id
	`);
	const counts = new Map((filingCounts as unknown as {issuer_id: number; [key: string]: unknown}[]).map((r) => [r.issuer_id, r]));
	const runs = await ctx.db.select().from(ingestionRun).where(eq(ingestionRun.source,'sec')).orderBy(sql`${ingestionRun.startedAt} desc`).limit(20);
	const [universeRun] = await ctx.db.select().from(ingestionRun).where(and(eq(ingestionRun.source, 'sec'), eq(ingestionRun.job, secJobName('sec_universe', ctx)), eq(ingestionRun.status, 'success'))).orderBy(sql`${ingestionRun.finishedAt} desc`).limit(1);
	const universeStats = universeRun?.stats as Record<string, unknown> | undefined;
	const summary = { included: 0, excluded: 0, pending: 0 };
	for (const e of all) { const status = e.secMetadata?.status; summary[status === 'included' || status === 'excluded' ? status : 'pending']++; }
	return { generatedAt: new Date().toISOString(), requestedThrough: ctx.runDate,
		prices: 'unsupported', shortPositions: 'unsupported', selection: { indices: ctx.cik ? [] : ctx.issuerSelection?.indices ?? 'all', membershipBasis: ctx.issuerSelection?.indices ? 'etf_holdings_proxy' : 'sec_directory', observedAt: universeRun?.finishedAt, holdingsAsOf: universeStats?.holdings_as_of, unresolvedHoldings: universeStats?.unresolved_index_holdings, evidencePath: universeStats?.reconciliation_path, ciks: all.map((e) => e.cik) }, summary,
		issuers: all.map((e) => ({ cik: e.cik, name: e.name, status: e.secMetadata?.status, reason: e.secMetadata?.reason,
			listings: e.secMetadata?.listings, listingObservedAt: e.secMetadata?.listingObservedAt,
			factsStatus: e.secMetadata?.factsStatus ?? 'pending', factsCheckedAt: e.secMetadata?.factsCheckedAt,
			factIssues: e.secMetadata?.factIssues, factsError: e.secMetadata?.factsError,
			normalizedFacts: e.secMetadata?.normalizedFacts ?? 0, coverage: counts.get(e.id) ?? { filings: 0 },
			ownershipCurrency: 'unqualified', comparablePerShareBasis: 'unqualified'
		})), unmatchedFilings: counts.get(null as unknown as number) ?? null, runs };
}
