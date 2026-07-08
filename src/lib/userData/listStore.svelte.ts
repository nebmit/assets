/**
 * One encrypted asset list (watchlist, ignore list): the decrypted entries
 * plus debounced encrypted persistence with optimistic concurrency against
 * /api/user-blobs/<name>. Key custody lives in UserDataKeyring — this store
 * receives the shared DEK via load() when the keyring unlocks, and its
 * status/unlock surface delegates there so components can treat a list as
 * one self-contained thing.
 */

import { decryptJson, encryptJson } from '$lib/crypto/envelope';
import type { CardData } from '$lib/feed/types';
import type { EncryptedDocument, UserDataKeyring, UserDataStatus } from './keyring.svelte';
import { applyOps } from './merge';
import { coerceDoc, emptyDoc, type ListDocV1, type ListEntry, type ListOp } from './types';

const SAVE_DEBOUNCE_MS = 800;

export interface ListStoreOptions {
	/** Server-side document name under /api/user-blobs/. */
	blobName: string;
	/** Human phrasing for sync-error banners, e.g. "watchlist" or "ignore list". */
	label: string;
}

export class EncryptedListStore implements EncryptedDocument {
	entries = $state<ListEntry[]>([]);
	/** Persistence failure banner; the list stays usable while set. */
	syncError = $state<string | null>(null);

	readonly isins = $derived(new Set(this.entries.map((e) => e.isin)));
	readonly count = $derived(this.entries.length);

	private readonly keyring: UserDataKeyring;
	private readonly blobUrl: string;
	private readonly label: string;
	private dek: CryptoKey | null = null;
	private version = 0;
	private pendingOps: ListOp[] = [];
	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private saving = false;

	constructor(keyring: UserDataKeyring, options: ListStoreOptions) {
		this.keyring = keyring;
		this.blobUrl = `/api/user-blobs/${options.blobName}`;
		this.label = options.label;
		keyring.register(this);
	}

	// ── keyring state, surfaced so components can treat the list as one unit ──

	get status(): UserDataStatus {
		return this.keyring.status;
	}

	get errorMessage(): string | null {
		return this.keyring.errorMessage;
	}

	get canEnrollCurrentPasskey(): boolean {
		return this.keyring.canEnrollCurrentPasskey;
	}

	unlock(): Promise<void> {
		return this.keyring.unlock();
	}

	enrollCurrentPasskey(): Promise<void> {
		return this.keyring.enrollCurrentPasskey();
	}

	// ── mutations ────────────────────────────────────────────────────────

	/** Adds an asset (no-op when already listed), snapshotting its display name. */
	add(card: Pick<CardData, 'isin' | 'name'>): void {
		if (this.status !== 'ready' || this.isins.has(card.isin)) return;
		const entry: ListEntry = {
			isin: card.isin,
			name: card.name,
			addedAt: new Date().toISOString()
		};
		this.entries.push(entry);
		this.pendingOps.push({ type: 'add', entry });
		this.scheduleSave();
	}

	remove(isin: string): void {
		if (this.status !== 'ready' || !this.isins.has(isin)) return;
		this.entries = this.entries.filter((e) => e.isin !== isin);
		this.pendingOps.push({ type: 'remove', isin });
		this.scheduleSave();
	}

	/**
	 * Star-button entry point: toggles when unlocked; when locked, runs the
	 * one-tap unlock first and then completes the intended toggle.
	 */
	async toggle(card: Pick<CardData, 'isin' | 'name'>): Promise<void> {
		if (this.status === 'locked' || this.status === 'error') {
			const wanted = !this.isins.has(card.isin);
			await this.unlock();
			// TS still sees the pre-await narrowing; unlock() may have moved us.
			if ((this.status as UserDataStatus) !== 'ready') return;
			if (wanted === this.isins.has(card.isin)) return; // another writer got there
			if (wanted) this.add(card);
			else this.remove(card.isin);
			return;
		}
		if (this.status !== 'ready') return;
		if (this.isins.has(card.isin)) this.remove(card.isin);
		else this.add(card);
	}

