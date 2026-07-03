/** The slice of the MCP transport a stored session needs. */
export interface SessionTransport {
	handleRequest(req: Request): Promise<Response>;
	close(): Promise<void>;
}

interface SessionEntry {
	transport: SessionTransport;
	userUuid: string;
	lastSeen: number;
}

/** The live session as seen by the route: transport plus the bound account. */
export interface Session {
	transport: SessionTransport;
	userUuid: string;
}

/**
 * In-memory store for stateful MCP sessions (Mcp-Session-Id → transport).
 * Sessions are minted by the transport on `initialize` and are bound to the
 * account whose token authenticated that initialize; subsequent requests
 * must present a token for the same account. Memory is bounded: idle
 * sessions expire lazily and the map is capped, evicting the
 * least-recently-seen session (its transport is closed), so session minting
 * cannot grow it unboundedly. State is per-process, matching the single
 * adapter-node instance.
 */
export class SessionStore {
	private sessions = new Map<string, SessionEntry>();

	constructor(
		private readonly idleTtlMs: number,
		private readonly maxSessions: number,
		private readonly now: () => number = Date.now
	) {}

	/** Returns the live session and refreshes its idle timer. */
	get(id: string): Session | undefined {
		const entry = this.sessions.get(id);
		if (entry === undefined) return undefined;
		const now = this.now();
		if (now - entry.lastSeen >= this.idleTtlMs) {
			this.drop(id);
			return undefined;
		}
		entry.lastSeen = now;
		// re-insert so Map order is least-recently-seen first for eviction
		this.sessions.delete(id);
		this.sessions.set(id, entry);
		return { transport: entry.transport, userUuid: entry.userUuid };
	}

	set(id: string, transport: SessionTransport, userUuid: string): void {
		const now = this.now();
		for (const [key, entry] of this.sessions) {
			if (now - entry.lastSeen >= this.idleTtlMs) this.drop(key);
		}
		while (this.sessions.size >= this.maxSessions) {
			const oldest = this.sessions.keys().next().value;
			if (oldest === undefined) break;
			this.drop(oldest);
		}
		this.sessions.set(id, { transport, userUuid, lastSeen: now });
	}

	/** Forget a session the transport already closed itself (DELETE). */
	delete(id: string): void {
		this.sessions.delete(id);
	}

	get size(): number {
		return this.sessions.size;
	}

	private drop(id: string): void {
		const entry = this.sessions.get(id);
		this.sessions.delete(id);
		entry?.transport.close().catch((err) => console.error(`mcp: closing session ${id} failed`, err));
	}
}
