/**
 * Small in-process TTL cache with LRU eviction, used to keep token and
 * session introspection round-trips off the hot path. Keys must never be
 * raw secrets — callers hash tokens before using them as keys.
 */
export class TtlCache<V> {
	private entries = new Map<string, { value: V; expires: number }>();

	constructor(
		private readonly maxEntries: number,
		private readonly now: () => number = Date.now
	) {}

	get(key: string): V | undefined {
		const entry = this.entries.get(key);
		if (entry === undefined) return undefined;
		if (this.now() >= entry.expires) {
			this.entries.delete(key);
			return undefined;
		}
		// re-insert so Map order is least-recently-seen first for eviction
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.value;
	}

	set(key: string, value: V, ttlMs: number): void {
		if (this.entries.has(key)) {
			this.entries.delete(key);
		} else if (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) this.entries.delete(oldest);
		}
		this.entries.set(key, { value, expires: this.now() + ttlMs });
	}

	get size(): number {
		return this.entries.size;
	}
}
