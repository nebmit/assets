<script lang="ts">
	import { formatAsOf } from "$lib/format.js";
	import { matchesSearch } from "$lib/screener/filter.js";
	import AssetCard from "$lib/components/screener/AssetCard.svelte";
	import EmptyState from "$lib/components/screener/EmptyState.svelte";
	import TopBar from "$lib/components/screener/TopBar.svelte";
	import type { PageProps } from "./$types.js";

	let { data }: PageProps = $props();

	let search = $state("");

	const payload = $derived(data.payload);
	const cards = $derived(payload?.cards ?? []);
	const filtered = $derived(cards.filter((c) => matchesSearch(c, search)));
	const searchTerm = $derived(search.trim());
	/** Freshest price date across the grid; the run date is the fallback. */
	const asOfDate = $derived(
		cards.reduce<string | null>(
			(latest, c) =>
				c.priceDate !== null &&
				(latest === null || c.priceDate > latest)
					? c.priceDate
					: latest,
			null,
		) ?? payload?.runDate,
	);

	function screenHref(slug: string): string {
		return `?screen=${slug}`;
	}
</script>

<svelte:head>
	<title>DAX / MDAX / SDAX · assets</title>
	<meta
		name="description"
		content="Ranked surfacing across DAX, MDAX and SDAX — prices, valuation vs sector, insider dealings and regulatory news."
	/>
</svelte:head>

<TopBar
	bind:search
	user={data.user}
	signInUrl={data.signInUrl}
	signOutUrl={data.signOutUrl}
	connectorUrl={data.connectorUrl}
	connectorName={data.connectorName}
	mcpServerUrl={data.mcpServerUrl}
/>

{#if data.dbError}
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
						>{cards.length}</span
					>
					out of
					<span class="font-semibold text-text-secondary"
						>{payload.universeSize ?? "—"}</span
					> passed
				</span>
				<nav
					class="inline-flex flex-wrap items-baseline gap-x-[7px] gap-y-1 font-sans text-xs"
					aria-label="Screen"
				>
					{#each payload.screens as screen, index (screen.slug)}
						{@const active = screen.slug === payload.screen.slug}
						{#if index > 0}
							<span class="text-text-muted">/</span>
						{/if}
						<a
							href={screenHref(screen.slug)}
							aria-current={active ? "page" : undefined}
							class="border-b pb-px whitespace-nowrap no-underline transition-colors duration-[120ms] hover:border-border-default hover:text-text-primary"
							class:border-border-strong={active}
							class:font-medium={active}
							class:text-text-primary={active}
							class:border-transparent={!active}
							class:text-text-tertiary={!active}
							style:transition-timing-function="var(--ease-standard)"
						>
							{screen.name}
						</a>
					{/each}
				</nav>
			</div>
			{#if asOfDate}
				<span class="font-mono text-2xs text-text-muted tabular-nums"
					>{formatAsOf(asOfDate)}</span
				>
			{/if}
		</div>

		{#if cards.length === 0}
			<EmptyState kind="no-passers" runDate={payload.runDate} />
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
