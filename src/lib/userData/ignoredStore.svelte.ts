/**
 * Client state for the user's ignored assets. Unlike the watchlist this
 * list is plaintext on the server (the MCP tools filter by it), so there is
 * no key ceremony: signed in means usable. The layout seeds the store from
 * SSR data so the first paint is already filtered; mutations apply
 * optimistically and revert on a failed request.
 */

import type { CardData } from '$lib/feed/types';
import type { ListEntry } from './types';

export type IgnoredStatus = 'signedOut' | 'loading' | 'ready' | 'error';

interface SsoUser {
	uuid: string;
}

const LIST_URL = '/api/ignored-assets';

export class IgnoredAssetsStore {
	status = $state<IgnoredStatus>('signedOut');
	entries = $state<ListEntry[]>([]);
	/** Mutation failure banner; the list stays usable while set. */
	syncError = $state<string | null>(null);

	readonly isins = $derived(new Set(this.entries.map((e) => e.isin)));
	readonly count = $derived(this.entries.length);

	private userUuid: string | null = null;

	constructor(initialUser: SsoUser | null, initialEntries: ListEntry[] | null) {
		this.userUuid = initialUser?.uuid ?? null;
		if (initialUser === null) {
			this.status = 'signedOut';
		} else if (initialEntries !== null) {
			this.entries = initialEntries;
			this.status = 'ready';
		} else {
			// SSR couldn't load the list (e.g. db hiccup); fetch client-side.
			this.status = 'loading';
		}
	}

	/** Call once from onMount: fetches the list when SSR didn't deliver it. */
	async init(): Promise<void> {
		if (this.status === 'loading') await this.refresh();
	}

	/**
	 * Reacts to the layout's `data` (sign-in state can change on invalidation).
	 * Same-account updates are ignored so a navigation's stale SSR payload
	 * cannot clobber optimistic local state.
	 */
	async setUser(user: SsoUser | null, entries: ListEntry[] | null): Promise<void> {
		if (user?.uuid === this.userUuid) return;
		this.userUuid = user?.uuid ?? null;
		this.syncError = null;
		if (user === null) {
			this.entries = [];
			this.status = 'signedOut';
			return;
		}
		if (entries !== null) {
			this.entries = entries;
			this.status = 'ready';
			return;
		}
		this.status = 'loading';
		await this.refresh();
	}

	/** Re-syncs to the server's copy; the recovery path for any failure. */
	async refresh(): Promise<void> {
		if (this.userUuid === null) return;
		try {
			const response = await fetch(LIST_URL);
			if (response.status === 401) {
				this.entries = [];
				this.status = 'signedOut';
				return;
			}
			if (!response.ok) throw new Error(`ignore list fetch failed (${response.status})`);
			const body = (await response.json()) as { entries: ListEntry[] };
			this.entries = body.entries;
			this.syncError = null;
			this.status = 'ready';
		} catch (error) {
			console.error('ignore list load failed', error);
			if (this.status !== 'ready') this.status = 'error';
			else this.syncError = 'Refreshing your ignore list failed.';
		}
	}

	/** Adds an asset (no-op when already ignored), snapshotting its display name. */
	add(card: Pick<CardData, 'isin' | 'name'>): void {
		if (this.status !== 'ready' || this.isins.has(card.isin)) return;
		const entry: ListEntry = {
			isin: card.isin,
			name: card.name,
			addedAt: new Date().toISOString()
		};
		this.entries.push(entry);
		void this.persistAdd(entry);
	}

	remove(isin: string): void {
		if (this.status !== 'ready') return;
		const entry = this.entries.find((e) => e.isin === isin);
		if (entry === undefined) return;
		this.entries = this.entries.filter((e) => e.isin !== isin);
		void this.persistRemove(entry);
	}

	/** Clears the failure banner and re-adopts the server's copy. */
	retrySync(): void {
		this.syncError = null;
		void this.refresh();
	}

	// ── internals ────────────────────────────────────────────────────────

	private async persistAdd(entry: ListEntry): Promise<void> {
		try {
			const response = await fetch(LIST_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ isin: entry.isin, name: entry.name })
			});
			if (!response.ok) throw new Error(`ignore add failed (${response.status})`);
			const body = (await response.json()) as { entry: ListEntry };
			// Adopt the authoritative row (server timestamps re-adds with the
			// original addedAt).
			this.entries = this.entries.map((e) => (e.isin === body.entry.isin ? body.entry : e));
		} catch (error) {
			console.error('ignore add failed', error);
			this.entries = this.entries.filter((e) => e.isin !== entry.isin);
			this.syncError = 'Saving your ignore list failed.';
		}
	}

	private async persistRemove(entry: ListEntry): Promise<void> {
		try {
			const response = await fetch(`${LIST_URL}/${encodeURIComponent(entry.isin)}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new Error(`ignore remove failed (${response.status})`);
		} catch (error) {
			console.error('ignore remove failed', error);
			this.entries = [...this.entries, entry];
			this.syncError = 'Saving your ignore list failed.';
		}
	}
}
