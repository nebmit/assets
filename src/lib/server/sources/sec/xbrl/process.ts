import { canonicalJson } from './canonical.js';
import { readStoredText, storedExists } from '../../../storage.js';
import { and, eq, sql } from 'drizzle-orm';
import type { JobContext } from '../../../pipeline/types.js';
import { fundamental, instrument, listing, secExtraction, secProcessing, sourceFiling } from '../../../db/schema.js';
import { archiveEvidence, fetchFinancialSubmission, hash, SecTransportError, SecAccessError, type Evidence } from '../client.js';
import { buildPackage, verifyPackage } from './package.js';
import { extractPackage } from './extract.js';
import { artifactSchema, PARSER_CONFIG, PARSER_VERSION, RESOLVER_VERSION, XbrlError, type FilingPackage } from './types.js';
import { normalizeArtifact } from './normalize.js';
import { publicTime, type Filing } from '../store.js';
export const configHash = hash(canonicalJson(PARSER_CONFIG));
export const globalFailure = (error: unknown): boolean => error instanceof Error && ('query' in error || 'cause' in error && globalFailure(error.cause)) || error instanceof XbrlError && ['evidence_integrity', 'artifact_version', 'parser_unavailable'].includes(error.code) || ['ENOSPC','EACCES','EIO','ECONNREFUSED'].includes(String((error as NodeJS.ErrnoException)?.code ?? ''));

/** The archive keeps only what the SEC archive prune retains; a pruned submission is re-downloaded and must still match. */
async function submission(filing: Filing, source: Evidence): Promise<Evidence> {
	if (await storedExists(source.path)) return source;
	const { evidence } = await fetchFinancialSubmission(filing.url, filing.externalId, true);
	if (evidence.hash !== source.hash) throw new XbrlError('missing_filing_evidence', 'SEC submission changed since it was recorded; awaiting sec_filings', true);
	return { ...source, path: evidence.path };
}

/** Pruned package documents are rebuilt from the submission; content addressing keeps the package hash stable. */
async function filingPackage(filing: Filing, source: Evidence, previous: FilingPackage | null): Promise<FilingPackage> {
	if (previous) {
		try { await verifyPackage(previous); return previous; }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
	}
	const manifest = await buildPackage({ accession: filing.externalId, acceptedAt: filing.acceptedAt?.toISOString() ?? null, form: filing.form, evidence: await submission(filing, source) });
	await verifyPackage(manifest);
	return manifest;
}

async function extractArtifact(manifest: FilingPackage, packageHash: string) {
	const artifact = await extractPackage(manifest);
	if (!artifact.facts.length || artifact.diagnostics.some((d) => /xmlSchema:syntax|IOerror|FileNotLoadable|missingReferences/.test(d.code))) throw new XbrlError('unreadable_document', 'Document or required taxonomy could not be loaded');
	if (artifact.contexts.some((c) => !c.valid)) throw new XbrlError('invalid_context', 'Invalid XBRL context');
	return { artifact, evidence: await archiveEvidence(`sec:extraction:${packageHash}:${PARSER_VERSION}`, JSON.stringify(artifact)) };
}

