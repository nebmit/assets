<script lang="ts">
	import { formatAsOf } from '$lib/format.js';
	import { matchesSearch } from '$lib/screener/filter.js';
	import AssetCard from '$lib/components/screener/AssetCard.svelte';
	import EmptyState from '$lib/components/screener/EmptyState.svelte';
	import TopBar from '$lib/components/screener/TopBar.svelte';
	import type { PageProps } from './$types.js';

	let { data }: PageProps = $props();

	let search = $state('');

	const payload = $derived(data.payload);
	const cards = $derived(payload?.cards ?? []);
	const filtered = $derived(cards.filter((c) => matchesSearch(c, search)));
	/** Freshest price date across the grid; the run date is the fallback. */
	const asOfDate = $derived(
		cards.reduce<string | null>(
			(latest, c) => (c.priceDate !== null && (latest === null || c.priceDate > latest) ? c.priceDate : latest),
			null
		) ?? payload?.runDate
	);
</script>

<svelte:head>
	<title>German equities · assets</title>
	<meta
		name="description"
		content="Ranked surfacing of German equities — prices, valuation vs sector, insider dealings and regulatory news."
	/>
</svelte:head>

<TopBar bind:search />

{#if data.dbError}
	<EmptyState kind="db-error" />
{:else if payload === null}
	<EmptyState kind="no-runs" />
{:else}
	<div class="px-[22px] pt-5 pb-2">
		<div class="mb-[14px] flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
			<div class="flex items-baseline gap-[10px]">
				<h2 class="m-0 text-xl font-medium tracking-tight">German equities</h2>
				<span class="font-mono text-xs text-text-tertiary tabular-nums">
					{filtered.length} of {payload.universeSize ?? '—'}
				</span>
			</div>
			{#if asOfDate}
				<span class="font-mono text-2xs text-text-muted tabular-nums">{formatAsOf(asOfDate)}</span>
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
