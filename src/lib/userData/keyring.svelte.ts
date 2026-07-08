/**
 * Client state machine for the passkey-derived key that protects all user
 * data. Owns the key lifecycle (SSO handoff → IndexedDB cache → on-demand
 * PRF ceremony) for the one DEK shared by every encrypted document
 * (watchlist, ignore list — see src/lib/crypto/README.md for the key
 * model). The documents themselves live in EncryptedListStore instances
 * that register here; unlocking the keyring loads them all.
 *
 * Status flow:
 *
 *   signedOut ──sign-in──▶ restoring ──cache hit──▶ ready
 *                              │  cache miss              ▲
 *                              ▼                          │
 *                           locked ──unlock() tap──▶ unlocking
 *                              ▲                          │
 *              unsupported ◀───┴──── PRF not available ◀──┘
 *
 * The server only ever sees ciphertext; every decrypt/encrypt happens here.
 */

import { deriveKek, fromBase64url, generateDek, unwrapDek, wrapDek } from '$lib/crypto/envelope';
import type { PrfHandoff } from '$lib/crypto/handoff';
import { clearCachedDeks, getCachedDek, putCachedDek } from '$lib/crypto/keyCache';
import { PrfNotAvailableError, runPrfCeremony, webauthnSupported } from '$lib/crypto/prf';
import { USER_DATA_PURPOSE } from './types';

export type UserDataStatus =
	| 'signedOut'
	| 'unsupported'
	| 'restoring'
	| 'locked'
	| 'unlocking'
	| 'ready'
	| 'error';

interface SsoUser {
	uuid: string;
	elevated: boolean;
}

/** A per-blob document store the keyring loads/resets alongside the key. */
export interface EncryptedDocument {
	/** Decrypts and adopts the server copy (404 means empty) with this DEK. */
	load(dek: CryptoKey): Promise<void>;
	/** First-time setup: creates the empty encrypted document (tolerates a racing writer). */
	createEmpty(dek: CryptoKey): Promise<void>;
	/** Drops local plaintext state (sign-out, user change). */
	resetLocal(): void;
	/** Best-effort keepalive save of unsaved changes. */
	flush(): void;
}

const KEYWRAPS_URL = `/api/keywraps?purpose=${USER_DATA_PURPOSE}`;

export class UserDataKeyring {
	status = $state<UserDataStatus>('signedOut');
	/** Unlock-path failure message; only meaningful when status === 'error'. */
	errorMessage = $state<string | null>(null);
	/**
	 * Set when the session's passkey isn't enrolled for the DEK yet (it signed
	 * in via SSO but another passkey owns the wraps) — drives the "enable this
	 * passkey" affordance.
	 */
	canEnrollCurrentPasskey = $state(false);

	private user: SsoUser | null = null;
	private dek: CryptoKey | null = null;
	private documents: EncryptedDocument[] = [];
	/** KEK + credential of an unenrolled passkey, kept until a ceremony can enroll it. */
	private pendingEnroll: { credentialId: string; kek: CryptoKey } | null = null;

	constructor(initialUser: SsoUser | null) {
		this.user = initialUser;
		this.status = initialUser === null ? 'signedOut' : 'restoring';
	}

	/** Called from each EncryptedListStore constructor; order is not significant. */
	register(document: EncryptedDocument): void {
		this.documents.push(document);
	}

	/**
	 * Client-side boot: consume an SSO key handoff when one rode in on the
	 * URL fragment, otherwise try the cached key. Call once from onMount.
	 */
	async init(handoff: PrfHandoff | null): Promise<void> {
		if (this.user === null) {
			// A signed-out visit is the post-logout state; drop any keys a
			// previous session cached on this profile.
			await clearCachedDeks();
			return;
		}
		if (!webauthnSupported()) {
			this.status = 'unsupported';
			return;
		}
		if (handoff !== null && handoff.purpose === USER_DATA_PURPOSE) {
			await this.consumeHandoff(handoff);
			return;
		}
		await this.restoreFromCache();
	}

	/** Reacts to the layout's `data.user` (sign-in state can change on invalidation). */
	async setUser(user: SsoUser | null): Promise<void> {
		const previous = this.user;
		if (user?.uuid === previous?.uuid) {
			this.user = user;
			return;
		}
		this.user = user;
		this.reset();
		if (user === null) {
			this.status = 'signedOut';
			await clearCachedDeks();
			return;
		}
		// Different account than before: the cache must not leak across users.
		if (previous !== null) {
			await clearCachedDeks();
		}
		this.status = 'restoring';
		if (typeof window !== 'undefined') {
			await this.init(null);
		}
	}

