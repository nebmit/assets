import { sql } from 'drizzle-orm';
import type { ParsedShortPosition } from '../sources/bundesanzeiger/parse.js';
import type { SnapshotDiagnostics } from '../shortSellers/analysis.js';
import {
	bigint,
	boolean,
	date,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	serial,
	uuid,
	text,
	timestamp,
	uniqueIndex,
	index
} from 'drizzle-orm/pg-core';

export const universe = pgTable('universe', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	sizeBand: text('size_band').$type<'large' | 'mid' | 'small'>().notNull(),
	source: text('source').notNull(),
	basis: text('basis').notNull()
});
// 'other' covers BaFin's "Sonstiges" (share awards, option exercises, …)
export const sideEnum = pgEnum('transaction_side', ['buy', 'sell', 'other']);
export const partyRoleEnum = pgEnum('party_role', [
	'executive_board',
	'supervisory_board',
	'related_party',
	'other'
]);
export const fundamentalSourceEnum = pgEnum('fundamental_source', ['boerse_frankfurt', 'esef', 'sec']);
export const runStatusEnum = pgEnum('run_status', ['running', 'success', 'error']);

/** Legal entity that issues instruments and files reports (1:N with instrument). */
export const issuer = pgTable(
	'issuer',
	{
		id: serial('id').primaryKey(),
		name: text('name').notNull(),
		lei: text('lei'),
		cik: text('cik').unique(),
		secMetadata: jsonb('sec_metadata').$type<Record<string, unknown>>(),
		sector: text('sector'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('issuer_lei_idx').on(t.lei)]
);

/** Durable filing work queue and evidence; independent of instrument identity. */
export const sourceFiling = pgTable('source_filing', {
	id: serial('id').primaryKey(),
	source: text('source').notNull(),
	externalId: text('external_id').notNull(),
	issuerId: integer('issuer_id').references(() => issuer.id),
	form: text('form').notNull(),
	filedDate: date('filed_date').notNull(),
	reportDate: date('report_date'),
	acceptedAt: timestamp('accepted_at', { withTimezone: true }),
	observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
	url: text('url').notNull(),
	status: text('status').notNull().default('pending'),
	attempts: integer('attempts').notNull().default(0),
	error: text('error'),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [
	uniqueIndex('source_filing_external_idx').on(t.source, t.externalId),
	index('source_filing_work_idx').on(t.source, t.status),
	index('source_filing_issuer_idx').on(t.issuerId, t.filedDate)
]);

/** Tradeable equity instrument. */
export const instrument = pgTable(
	'instrument',
	{
		id: serial('id').primaryKey(),
		issuerId: integer('issuer_id')
			.notNull()
			.references(() => issuer.id),
		assetId: uuid('asset_id').notNull().defaultRandom().unique(),
		isin: text('isin').unique(),
		securityClass: text('security_class'),
		shortDisclosureSource: text('short_disclosure_source'),
		wkn: text('wkn'),
		firstSeen: date('first_seen').notNull(),
		lastSeen: date('last_seen').notNull()
	},
	(t) => [index('instrument_issuer_idx').on(t.issuerId)]
);

/** A dated exchange listing; symbols are never permanent security identities. */
export const listing = pgTable('listing', {
	id: serial('id').primaryKey(),
	instrumentId: integer('instrument_id').notNull().references(() => instrument.id),
	mic: text('mic').notNull(),
	symbol: text('symbol'),
	currency: text('currency').notNull(),
	source: text('source').notNull(),
	validFrom: date('valid_from').notNull(),
	validTo: date('valid_to'),
	isPrimary: boolean('is_primary').notNull().default(true),
	priceHistoryCoveredFrom: date('price_history_covered_from'),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({})
}, (t) => [index('listing_instrument_idx').on(t.instrumentId),
	uniqueIndex('listing_primary_idx').on(t.instrumentId).where(sql`${t.isPrimary} and ${t.validTo} is null`),
	uniqueIndex('listing_symbol_idx').on(t.source, t.mic, t.symbol).where(sql`${t.validTo} is null`)]);

export const providerIdentifier = pgTable('provider_identifier', {
	id: serial('id').primaryKey(),
	instrumentId: integer('instrument_id').notNull().references(() => instrument.id),
	source: text('source').notNull(),
	externalId: text('external_id').notNull(),
	validFrom: date('valid_from').notNull(),
	validTo: date('valid_to'),
	evidence: jsonb('evidence').$type<Record<string, unknown>>()
}, (t) => [uniqueIndex('provider_identifier_active_idx').on(t.source, t.externalId).where(sql`${t.validTo} is null`)]);

/** Interval-form index constituency, maintained by daily diff (point-in-time queryable). */
export const indexMembership = pgTable(
	'index_membership',
	{
		id: serial('id').primaryKey(),
		instrumentId: integer('instrument_id')
			.notNull()
			.references(() => instrument.id),
		indexName: text('index_name').notNull().references(() => universe.id),
		snapshotDate: date('snapshot_date'),
		observedAt: timestamp('observed_at', { withTimezone: true }),
		evidence: jsonb('evidence').$type<Record<string, unknown>>(),
		validFrom: date('valid_from').notNull(),
		validTo: date('valid_to')
	},
	(t) => [index('index_membership_instrument_idx').on(t.instrumentId, t.indexName)]
);

/** Versioned raw prices. Corrections never rewrite evidence used by a run. */
export const eodPrice = pgTable('eod_price', {
	id: serial('id').primaryKey(),
	listingId: integer('listing_id').notNull().references(() => listing.id),
	tradeDate: date('trade_date').notNull(),
	open: numeric('open'), high: numeric('high'), low: numeric('low'),
	close: numeric('close').notNull(),
	volume: bigint('volume', { mode: 'number' }),
	currency: text('currency').notNull(),
	source: text('source').notNull(),
	feed: text('feed').notNull(),
	adjustment: text('adjustment').notNull().default('raw'),
	sourceRecordId: text('source_record_id').notNull().unique(),
	observedAt: timestamp('observed_at', { withTimezone: true }),
	evidence: jsonb('evidence').$type<Record<string, unknown>>()
}, (t) => [index('eod_price_listing_date_idx').on(t.listingId, t.tradeDate), index('eod_price_trade_date_idx').on(t.tradeDate)]);

export const corporateAction = pgTable('corporate_action', {
	id: serial('id').primaryKey(),
	instrumentId: integer('instrument_id').notNull().references(() => instrument.id),
	source: text('source').notNull(),
	externalId: text('external_id').notNull(),
	type: text('type').notNull(),
	exDate: date('ex_date').notNull(),
	ratio: numeric('ratio'), amount: numeric('amount'), currency: text('currency'),
	observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
	sourceRecordId: text('source_record_id').notNull().unique(),
	evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
	qualification: text('qualification').notNull(),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({})
}, (t) => [index('corporate_action_instrument_idx').on(t.instrumentId, t.exDate)]);

export const fxRate = pgTable('fx_rate', {
	date: date('date').notNull(), currency: text('currency').notNull(),
	unitsPerEur: numeric('units_per_eur').notNull(),
	observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
	evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull()
}, (t) => [primaryKey({ columns: [t.date, t.currency, t.observedAt] })]);

/**
 * Long-format fundamentals. `metric` uses the fixed vocabulary in
 * `fundamentals/metrics.ts`; ratios (P/E) are derived in the signal engine,
 * never stored. `publishedDate` is the point-in-time guard (no lookahead).
 */
export const fundamental = pgTable(
	'fundamental',
	{
		id: serial('id').primaryKey(),
		issuerId: integer('issuer_id')
			.notNull()
			.references(() => issuer.id),
		instrumentId: integer('instrument_id').references(() => instrument.id),
		metric: text('metric').notNull(),
		value: numeric('value').notNull(),
		currency: text('currency'),
		periodStart: date('period_start'),
		unit: text('unit'),
		reportingBasis: text('reporting_basis'),
		sourceRecordId: text('source_record_id'),
		filingId: integer('filing_id').references(() => sourceFiling.id),
		publishedAt: timestamp('published_at', { withTimezone: true }),
		observedAt: timestamp('observed_at', { withTimezone: true }),
		metadata: jsonb('metadata').$type<Record<string, unknown>>(),
		qualification: text('qualification').notNull().default('qualified'),
		qualificationReason: text('qualification_reason'),
		periodType: text('period_type').notNull().default('LATEST'),
		periodEnd: date('period_end').notNull(),
		publishedDate: date('published_date').notNull(),
		source: fundamentalSourceEnum('source').notNull()
	},
	(t) => [
		index('fundamental_lookup_idx').on(t.issuerId, t.metric, t.periodEnd),
		uniqueIndex('fundamental_source_record_idx').on(t.source, t.sourceRecordId)
	]
);

/** Directors' dealing (Art. 19 MAR) from BaFin. Unmatched issuers keep issuerId null. */
export const insiderTransaction = pgTable(
	'insider_transaction',
	{
		id: serial('id').primaryKey(),
		source: text('source').notNull().default('bafin'),
		sourceRecordId: text('source_record_id'),
		filingId: integer('filing_id').references(() => sourceFiling.id),
		publishedAt: timestamp('published_at', { withTimezone: true }),
		observedAt: timestamp('observed_at', { withTimezone: true }),
		amendmentStatus: text('amendment_status'),
		qualification: text('qualification').notNull().default('qualified'),
		qualificationReason: text('qualification_reason'),
		issuerId: integer('issuer_id').references(() => issuer.id),
		isin: text('isin'),
		instrumentId: integer('instrument_id').references(() => instrument.id),
		economicKey: text('economic_key'),
		issuerNameRaw: text('issuer_name_raw').notNull(),
		partyName: text('party_name'),
		partyRole: partyRoleEnum('party_role').notNull().default('other'),
		side: sideEnum('side').notNull(),
		instrumentType: text('instrument_type'),
		price: numeric('price'),
		volume: numeric('volume'),
		amount: numeric('amount'),
		currency: text('currency'),
		transactionDate: date('transaction_date').notNull(),
		publishedDate: date('published_date').notNull(),
		venue: text('venue'),
		naturalKeyHash: text('natural_key_hash').notNull().unique(),
		raw: jsonb('raw')
	},
	(t) => [
		index('insider_issuer_idx').on(t.issuerId, t.transactionDate),
		index('insider_published_idx').on(t.publishedDate)
	]
);

/**
 * Net short position disclosure (EU SSR 236/2012 Art. 6) from the Bundesanzeiger
 * "Netto-Leerverkaufspositionen" register. One row is a change *event*, not a
 * daily snapshot.
 *
 * Only positions >= 0.5% are published. A position falling below that threshold
 * is published once more with the sub-threshold value and then leaves the open
 * register, so a row with positionPct < 0.5 is an implicit close. The open set
 * at date D is the latest row per (holder, issuer) with positionDate <= D, kept
 * only when positionPct >= 0.5 — that derivation belongs to the signal layer,
 * never here. A holder may legitimately publish two different percentages on the
 * same date (multiple threshold crossings).
 *
 * Unmatched issuers keep issuerId null (never dropped), like insiderTransaction.
 */
export const shortPosition = pgTable(
	'short_position',
	{
		id: serial('id').primaryKey(),
		source: text('source').notNull(),
		issuerId: integer('issuer_id').references(() => issuer.id),
		isin: text('isin'),
		issuerNameRaw: text('issuer_name_raw').notNull(),
		holderNameRaw: text('holder_name_raw').notNull(),
		/** Percent of issued share capital as published ("0,63" → 0.63). */
		positionPct: numeric('position_pct').notNull(),
		/** Date the position was reached/changed — the point-in-time guard. */
		positionDate: date('position_date').notNull(),
		naturalKeyHash: text('natural_key_hash').notNull().unique(),
		raw: jsonb('raw')
	},
	(t) => [
		index('short_position_issuer_idx').on(t.issuerId, t.positionDate),
		index('short_position_date_idx').on(t.positionDate),
		// supports a later holder-normalization join without touching ingestion
		index('short_position_holder_idx').on(t.holderNameRaw)
	]
);

/**
 * Company-news headlines, multi-source (BF instrument_news now, EQS later).
 * `publishedDate` is the point-in-time guard (no lookahead); `externalId` is
 * the source-native id so full bodies stay fetchable later. Unmatched issuers
 * from future sources keep null FKs (never dropped), like insider_transaction.
 */
export const newsItem = pgTable(
	'news_item',
	{
		id: serial('id').primaryKey(),
		filingId: integer('filing_id').references(() => sourceFiling.id),
		qualification: text('qualification').notNull().default('qualified'),
		qualificationReason: text('qualification_reason'),
		observedAt: timestamp('observed_at', { withTimezone: true }),
		source: text('source').notNull(),
		externalId: text('external_id').notNull(),
		instrumentId: integer('instrument_id').references(() => instrument.id),
		issuerId: integer('issuer_id').references(() => issuer.id),
		isin: text('isin'),
		headline: text('headline').notNull(),
		/** Undocumented vocabulary, free text; null when the source has no per-item type. */
		newsType: text('news_type'),
		publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
		/** Berlin-calendar day of publishedAt. */
		publishedDate: date('published_date').notNull(),
		naturalKeyHash: text('natural_key_hash').notNull().unique(),
		raw: jsonb('raw')
	},
	(t) => [
		index('news_item_issuer_idx').on(t.issuerId, t.publishedDate),
		index('news_item_published_idx').on(t.publishedDate),
		index('news_item_source_external_idx').on(t.source, t.externalId)
	]
);

/**
 * Registry row per curated signal definition; the definitions themselves
 * live in code (single source of truth). The physical table keeps its
 * legacy name `screen` — renaming a live table isn't worth the migration
 * risk, so only the code-level vocabulary changed.
 */
export const signalDefinition = pgTable('screen', {
	id: serial('id').primaryKey(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	version: integer('version').notNull().default(1),
	params: jsonb('params')
});

export const signalRun = pgTable('signal_run', {
	id: serial('id').primaryKey(),
	runDate: date('run_date').notNull().unique(),
	status: runStatusEnum('status').notNull().default('running'),
	universeSize: integer('universe_size'),
	cutoffAt: timestamp('cutoff_at', { withTimezone: true }),
	definitionVersions: jsonb('definition_versions').$type<Record<string, unknown>>(),
	startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
	finishedAt: timestamp('finished_at', { withTimezone: true })
});

export const signal = pgTable(
	'signal',
	{
		id: serial('id').primaryKey(),
		runId: integer('run_id')
			.notNull()
			.references(() => signalRun.id, { onDelete: 'cascade' }),
		// physical column keeps its legacy name (see signalDefinition above)
		definitionId: integer('screen_id')
			.notNull()
			.references(() => signalDefinition.id),
		instrumentId: integer('instrument_id')
			.notNull()
			.references(() => instrument.id),
		passedGate: boolean('passed_gate').notNull(),
		score: numeric('score'),
		percentile: numeric('percentile'),
		rank: integer('rank'),
		rationale: jsonb('rationale').notNull()
	},
	(t) => [uniqueIndex('signal_natural_key_idx').on(t.runId, t.definitionId, t.instrumentId)]
);

/**
 * Measured forward returns per surfaced signal — the feedback loop that
 * makes "interesting to acquire" falsifiable. One row per (signal, horizon),
 * filled by the `performance` job once the horizon has elapsed. The
 * benchmark is the equal-weight mean return over the run's whole universe.
 */
export const signalPerformance = pgTable(
	'signal_performance',
	{
		id: serial('id').primaryKey(),
		signalId: integer('signal_id')
			.notNull()
			.references(() => signal.id, { onDelete: 'cascade' }),
		horizonDays: integer('horizon_days').notNull(),
		currency: text('currency'),
		returnBasis: text('return_basis').notNull().default('legacy_unknown'),
		sourceRunId: integer('source_run_id').references(() => signalRun.id, { onDelete: 'cascade' }),
		baseDate: date('base_date').notNull(),
		baseClose: numeric('base_close').notNull(),
		fwdDate: date('fwd_date').notNull(),
		fwdClose: numeric('fwd_close').notNull(),
		fwdReturn: numeric('fwd_return').notNull(),
		universeFwdReturn: numeric('universe_fwd_return'),
		computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('signal_performance_natural_key_idx').on(t.signalId, t.horizonDays)]
);

/**
 * One wrapped copy of a user's data-encryption key per enrolled passkey
 * (see src/lib/crypto/README.md). Every column is ciphertext or public
 * metadata: the KEK that opens `wrappedDek` is derived client-side from a
 * WebAuthn PRF output and never reaches this server. Users are the SSO
 * accounts on core.timben, so `userUuid` has no local FK target. Wraps are
 * insert-only — overwriting one with a wrap of a different DEK would
 * silently orphan the user's data.
 */
export const userKeyWrap = pgTable(
	'user_key_wrap',
	{
		userUuid: text('user_uuid').notNull(),
		/** base64url WebAuthn credential id of the passkey whose PRF wraps the DEK. */
		credentialId: text('credential_id').notNull(),
		/** Key-derivation domain, e.g. 'assets-user-data'; part of the client contract. */
		purpose: text('purpose').notNull(),
		/** Envelope blob "v1.<iv>.<ct>" — opaque here beyond a format check. */
		wrappedDek: text('wrapped_dek').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userUuid, t.purpose, t.credentialId] })]
);

