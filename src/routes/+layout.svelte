<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { parseHandoffFragment, HANDOFF_OUTPUT_PARAM } from '$lib/crypto/handoff';
	import { provideUserData } from '$lib/userData/context';
	import { IgnoreConfirmController } from '$lib/userData/ignoreConfirm.svelte';
	import { IgnoredAssetsStore } from '$lib/userData/ignoredStore.svelte';
	import { UserDataKeyring } from '$lib/userData/keyring.svelte';
	import { EncryptedListStore } from '$lib/userData/listStore.svelte';
	import { WATCHLIST_BLOB_NAME } from '$lib/userData/types';
	import type { LayoutProps } from './$types.js';

	let { data, children }: LayoutProps = $props();

	// The constructors intentionally see only the initial data (SSR-correct
	// first paint); the $effects below track later changes.
	// svelte-ignore state_referenced_locally
	const keyring = new UserDataKeyring(data.user);
	const watchlist = new EncryptedListStore(keyring, {
		blobName: WATCHLIST_BLOB_NAME,
		label: 'watchlist'
	});
	// svelte-ignore state_referenced_locally
	const ignored = new IgnoredAssetsStore(data.user, data.ignoredAssets);
	const ignoreConfirm = new IgnoreConfirmController(watchlist, ignored);
	provideUserData({ keyring, watchlist, ignored, ignoreConfirm });

	$effect(() => {
		void keyring.setUser(data.user);
	});
	$effect(() => {
		void ignored.setUser(data.user, data.ignoredAssets);
	});

	// Cross-list invariant: an ignored asset never stays watchlisted. The
	// confirm flow already removes it when the watchlist is unlocked; this
	// covers the deferred case (watchlist locked at confirm time) and
	// cross-device races — real remove ops, so un-ignoring later does not
	// resurrect the watchlist entry.
	$effect(() => {
		if (watchlist.status !== 'ready' || ignored.status !== 'ready') return;
		for (const entry of watchlist.entries) {
			if (ignored.isins.has(entry.isin)) watchlist.remove(entry.isin);
		}
	});

	function stripHandoffFragment(): void {
		if (new URLSearchParams(window.location.hash.slice(1)).has(HANDOFF_OUTPUT_PARAM)) {
			// Keep SvelteKit's history.state intact so routing still works.
			history.replaceState(history.state, '', window.location.pathname + window.location.search);
		}
	}

	// The router re-stamps the URL when it finishes initializing, which can
	// resurrect a fragment stripped during onMount — so strip (again) once
	// navigation has settled.
	afterNavigate(stripHandoffFragment);

	onMount(() => {
		// An SSO sign-in may hand the passkey-derived key material to this app
		// in the URL fragment (never sent to any server). Strip it from the
		// address bar and history before anything else can observe it.
		const handoff = parseHandoffFragment(window.location.hash);
		stripHandoffFragment();
		void keyring.init(handoff);
		void ignored.init();

		// Encrypted saves are debounced; flush best-effort when the page is
		// backgrounded or torn down so a quick tab close doesn't lose a star.
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') keyring.flushAll();
		};
		const onPageHide = () => keyring.flushAll();
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', onPageHide);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', onPageHide);
		};
	});
</script>

{@render children()}