	/**
	 * One-tap unlock via a PRF ceremony in this app — the fallback for every
	 * visit that didn't come through a fresh SSO ceremony. Must be called
	 * from a user gesture (credential prompts need transient activation).
	 */
	async unlock(): Promise<void> {
		if (this.user === null || this.status === 'unlocking') return;
		this.status = 'unlocking';
		this.errorMessage = null;
		try {
			const wraps = await this.fetchWraps();
			if (wraps === null) return; // fetchWraps already set the state

			// Restrict the passkey picker to enrolled credentials so the user
			// can't pick one whose PRF opens nothing. First-time setup has no
			// wraps yet — any discoverable passkey may found the keyring.
			const enrolled = this.pendingEnroll
				? wraps.filter((w) => w.credentialId !== this.pendingEnroll?.credentialId)
				: wraps;
			const ceremony = await runPrfCeremony({
				purpose: USER_DATA_PURPOSE,
				credentialIds: enrolled.map((w) => fromBase64url(w.credentialId))
			});
			const kek = await deriveKek(ceremony.output, USER_DATA_PURPOSE);
			ceremony.output.fill(0);

			if (wraps.length === 0) {
				await this.bootstrapKeyring(ceremony.credentialId, kek);
				return;
			}
			const wrap = wraps.find((w) => w.credentialId === ceremony.credentialId);
			if (wrap === undefined) {
				// Shouldn't happen with the allowlist above; recover gracefully.
				this.status = 'locked';
				return;
			}
			if (this.pendingEnroll !== null) {
				// Piggyback on this ceremony to enroll the session's passkey:
				// unwrap extractable once, wrap under the new KEK, publish.
				await this.enrollWith(wrap.wrappedDek, kek);
			}
			this.dek = await unwrapDek(wrap.wrappedDek, kek);
			await this.finishUnlock();
		} catch (error) {
			if (error instanceof PrfNotAvailableError) {
				this.status = 'unsupported';
			} else if (error instanceof DOMException && error.name === 'NotAllowedError') {
				// User dismissed the passkey prompt; not an error worth showing.
				this.status = 'locked';
			} else {
				console.error('user-data unlock failed', error);
				this.errorMessage = error instanceof Error ? error.message : 'Unlock failed';
				this.status = 'error';
			}
		}
	}