/**
 * Named client-side-encrypted document per user ('watchlist' today).
 * `version` is a compare-and-swap counter for optimistic concurrency across
 * tabs/devices; the server never sees the plaintext.
 */
export const userBlob = pgTable(
	'user_blob',
	{
		userUuid: text('user_uuid').notNull(),
		name: text('name').notNull(),
		/** Envelope blob "v1.<iv>.<ct>" — opaque here beyond a format check. */
		ciphertext: text('ciphertext').notNull(),
		version: integer('version').notNull().default(1),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userUuid, t.name] })]
);

/**
 * A user's ignored assets — deliberately plaintext, unlike the watchlist:
 * the MCP tools must be able to filter surfaced results server-side, which
 * ciphertext cannot support. `name` snapshots the display name at add-time
 * so the management list renders assets the current run didn't surface.
 * Users are SSO accounts on core.timben, so `userUuid` has no local FK.
 */
export const userIgnoredAsset = pgTable(
	'user_ignored_asset',
	{
		userUuid: text('user_uuid').notNull(),
		assetId: text('asset_id').notNull(),
		name: text('name').notNull(),
		addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userUuid, t.assetId] })]
);

/** Bookkeeping + incremental watermarks per ingestion job execution. */
export const ingestionRun = pgTable(
	'ingestion_run',
	{
		id: serial('id').primaryKey(),
		source: text('source').notNull(),
		job: text('job').notNull(),
		status: runStatusEnum('status').notNull().default('running'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		cursor: jsonb('cursor'),
		stats: jsonb('stats'),
		error: text('error')
	},
	(t) => [index('ingestion_run_job_idx').on(t.job, t.startedAt)]
);

/** Validated full open-register observations; historical disclosure rows remain separate. */
export const shortPositionSnapshot = pgTable('short_position_snapshot', {
	id: serial('id').primaryKey(),
	source: text('source').notNull(),
	capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
	rows: jsonb('rows').$type<ParsedShortPosition[]>().notNull(),
	diagnostics: jsonb('diagnostics').$type<SnapshotDiagnostics>().notNull()
}, (t) => [index('short_position_snapshot_captured_idx').on(t.capturedAt)]);

/** Immutable product inputs and presentation data selected for one published run. */
export const assetSnapshot = pgTable('asset_snapshot', {
	runId: integer('run_id').notNull().references(() => signalRun.id, { onDelete: 'cascade' }),
	instrumentId: integer('instrument_id').notNull().references(() => instrument.id),
	payload: jsonb('payload').notNull()
}, (t) => [primaryKey({ columns: [t.runId, t.instrumentId] })]);
