<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { formatAsOf } from "$lib/format.js";
	import { matchesSearch } from "$lib/feed/filter.js";
	import { DEFAULT_VIEW_SLUG, isFeedViewSlug } from "$lib/feed/views.js";
	import { USER_DATA_PURPOSE } from "$lib/userData/types.js";
	import Button from "$lib/components/ds/Button.svelte";
	import AssetCard from "$lib/components/feed/AssetCard.svelte";
	import EmptyState from "$lib/components/feed/EmptyState.svelte";
	import TopBar from "$lib/components/feed/TopBar.svelte";
	import WatchlistPanel from "$lib/components/watchlist/WatchlistPanel.svelte";
	import IgnoreConfirmDialog from "$lib/components/ignored/IgnoreConfirmDialog.svelte";
	import IgnoreSearchResults from "$lib/components/ignored/IgnoreSearchResults.svelte";
	import IgnoredPanel from "$lib/components/ignored/IgnoredPanel.svelte";
	import {
		getIgnoreConfirm,
		getIgnored,
		getWatchlist,
	} from "$lib/userData/context.js";
	import type { PageProps } from "./$types.js";

	let { data }: PageProps = $props();

	let search = $state("");

	const watchlist = getWatchlist();
	const ignored = getIgnored();
	const ignoreConfirm = getIgnoreConfirm();

	const payload = $derived(data.payload);
	/**
	 * The payload carries every view; switching is pure client state derived
	 * from the URL, so the ?view= links never hit the server.
	 */
	const viewSlug = $derived.by(() => {
		const value = page.url.searchParams.get("view");
		return isFeedViewSlug(value) ? value : DEFAULT_VIEW_SLUG;
	});
	/** Cards of the selected view — the overview grid renders these. */
	const cards = $derived(payload?.cardsByView[viewSlug] ?? []);
	/**
	 * Everything today's run surfaced, view-independent (the surfaced view is
	 * the union of fired signals). Derivations that describe "today's feed"
	 * rather than the selected view hang off this so they don't churn on
	 * view switches.
	 */
	const allCards = $derived(payload?.cardsByView[DEFAULT_VIEW_SLUG] ?? []);
	/**
	 * Every grid renders from this: the feed minus the ignored assets. The
	 * ignore set only exists client-side after decryption, so until the
	 * keyring is ready the full feed shows — the server cannot pre-filter
	 * what it cannot read.
	 */
	const visibleCards = $derived(
		ignored.status === "ready"
			? cards.filter((c) => !ignored.isins.has(c.isin))
			: cards,
	);
	const visibleAllCards = $derived(
		ignored.status === "ready"
			? allCards.filter((c) => !ignored.isins.has(c.isin))
			: allCards,
	);
	const filtered = $derived(
		visibleCards.filter((c) => matchesSearch(c, search)),
	);
	const searchTerm = $derived(search.trim());
	/** Freshest price date across today's feed; the run date is the fallback. */
	const asOfDate = $derived(
		allCards.reduce<string | null>(
			(latest, c) =>
				c.priceDate !== null &&
				(latest === null || c.priceDate > latest)
					? c.priceDate
					: latest,
			null,
		) ?? payload?.runDate,
	);

	const tab = $derived.by(() => {
		const value = page.url.searchParams.get("tab");
		return value === "watchlist" || value === "ignored"
			? value
			: "overview";
	});

	/** Watchlisted assets the current signal run surfaced, as full cards. */
	const watchedSurfaced = $derived(
		visibleAllCards.filter((c) => watchlist.isins.has(c.isin)),
	);
	const watchedFiltered = $derived(
		watchedSurfaced.filter((c) => matchesSearch(c, search)),
	);
	/** The management list honors the search box too (name or ISIN). */
	const panelEntries = $derived(
		searchTerm === ""
			? watchlist.entries
			: watchlist.entries.filter((e) => {
					const q = searchTerm.toLowerCase();
					return (
						e.name.toLowerCase().includes(q) ||
						e.isin.toLowerCase().includes(q)
					);
				}),
	);
	const surfacedIsins = $derived(new Set(allCards.map((c) => c.isin)));

	/** Ignored entries with display names freshened from today's feed. */
	const ignoredEntries = $derived.by(() => {
		const names = new Map(allCards.map((c) => [c.isin, c.name]));
		return ignored.entries.map((e) => ({
			...e,
			name: names.get(e.isin) ?? e.name,
		}));
	});
	/** The management list honors the search box too (name or ISIN). */
	const ignoredPanelEntries = $derived(
		searchTerm === ""
			? ignoredEntries
			: ignoredEntries.filter((e) => {
					const q = searchTerm.toLowerCase();
					return (
						e.name.toLowerCase().includes(q) ||
						e.isin.toLowerCase().includes(q)
					);
				}),
	);
	/** Surfaced, not-yet-ignored assets matching the search — the add candidates. */
	const ignoreCandidates = $derived(
		searchTerm === ""
			? []
			: visibleAllCards.filter((c) => matchesSearch(c, search)),
	);
	/** Surfaced assets the ignore list is actively hiding today. */
	const ignoredSurfacedCount = $derived(
		allCards.reduce((n, c) => (ignored.isins.has(c.isin) ? n + 1 : n), 0),
	);

	// Keep the encrypted name snapshots aligned with what the feed shows.
	$effect(() => {
		watchlist.refreshSnapshots(allCards);
	});

	function hrefWith(mutate: (params: URLSearchParams) => void): string {
		const params = new URLSearchParams(page.url.search);
		mutate(params);
		const qs = params.toString();
		return qs === "" ? page.url.pathname : `?${qs}`;
	}

	function viewHref(slug: string): string {
		return hrefWith((params) => params.set("view", slug));
	}

	function switchTab(value: string): void {
		void goto(
			hrefWith((params) => {
				if (value === "overview") params.delete("tab");
				else params.set("tab", value);
			}),
			{ keepFocus: true, noScroll: true },
		);
	}

	// Auth links carry the live URL as the return target. Built client-side
	// (page.url is SSR-populated too) so the layout load stays URL-independent
	// and doesn't re-query on view/tab switches.
	const returnUrl = $derived(
		new URL(page.url.pathname + page.url.search, data.resourceOrigin).href,
	);
	const authQuery = $derived(
		`?redirect_uri=${encodeURIComponent(returnUrl)}`,
	);
	// prf_purpose asks the SSO ceremony to evaluate the passkey PRF for this
	// app's encrypted user data and hand the output back in the redirect
	// fragment — see src/lib/crypto/README.md.
	const signInUrl = $derived(
		`${data.authOrigin}/auth${authQuery}&prf_purpose=${USER_DATA_PURPOSE}`,
	);
	const signOutUrl = $derived(`${data.authOrigin}/auth/logout${authQuery}`);