	/**
	 * Enrolls the session's not-yet-enrolled passkey while already unlocked
	 * (cache hit): one ceremony with an enrolled passkey re-derives an
	 * extractable DEK to wrap for the new credential.
	 */
	async enrollCurrentPasskey(): Promise<void> {
		if (this.pendingEnroll === null || this.user === null) return;
		try {
			const wraps = await this.fetchWraps();
			if (wraps === null || wraps.length === 0) return;
			const enrolled = wraps.filter((w) => w.credentialId !== this.pendingEnroll?.credentialId);
			const ceremony = await runPrfCeremony({
				purpose: USER_DATA_PURPOSE,
				credentialIds: enrolled.map((w) => fromBase64url(w.credentialId))
			});
			const kek = await deriveKek(ceremony.output, USER_DATA_PURPOSE);
			ceremony.output.fill(0);
			const wrap = wraps.find((w) => w.credentialId === ceremony.credentialId);
			if (wrap === undefined) return;
			await this.enrollWith(wrap.wrappedDek, kek);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'NotAllowedError') return;
			console.error('passkey enrollment failed', error);
		}
	}

	/** Best-effort flush of every document for pagehide/visibility-hidden. */
	flushAll(): void {
		for (const document of this.documents) document.flush();
	}

	// ── internals ────────────────────────────────────────────────────────

	private reset(): void {
		this.dek = null;
		this.pendingEnroll = null;
		this.canEnrollCurrentPasskey = false;
		this.errorMessage = null;
		for (const document of this.documents) document.resetLocal();
	}

	/** Silent unlock from a fresh SSO ceremony's PRF output (no user gesture needed). */
	private async consumeHandoff(handoff: PrfHandoff): Promise<void> {
		try {
			const kek = await deriveKek(handoff.prfOutput, handoff.purpose);
			handoff.prfOutput.fill(0);
			const wraps = await this.fetchWraps();
			if (wraps === null) return;

			if (wraps.length === 0) {
				await this.bootstrapKeyring(handoff.credentialId, kek);
				return;
			}
			const wrap = wraps.find((w) => w.credentialId === handoff.credentialId);
			if (wrap === undefined) {
				// Signed in with a passkey that isn't enrolled yet. Keep its KEK
				// so a single ceremony with an enrolled passkey can add it.
				this.pendingEnroll = { credentialId: handoff.credentialId, kek };
				this.canEnrollCurrentPasskey = true;
				await this.restoreFromCache();
				return;
			}
			this.dek = await unwrapDek(wrap.wrappedDek, kek);
			await this.finishUnlock();
		} catch (error) {
			// A handoff that doesn't unlock (e.g. wraps from a different
			// account's session) is not fatal — fall back to the normal paths.
			console.error('SSO key handoff not usable', error);
			await this.restoreFromCache();
		}
	}

	private async restoreFromCache(): Promise<void> {
		if (this.user === null) return;
		const cached = await getCachedDek(this.user.uuid, USER_DATA_PURPOSE);
		if (cached === null) {
			this.status = 'locked';
			return;
		}
		this.dek = cached;
		try {
			await this.loadDocuments();
			this.status = 'ready';
		} catch (error) {
			// Cached key no longer opens the data (e.g. keyring was rebuilt).
			console.error('cached user-data key rejected', error);
			this.dek = null;
			for (const document of this.documents) document.resetLocal();
			await clearCachedDeks();
			this.status = 'locked';
		}
	}

	/**
	 * First-time setup: mint the DEK, publish its wrap for this credential,
	 * and create the (empty) encrypted documents. Loses every race politely:
	 * if another tab published a wrap first, adopt that DEK instead.
	 */
	private async bootstrapKeyring(credentialId: string, kek: CryptoKey): Promise<void> {
		const freshDek = await generateDek(); // extractable, function-scoped
		const wrappedDek = await wrapDek(freshDek, kek);
		const response = await fetch('/api/keywraps', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ purpose: USER_DATA_PURPOSE, credentialId, wrappedDek })
		});
		if (!response.ok) {
			throw new Error(`keywrap publish failed (${response.status})`);
		}
		const result = (await response.json()) as { created: boolean; wrappedDek?: string };
		// Always continue with a non-extractable key: ours re-unwrapped, or
		// the concurrent winner's.
		const authoritativeWrap = result.created ? wrappedDek : (result.wrappedDek ?? wrappedDek);
		this.dek = await unwrapDek(authoritativeWrap, kek);

		if (result.created) {
			for (const document of this.documents) {
				await document.createEmpty(this.dek);
			}
		}
		await this.finishUnlock();
	}

	/** Publishes a wrap of the DEK for the pending (unenrolled) credential. */
	private async enrollWith(existingWrap: string, unlockingKek: CryptoKey): Promise<void> {
		const enroll = this.pendingEnroll;
		if (enroll === null) return;
		const extractableDek = await unwrapDek(existingWrap, unlockingKek, { extractable: true });
		const newWrap = await wrapDek(extractableDek, enroll.kek);
		const response = await fetch('/api/keywraps', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				purpose: USER_DATA_PURPOSE,
				credentialId: enroll.credentialId,
				wrappedDek: newWrap
			})
		});
		if (response.ok) {
			this.pendingEnroll = null;
			this.canEnrollCurrentPasskey = false;
		}
	}

	private async finishUnlock(): Promise<void> {
		if (this.user === null || this.dek === null) return;
		await this.loadDocuments();
		await putCachedDek(this.user.uuid, USER_DATA_PURPOSE, this.dek);
		this.status = 'ready';
	}

	private async loadDocuments(): Promise<void> {
		if (this.dek === null) return;
		const dek = this.dek;
		await Promise.all(this.documents.map((document) => document.load(dek)));
	}

	private async fetchWraps(): Promise<{ credentialId: string; wrappedDek: string }[] | null> {
		const response = await fetch(KEYWRAPS_URL);
		if (response.status === 401) {
			this.reset();
			this.status = 'signedOut';
			return null;
		}
		if (!response.ok) {
			throw new Error(`keywrap fetch failed (${response.status})`);
		}
		const body = (await response.json()) as {
			wraps: { credentialId: string; wrappedDek: string }[];
		};
		return body.wraps;
	}
}
