import type { Db } from '../db/index.js';
import { latestRunDate } from '../signals/report.js';
import type { FeedPayload } from '../../feed/types.js';
import { loadFeed } from './queries.js';

/** How long a cached payload is served without re-checking the run date. */
const REVALIDATE_MS = 60_000;

interface CacheEntry {
	runDate: string | null;
	payload: FeedPayload | null;
	validatedAt: number;
}

/**
 * Single-entry cache for the feed payload. The feed is identical for every
 * user and only changes when the nightly pipeline lands a new signal_run, so
 * within the revalidation window requests cost zero DB work; after it, one
 * cheap `max(run_date)` probe decides between reuse and a full rebuild.
 * In-process by design, like the auth caches — this app runs single-instance.
 */
export class FeedCache {
	private entry: CacheEntry | null = null;
	private pending: Promise<FeedPayload | null> | null = null;

	constructor(
		private readonly probeRunDate: (db: Db) => Promise<string | null> = latestRunDate,
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
		const runDate = await this.probeRunDate(db);
		if (this.entry !== null && runDate === this.entry.runDate) {
			this.entry.validatedAt = this.now();
			return this.entry.payload;
		}
		const payload = runDate === null ? null : await this.build(db);
		// Errors propagate to the caller and cache nothing.
		this.entry = { runDate, payload, validatedAt: this.now() };
		return payload;
	}
}

const feedCache = new FeedCache();

/** The cached feed payload (all views); null when no signal run exists yet. */
export function getFeedPayload(db: Db): Promise<FeedPayload | null> {
	return feedCache.get(db);
}
