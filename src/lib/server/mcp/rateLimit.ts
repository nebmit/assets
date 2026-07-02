export interface RateLimitDecision {
	allowed: boolean;
	/** Seconds until the caller's window resets; 0 when allowed. */
	retryAfterSeconds: number;
}

/**
 * Fixed-window request counter, keyed by caller (client IP). In-process
 * state matches the single adapter-node instance. Memory is bounded: expired
 * windows are pruned on demand and the map is capped, evicting the
 * least-recently-seen keys, so key-spraying cannot grow it unboundedly.
 */
export class RateLimiter {
	private windows = new Map<string, { windowStart: number; count: number }>();

	constructor(
		private readonly maxRequests: number,
		private readonly windowMs: number,
		private readonly now: () => number = Date.now,
		private readonly maxKeys = 10_000
	) {}

	check(key: string): RateLimitDecision {
		const now = this.now();
		let entry = this.windows.get(key);
		if (entry === undefined || now - entry.windowStart >= this.windowMs) {
			if (entry === undefined) this.evict(now);
			entry = { windowStart: now, count: 0 };
		}
		entry.count += 1;
		// re-insert so Map order is least-recently-seen first for eviction
		this.windows.delete(key);
		this.windows.set(key, entry);

		if (entry.count > this.maxRequests) {
			const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowStart + this.windowMs - now) / 1000));
			return { allowed: false, retryAfterSeconds };
		}
		return { allowed: true, retryAfterSeconds: 0 };
	}

	private evict(now: number): void {
		if (this.windows.size < this.maxKeys) return;
		for (const [key, entry] of this.windows) {
			if (now - entry.windowStart >= this.windowMs) this.windows.delete(key);
		}
		while (this.windows.size >= this.maxKeys) {
			const oldest = this.windows.keys().next().value;
			if (oldest === undefined) return;
			this.windows.delete(oldest);
		}
	}
}
