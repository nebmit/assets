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
	text,
	timestamp,
	uniqueIndex,
	index
} from 'drizzle-orm/pg-core';

export const marketIndexEnum = pgEnum('market_index', ['DAX', 'MDAX', 'SDAX']);
// 'other' covers BaFin's "Sonstiges" (share awards, option exercises, …)
export const sideEnum = pgEnum('transaction_side', ['buy', 'sell', 'other']);
export const partyRoleEnum = pgEnum('party_role', [
	'executive_board',
	'supervisory_board',
	'related_party',
	'other'
]);
export const fundamentalSourceEnum = pgEnum('fundamental_source', ['boerse_frankfurt', 'esef']);
export const runStatusEnum = pgEnum('run_status', ['running', 'success', 'error']);

/** Legal entity that issues instruments and files reports (1:N with instrument). */
export const issuer = pgTable(
	'issuer',
	{
		id: serial('id').primaryKey(),
		name: text('name').notNull(),
		lei: text('lei'),
		sector: text('sector'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('issuer_lei_idx').on(t.lei)]
);

/** Tradeable equity instrument. */
export const instrument = pgTable(
	'instrument',
	{
		id: serial('id').primaryKey(),
		issuerId: integer('issuer_id')
			.notNull()
			.references(() => issuer.id),
		isin: text('isin').notNull().unique(),
		wkn: text('wkn'),
		ticker: text('ticker'),
		market: text('market').notNull().default('XETR'),
		currency: text('currency'),
		/** Earliest date successfully requested from the XETR price-history endpoint. */
		priceHistoryCoveredFrom: date('price_history_covered_from'),
		firstSeen: date('first_seen').notNull(),
		lastSeen: date('last_seen').notNull()
	},
	(t) => [index('instrument_issuer_idx').on(t.issuerId)]
);

/** Interval-form index constituency, maintained by daily diff (point-in-time queryable). */
export const indexMembership = pgTable(
	'index_membership',
	{
		id: serial('id').primaryKey(),
		instrumentId: integer('instrument_id')
			.notNull()
			.references(() => instrument.id),
		indexName: marketIndexEnum('index_name').notNull(),
		validFrom: date('valid_from').notNull(),
		validTo: date('valid_to')
	},
	(t) => [index('index_membership_instrument_idx').on(t.instrumentId, t.indexName)]
);

export const eodPrice = pgTable(
	'eod_price',
	{
		instrumentId: integer('instrument_id')
			.notNull()
			.references(() => instrument.id),
		tradeDate: date('trade_date').notNull(),
		open: numeric('open'),
		high: numeric('high'),
		low: numeric('low'),
		close: numeric('close').notNull(),
		volume: bigint('volume', { mode: 'number' }),
		currency: text('currency'),
		source: text('source').notNull().default('boerse_frankfurt')
	},
	(t) => [
		primaryKey({ columns: [t.instrumentId, t.tradeDate] }),
		// The signal engine scans date windows across all instruments
		// (context.ts, performance.ts); the PK leads with instrument_id and
		// can't serve those.
		index('eod_price_trade_date_idx').on(t.tradeDate)
	]
);

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
		metric: text('metric').notNull(),
		value: numeric('value').notNull(),
		currency: text('currency'),
		periodType: text('period_type').notNull().default('LATEST'),
		periodEnd: date('period_end').notNull(),
		publishedDate: date('published_date').notNull(),
		source: fundamentalSourceEnum('source').notNull()
	},
	(t) => [
		uniqueIndex('fundamental_natural_key_idx').on(t.issuerId, t.metric, t.periodEnd, t.source)
	]
);

/** Directors' dealing (Art. 19 MAR) from BaFin. Unmatched issuers keep issuerId null. */
export const insiderTransaction = pgTable(
	'insider_transaction',
	{
		id: serial('id').primaryKey(),
		issuerId: integer('issuer_id').references(() => issuer.id),
		isin: text('isin'),
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
 * Company-news headlines, multi-source (BF instrument_news now, EQS later).
 * `publishedDate` is the point-in-time guard (no lookahead); `externalId` is
 * the source-native id so full bodies stay fetchable later. Unmatched issuers
 * from future sources keep null FKs (never dropped), like insider_transaction.
 */
export const newsItem = pgTable(
	'news_item',
	{
		id: serial('id').primaryKey(),
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
		isin: text('isin').notNull(),
		name: text('name').notNull(),
		addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userUuid, t.isin] })]
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
