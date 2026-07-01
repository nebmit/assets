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
export const sideEnum = pgEnum('transaction_side', ['buy', 'sell']);
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
	(t) => [primaryKey({ columns: [t.instrumentId, t.tradeDate] })]
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

/** Registry row per curated screen; definitions live in code (single source of truth). */
export const screen = pgTable('screen', {
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
		screenId: integer('screen_id')
			.notNull()
			.references(() => screen.id),
		instrumentId: integer('instrument_id')
			.notNull()
			.references(() => instrument.id),
		passedGate: boolean('passed_gate').notNull(),
		score: numeric('score'),
		percentile: numeric('percentile'),
		rank: integer('rank'),
		rationale: jsonb('rationale').notNull()
	},
	(t) => [uniqueIndex('signal_natural_key_idx').on(t.runId, t.screenId, t.instrumentId)]
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
