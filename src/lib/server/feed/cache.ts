import type { Db } from '../db/index.js';
import { desc, eq } from 'drizzle-orm';
import { signalRun } from '../db/schema.js';
import type { FeedPayload } from '../../feed/types.js';
import { loadFeed } from './queries.js';

/** A replacement run on the same date must invalidate saved evidence. */
async function latestRunKey(db: Db): Promise<string | null> {
	const [run] = await db.select({ id: signalRun.id, date: signalRun.runDate }).from(signalRun)
		.where(eq(signalRun.status, 'success')).orderBy(desc(signalRun.runDate)).limit(1);
	return run ? `${run.date}:${run.id}` : null;
}

/** How long a cached payload is served without re-checking the run date. */
const REVALIDATE_MS = 60_000;

interface CacheEntry {
	runKey: string | null;
	payload: FeedPayload | null;
	validatedAt: number;
}

/**
 * Single-entry cache for the feed payload. The feed is identical for every
 * user and only changes when the nightly pipeline lands a new signal_run, so
 * within the revalidation window requests cost zero DB work; after it, one
 * cheap latest-successful-run identity probe decides between reuse and a full rebuild.
 * In-process by design, like the auth caches — this app runs single-instance.
 */
export class FeedCache {
	private entry: CacheEntry | null = null;
	private pending: Promise<FeedPayload | null> | null = null;

	constructor(
		private readonly probeRunKey: (db: Db) => Promise<string | null> = latestRunKey,
		private readonly build: (db: Db) => Promise<FeedPayload | null> = loadFeed,
		private readonly now: () => number = Date.now
	) {}

	async get(db: Db): Promise<FeedPayload | null> {
		if (this.entry !== null && this.now() - this.entry.validatedAt < REVALIDATE_MS) {
			return this.entry.payload;
		}
		// Collapse concurrent misses into one revalidation/rebuild.
		this.pending ??= this.revalidate(db).finally(() => {
			this.pending = null;
		});
		return this.pending;
	}

	private async revalidate(db: Db): Promise<FeedPayload | null> {
		const runKey = await this.probeRunKey(db);
		if (this.entry !== null && runKey === this.entry.runKey) {
			this.entry.validatedAt = this.now();
			return this.entry.payload;
		}
		const payload = runKey === null ? null : await this.build(db);
		// Errors propagate to the caller and cache nothing.
		this.entry = { runKey, payload, validatedAt: this.now() };
		return payload;
	}
}

const feedCache = new FeedCache();

/** The cached feed payload (all views); null when no signal run exists yet. */
export function getFeedPayload(db: Db): Promise<FeedPayload | null> {
	return feedCache.get(db);
}