/** Stage checkpoints are committed independently. Successful observations are immutable. */
export async function processFinancialFiling(ctx: JobContext, filing: Filing): Promise<{ ok: boolean; facts: number; issues: Record<string, number> }> {
	if (!filing.issuerId) throw new Error('financial filing has no issuer');
	const inputHash = String(filing.metadata.currentHash ?? 'missing');
	const where = and(eq(secProcessing.filingId, filing.id), eq(secProcessing.inputHash, inputHash), eq(secProcessing.parserVersion, PARSER_VERSION), eq(secProcessing.resolverVersion, RESOLVER_VERSION), eq(secProcessing.configHash, configHash));
	const [previous] = await ctx.db.select().from(secProcessing).where(where);
	if (previous?.status === 'complete') return { ok: true, facts: 0, issues: {} };
	if (previous?.status === 'failed' && (!previous.retryAt || previous.retryAt > new Date())) return { ok: false, facts: 0, issues: { [previous.reasonCode ?? 'processing_failed']: 1 } };
	await ctx.db.insert(secProcessing).values({ filingId: filing.id, inputHash, configHash, parserVersion: PARSER_VERSION, resolverVersion: RESOLVER_VERSION, stage: 'fetch', status: 'running', attempts: 1 }).onConflictDoUpdate({ target: [secProcessing.filingId, secProcessing.inputHash, secProcessing.parserVersion, secProcessing.resolverVersion, secProcessing.configHash], set: { status: 'running', attempts: sql`${secProcessing.attempts} + 1`, updatedAt: new Date() } });
	try {
		const source = (filing.metadata.documents as Evidence[] | undefined)?.find((d) => d.hash === inputHash);
		if (!source) throw new XbrlError('missing_filing_evidence', 'Archived submission missing', true);
		const manifest = await filingPackage(filing, source, previous?.manifest ?? null);
		await ctx.db.update(secProcessing).set({ manifest, stage: 'extract', updatedAt: new Date() }).where(where);
		const packageHash = hash(canonicalJson(manifest));
		let [extraction] = await ctx.db.select().from(secExtraction).where(and(eq(secExtraction.filingId, filing.id), eq(secExtraction.packageHash, packageHash), eq(secExtraction.parserVersion, PARSER_VERSION), eq(secExtraction.configHash, configHash)));
		if (!extraction) {
			const { artifact, evidence } = await extractArtifact(manifest, packageHash);
			[extraction] = await ctx.db.insert(secExtraction).values({ filingId: filing.id, packageHash, parserVersion: PARSER_VERSION, configHash, manifest, artifact: evidence, diagnostics: artifact.diagnostics, observedAt: new Date(Math.max(...manifest.documents.map((d) => Date.parse(d.observedAt)))) }).onConflictDoNothing().returning();
			if (!extraction) [extraction] = await ctx.db.select().from(secExtraction).where(and(eq(secExtraction.filingId, filing.id), eq(secExtraction.packageHash, packageHash), eq(secExtraction.parserVersion, PARSER_VERSION), eq(secExtraction.configHash, configHash)));
		} else if (!(await storedExists(extraction.artifact.path))) {
			// A pruned artifact is re-extracted; the recorded extraction stays authoritative.
			const { evidence } = await extractArtifact(manifest, packageHash);
			if (evidence.hash !== extraction.artifact.hash) throw new XbrlError('artifact_mismatch', 'Re-extracted artifact differs from the recorded extraction');
			extraction = { ...extraction, artifact: { ...extraction.artifact, path: evidence.path } };
		}
		await ctx.db.update(secProcessing).set({ extractionId: extraction.id, stage: 'normalize', updatedAt: new Date() }).where(where);
		const content = await readStoredText(extraction.artifact.path);
		if (hash(content) !== extraction.artifact.hash) throw new XbrlError('evidence_integrity', 'Extraction artifact hash mismatch');
		const parsed = artifactSchema.safeParse(JSON.parse(content));
		if (!parsed.success) throw new XbrlError('artifact_version', 'Unsupported extraction artifact');
		const quotes = await ctx.db.select({ instrumentId: instrument.id, symbol: listing.symbol }).from(instrument).innerJoin(listing, eq(listing.instrumentId, instrument.id)).where(and(eq(instrument.issuerId, filing.issuerId), sql`${listing.validFrom} <= ${ctx.runDate} and (${listing.validTo} is null or ${listing.validTo} > ${filing.filedDate})`));
		const entity = await ctx.db.query.issuer.findFirst({ where: (t, { eq }) => eq(t.id, filing.issuerId!) });
		const normalized = normalizeArtifact(parsed.data, entity!.cik!, quotes.filter((q): q is { instrumentId: number; symbol: string } => q.symbol !== null));
		const time = publicTime(filing), observedAt = new Date();
		await ctx.db.transaction(async (db) => {
			for (let offset = 0; offset < normalized.candidates.length; offset += 500) {
				const rows = normalized.candidates.slice(offset, offset + 500).map((f) => ({ issuerId: filing.issuerId!, instrumentId: f.instrumentId, source: 'sec' as const,
					sourceRecordId: hash(JSON.stringify([extraction.id, RESOLVER_VERSION, f.factId])), filingId: filing.id, metric: f.metric, value: f.value, currency: f.currency, unit: f.unit, periodStart: f.periodStart, periodEnd: f.periodEnd, periodType: f.periodType, reportingBasis: f.reportingBasis,
					publishedAt: time, publishedDate: time.toISOString().slice(0, 10), observedAt, qualification: f.qualification, qualificationReason: f.reasonCode,
					metadata: { extractionId: extraction.id, resolverVersion: RESOLVER_VERSION, semanticKey: f.semanticKey, classId: f.classId, scope: f.scope, decimals: f.decimals, concept: f.concept, context: f.context, dimensions: f.dimensions, sourceFactId: f.factId, sourceFactIds: f.sourceFactIds, evidence: extraction.artifact, shareBasisDate: f.periodEnd, classInventory: normalized.classInventory, inventoryComplete: normalized.inventoryComplete, classBindings: normalized.bindings } }));
				if (rows.length) await db.insert(fundamental).values(rows).onConflictDoNothing();
			}
			await db.update(secProcessing).set({ stage: 'resolve', status: 'complete', reasonCode: null, error: null, retryAt: null, updatedAt: observedAt }).where(where);
			await db.update(sourceFiling).set({ metadata: sql`${sourceFiling.metadata} || ${JSON.stringify({ xbrlExtractionId: extraction.id, xbrlResolverVersion: RESOLVER_VERSION, xbrlIssues: normalized.issues })}::jsonb` }).where(eq(sourceFiling.id, filing.id));
		});
		return { ok: true, facts: normalized.candidates.length, issues: normalized.issues };
	} catch (error) {
		const transient = error instanceof SecTransportError || error instanceof SecAccessError || error instanceof XbrlError && error.transient;
		await ctx.db.update(secProcessing).set({ status: 'failed', reasonCode: error instanceof XbrlError ? error.code : transient ? 'transport_failed' : 'processing_failed', error: String(error), retryAt: transient ? new Date(Date.now() + Math.min(3600_000, 1000 * 2 ** Math.min(previous?.attempts ?? 0, 12))) : null, updatedAt: new Date() }).where(where);
		if (globalFailure(error)) throw error;
		ctx.log(`CIK filing ${filing.externalId}: ${String(error)}`);
		return { ok: false, facts: 0, issues: { [error instanceof XbrlError ? error.code : 'processing_failed']: 1 } };
	}
}