	/**
	 * Keeps stored name snapshots honest: when a listed asset shows up in the
	 * feed under a different display name, adopt the fresh one.
	 */
	refreshSnapshots(cards: Pick<CardData, 'isin' | 'name'>[]): void {
		if (this.status !== 'ready') return;
		const names = new Map(cards.map((c) => [c.isin, c.name]));
		let changed = false;
		for (const entry of this.entries) {
			const fresh = names.get(entry.isin);
			if (fresh !== undefined && fresh !== entry.name) {
				entry.name = fresh;
				this.pendingOps.push({ type: 'add', entry: { ...entry } });
				changed = true;
			}
		}
		if (changed) this.scheduleSave();
	}

	/** Best-effort flush for pagehide/visibility-hidden; uses keepalive fetch. */
	flush(): void {
		if (this.pendingOps.length === 0 || this.dek === null) return;
		clearTimeout(this.saveTimer);
		void this.save({ keepalive: true });
	}

	/** Retry button for persistence failures. */
	retrySync(): void {
		this.syncError = null;
		this.scheduleSave(0);
	}

	// ── keyring-facing document lifecycle ────────────────────────────────

	async load(dek: CryptoKey): Promise<void> {
		this.dek = dek;
		const response = await fetch(this.blobUrl);
		if (response.status === 404) {
			this.entries = [];
			this.version = 0;
			return;
		}
		if (!response.ok) {
			throw new Error(`${this.label} fetch failed (${response.status})`);
		}
		const body = (await response.json()) as { ciphertext: string; version: number };
		const doc = coerceDoc(await decryptJson(dek, body.ciphertext));
		this.entries = doc.entries;
		this.version = body.version;
	}

	async createEmpty(dek: CryptoKey): Promise<void> {
		const ciphertext = await encryptJson(dek, emptyDoc());
		const put = await fetch(this.blobUrl, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ciphertext, baseVersion: 0 })
		});
		if (!put.ok && put.status !== 409) {
			throw new Error(`${this.label} create failed (${put.status})`);
		}
		// On 409 someone else wrote first; the subsequent load adopts their copy.
	}

	resetLocal(): void {
		clearTimeout(this.saveTimer);
		this.dek = null;
		this.entries = [];
		this.version = 0;
		this.pendingOps = [];
		this.syncError = null;
	}

	// ── internals ────────────────────────────────────────────────────────

	private scheduleSave(delay = SAVE_DEBOUNCE_MS): void {
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.save(), delay);
	}

	private docFromState(): ListDocV1 {
		return { v: 1, entries: this.entries.map((e) => ({ ...e })) };
	}

	private async save(options: { keepalive?: boolean } = {}, retrying = false): Promise<void> {
		if (this.dek === null || this.saving || this.pendingOps.length === 0) return;
		this.saving = true;
		const opsInFlight = this.pendingOps.length;
		try {
			const ciphertext = await encryptJson(this.dek, this.docFromState());
			const response = await fetch(this.blobUrl, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ciphertext, baseVersion: this.version }),
				keepalive: options.keepalive === true
			});
			if (response.ok) {
				this.version = ((await response.json()) as { version: number }).version;
				this.pendingOps.splice(0, opsInFlight);
				this.syncError = null;
			} else if (response.status === 409 && !retrying) {
				// Another writer won: merge our pending intent over their
				// document and retry once against the new version.
				const body = (await response.json()) as { ciphertext: string; version: number };
				const serverDoc = coerceDoc(await decryptJson(this.dek, body.ciphertext));
				const merged = applyOps(serverDoc, this.pendingOps);
				this.entries = merged.entries;
				this.version = body.version;
				this.saving = false;
				await this.save(options, true);
				return;
			} else if (response.status === 401) {
				this.syncError = 'Your session expired — sign in again to keep saving.';
			} else {
				this.syncError = `Saving your ${this.label} failed.`;
			}
		} catch (error) {
			console.error(`${this.label} save failed`, error);
			this.syncError = `Saving your ${this.label} failed.`;
		} finally {
			this.saving = false;
		}
		if (this.pendingOps.length > 0 && this.syncError === null) {
			// Ops arrived while the request was in flight.
			this.scheduleSave();
		}
	}
}