</script>

<svelte:head>
	<title>DAX / MDAX / SDAX · assets</title>
	<meta
		name="description"
		content="Surfaced assets across DAX, MDAX and SDAX — signal evidence, prices, valuation vs sector, insider dealings and regulatory news."
	/>
</svelte:head>

{#snippet viewNav()}
	{#if payload !== null && payload !== undefined}
		<nav
			class="inline-flex flex-wrap items-baseline gap-x-[7px] gap-y-1 font-sans text-xs"
			aria-label="View"
		>
			{#each payload.views as view, index (view.slug)}
				{@const active = view.slug === viewSlug}
				{#if index > 0}
					<span class="text-text-muted">/</span>
				{/if}
				<a
					href={viewHref(view.slug)}
					aria-current={active ? "page" : undefined}
					class="border-b pb-px whitespace-nowrap no-underline transition-colors duration-[120ms] hover:border-border-default hover:text-text-primary"
					class:border-border-strong={active}
					class:font-medium={active}
					class:text-text-primary={active}
					class:border-transparent={!active}
					class:text-text-tertiary={!active}
					style:transition-timing-function="var(--ease-standard)"
				>
					{view.name}
				</a>
			{/each}
		</nav>
	{/if}
{/snippet}

{#snippet asOf()}
	{#if asOfDate}
		<span class="font-mono text-2xs text-text-muted tabular-nums"
			>{formatAsOf(asOfDate)}</span
		>
	{/if}
{/snippet}

<TopBar
	bind:search
	{tab}
	ontabchange={switchTab}
	watchlistCount={watchlist.status === "ready" ? watchlist.count : null}
	ignoredCount={ignored.status === "ready" ? ignored.count : null}
	user={data.user}
	{signInUrl}
	{signOutUrl}
	connectorUrl={data.connectorUrl}
	connectorName={data.connectorName}
	mcpServerUrl={data.mcpServerUrl}
/>

{#if tab === "watchlist"}
	<div
		class="px-[18px] pt-5 pb-8 sm:px-[22px] sm:pt-6 sm:pb-10 lg:px-8 lg:pt-8 lg:pb-12 xl:px-10 xl:pt-10 xl:pb-14 2xl:px-12"
	>
		<div
			class="mb-[14px] flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
		>
			<div class="flex flex-wrap items-center gap-x-[10px] gap-y-2">
				<h2 class="m-0 text-xl font-medium tracking-tight">Watchlist</h2>
				{#if watchlist.status === "ready"}
					<span
						class="font-mono text-xs text-text-tertiary tabular-nums"
					>
						<span class="font-semibold text-text-secondary"
							>{watchedSurfaced.length}</span
						>
						of
						<span class="font-semibold text-text-secondary"
							>{watchlist.count}</span
						> currently surfaced
					</span>
				{/if}
			</div>
			{@render asOf()}
		</div>

		{#if watchlist.status === "signedOut"}
			<EmptyState kind="watchlist-signed-out">
				{#snippet action()}
					<Button href={signInUrl}>Sign in with a passkey</Button>
				{/snippet}
			</EmptyState>
		{:else if watchlist.status === "unsupported"}
			<EmptyState kind="user-data-unsupported" />
		{:else if watchlist.status === "restoring"}
			<div
				class="flex justify-center py-16 font-mono text-xs text-text-tertiary"
				role="status"
			>
				Restoring your watchlist…
			</div>
		{:else if watchlist.status === "locked" || watchlist.status === "unlocking"}
			<EmptyState kind="user-data-locked">
				{#snippet action()}
					<Button
						disabled={watchlist.status === "unlocking"}
						onclick={() => void watchlist.unlock()}
					>
						{watchlist.status === "unlocking"
							? "Waiting for your passkey…"
							: "Unlock with passkey"}
					</Button>
					<span class="max-w-[300px] font-mono text-2xs text-text-muted">
						There is no password fallback: losing every passkey makes
						this data unrecoverable. Enrolling a second passkey is the
						safety net.
					</span>
				{/snippet}
			</EmptyState>
		{:else if watchlist.status === "error"}
			<EmptyState
				kind="user-data-error"
				detail={watchlist.errorMessage ?? undefined}
			>
				{#snippet action()}
					<Button onclick={() => void watchlist.unlock()}>
						Try again
					</Button>
				{/snippet}
			</EmptyState>
		{:else if watchlist.count === 0}
			<EmptyState kind="watchlist-empty">
				{#snippet action()}
					<Button
						variant="secondary"
						onclick={() => switchTab("overview")}
					>
						Browse the overview
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			{#if watchlist.canEnrollCurrentPasskey}
				<div
					class="mb-[14px] flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-card py-[9px] pr-[14px] pl-5 shadow-xs"
				>
					<span class="font-mono text-xs text-text-tertiary">
						This passkey can't unlock your watchlist yet — enable it
						with one tap using an enrolled passkey.
					</span>
					<Button
						variant="secondary"
						onclick={() => void watchlist.enrollCurrentPasskey()}
					>
						Enable this passkey
					</Button>
				</div>
			{/if}
			{#if watchlist.syncError !== null}
				<div
					class="mb-[14px] flex flex-wrap items-center justify-between gap-3 rounded-md border border-dir-down-border bg-dir-down-soft py-[9px] pr-[14px] pl-5"
				>
					<span class="font-mono text-xs text-dir-down"
						>{watchlist.syncError}</span
					>
					<Button variant="secondary" onclick={() => watchlist.retrySync()}>
						Retry
					</Button>
				</div>
			{/if}

			<section aria-label="Watchlisted assets currently surfaced">
				{#if watchedFiltered.length > 0}
					<div class="grid grid-cols-1 gap-5 pb-[14px] xl:grid-cols-2">
						{#each watchedFiltered as card (card.instrumentId)}
							<AssetCard {card} runDate={payload?.runDate ?? ""} />
						{/each}
					</div>
				{:else}
					<div
						class="mb-5 rounded-md border border-border-subtle bg-surface-card px-5 py-[18px] text-center shadow-xs"
					>
						<span class="font-mono text-xs text-text-tertiary">
							{#if watchedSurfaced.length > 0 && searchTerm !== ""}
								None of the surfaced watchlisted assets match “{search}”
							{:else}
								None of your watchlisted assets were surfaced by
								today's signals — the full list below stays at hand
							{/if}
						</span>
					</div>
				{/if}
			</section>

			<section class="mt-5" aria-label="Manage watchlist">
				{#if panelEntries.length > 0}
					<WatchlistPanel
						entries={panelEntries}
						{surfacedIsins}
						onremove={(isin) => watchlist.remove(isin)}
					/>
				{:else}
					<div
						class="rounded-md border border-border-subtle bg-surface-card px-5 py-[18px] text-center shadow-xs"
					>
						<span class="font-mono text-xs text-text-tertiary"
							>Nothing on the watchlist matches “{search}”</span
						>
					</div>
				{/if}
			</section>
		{/if}
	</div>
{:else if tab === "ignored"}
	<div
		class="px-[18px] pt-5 pb-8 sm:px-[22px] sm:pt-6 sm:pb-10 lg:px-8 lg:pt-8 lg:pb-12 xl:px-10 xl:pt-10 xl:pb-14 2xl:px-12"
	>
		<div
			class="mb-[14px] flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
		>
			<div class="flex flex-wrap items-center gap-x-[10px] gap-y-2">
				<h2 class="m-0 text-xl font-medium tracking-tight">Ignored</h2>
				{#if ignored.status === "ready"}
					<span
						class="font-mono text-xs text-text-tertiary tabular-nums"
					>
						<span class="font-semibold text-text-secondary"
							>{ignoredSurfacedCount}</span
						>
						of
						<span class="font-semibold text-text-secondary"
							>{ignored.count}</span
						> hidden from today's feed
					</span>
				{/if}
			</div>
			{@render asOf()}
		</div>

		{#if ignored.status === "signedOut"}
			<EmptyState kind="ignored-signed-out">
				{#snippet action()}
					<Button href={signInUrl}>Sign in with a passkey</Button>
				{/snippet}
			</EmptyState>
		{:else if ignored.status === "loading"}
			<div
				class="flex justify-center py-16 font-mono text-xs text-text-tertiary"
				role="status"
			>
				Loading your ignore list…
			</div>
		{:else if ignored.status === "error"}
			<EmptyState kind="ignored-error">
				{#snippet action()}
					<Button onclick={() => void ignored.refresh()}>
						Try again
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			{#if ignored.syncError !== null}
				<div
					class="mb-[14px] flex flex-wrap items-center justify-between gap-3 rounded-md border border-dir-down-border bg-dir-down-soft py-[9px] pr-[14px] pl-5"
				>
					<span class="font-mono text-xs text-dir-down"
						>{ignored.syncError}</span
					>
					<Button variant="secondary" onclick={() => ignored.retrySync()}>
						Retry
					</Button>
				</div>
			{/if}

			{#if searchTerm !== ""}
				<section class="mb-5" aria-label="Add to ignore list">
					<IgnoreSearchResults
						cards={ignoreCandidates}
						query={searchTerm}
						onignore={(card) => ignoreConfirm.request(card)}
					/>
				</section>
			{:else if ignored.count > 0}
				<p class="mb-[14px] font-mono text-xs text-text-muted">
					Search above to add an asset to the ignore list — or use the
					eye-off icon on any card.
				</p>
			{/if}

			{#if ignored.count === 0}
				<EmptyState kind="ignored-empty">
					{#snippet action()}
						<Button
							variant="secondary"
							onclick={() => switchTab("overview")}
						>
							Browse the overview
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<section aria-label="Manage ignored assets">
					{#if ignoredPanelEntries.length > 0}
						<IgnoredPanel
							entries={ignoredPanelEntries}
							{surfacedIsins}
							onremove={(isin) => ignored.remove(isin)}
						/>
					{:else}
						<div
							class="rounded-md border border-border-subtle bg-surface-card px-5 py-[18px] text-center shadow-xs"
						>
							<span class="font-mono text-xs text-text-tertiary"
								>Nothing on the ignore list matches “{search}”</span
							>
						</div>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
{:else if data.dbError}
	<EmptyState kind="db-error" />
{:else if payload === null}
	<EmptyState kind="no-runs" />
{:else}
	<div
		class="px-[18px] pt-5 pb-8 sm:px-[22px] sm:pt-6 sm:pb-10 lg:px-8 lg:pt-8 lg:pb-12 xl:px-10 xl:pt-10 xl:pb-14 2xl:px-12"
	>
		<div
			class="mb-[14px] flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
		>
			<div class="flex flex-wrap items-center gap-x-[10px] gap-y-2">
				<h2 class="m-0 text-xl font-medium tracking-tight">
					<span
						class="mr-[5px] align-baseline text-sm font-normal text-text-muted"
						>From</span
					>DAX / MDAX / SDAX
				</h2>
				<span class="font-mono text-xs text-text-tertiary tabular-nums">
					{#if searchTerm !== ""}
						<span class="font-semibold text-text-secondary"
							>{filtered.length}</span
						> shown ·
					{/if}
					<span class="font-semibold text-text-secondary"
						>{visibleCards.length}</span
					>
					out of
					<span class="font-semibold text-text-secondary"
						>{payload.universeSize ?? "—"}</span
					> surfaced
				</span>
				{@render viewNav()}
			</div>
			{@render asOf()}
		</div>

		{#if cards.length === 0}
			<EmptyState kind="no-passers" runDate={payload.runDate} />
		{:else if visibleCards.length === 0}
			<div
				class="rounded-md border border-border-subtle bg-surface-card px-5 py-[18px] text-center shadow-xs"
			>
				<span class="font-mono text-xs text-text-tertiary">
					Every asset surfaced today is on your ignore list — manage it
					in the Ignored tab
				</span>
			</div>
		{:else if filtered.length === 0}
			<EmptyState kind="no-matches" query={search} />
		{:else}
			<div class="grid grid-cols-1 gap-5 pb-[14px] xl:grid-cols-2">
				{#each filtered as card (card.instrumentId)}
					<AssetCard {card} runDate={payload.runDate} />
				{/each}
			</div>
		{/if}
	</div>
{/if}

<IgnoreConfirmDialog />
