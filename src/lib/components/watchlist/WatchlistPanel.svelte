<script lang="ts">
	import ShortSellerPanel from '../feed/ShortSellerPanel.svelte';
	import type { ShortSellerAnalysis } from '$lib/shortSellers.js';
	import { formatDayMonthYear } from '$lib/format.js';
	import type { ListEntry } from '$lib/userData/types.js';
	import Badge from '../ds/Badge.svelte';
	import Button from '../ds/Button.svelte';
	import Link from '../ds/Link.svelte';

	/**
	 * The management surface: every watchlisted asset as a compact row —
	 * including ones the current signal run didn't surface, rendered from
	 * the name snapshot inside the encrypted document. Removal is optimistic
	 * and unconfirmed; re-adding is one click, so a confirm dialog would
	 * only add friction.
	 */
	interface Props {
		catalog: import('$lib/feed/types.js').AssetCatalogEntry[];
		entries: ListEntry[];
		shortSellersByAssetId: Record<string, ShortSellerAnalysis>;
		/** ISINs present in the current feed payload (drives the "surfaced" chip). */
		surfacedAssetIds: Set<string>;
		onremove: (assetId: string) => void;
	}

	let { catalog, entries, surfacedAssetIds, onremove, shortSellersByAssetId }: Props = $props();

	const sorted = $derived([...entries].sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1)));


</script>

<section
	class="overflow-hidden rounded-md border border-border-subtle bg-surface-card shadow-xs"
	aria-label="All watchlisted assets"
>
	<header
		class="flex items-baseline justify-between gap-3 border-b border-border-subtle bg-surface-card px-5 py-[9px]"
	>
		<span class="text-sm font-medium tracking-tight">All watchlisted</span>
		<span class="font-mono text-xs text-text-tertiary tabular-nums">
			<span class="font-semibold text-text-secondary">{entries.length}</span>
			{entries.length === 1 ? 'asset' : 'assets'}
		</span>
	</header>
	<ul class="m-0 list-none p-0">
		{#each sorted as entry (entry.assetId)}
			{@const asset = catalog.find((a) => a.assetId === entry.assetId)}
			<li
				class="flex flex-wrap items-center gap-3 border-b border-border-subtle py-[9px] pr-[14px] pl-5 transition-colors duration-[120ms] last:border-b-0 hover:bg-surface-hover"
				style:transition-timing-function="var(--ease-standard)"
			>
				<div class="flex min-w-0 flex-1 flex-col gap-[2px] sm:flex-row sm:items-baseline sm:gap-[10px]">
					<span class="truncate text-sm font-medium tracking-tight">{entry.name}</span>
					<span class="font-mono tabular-nums">
						{#if asset?.links.quote}<Link href={asset.links.quote} external variant="quiet" size="xs">{asset.ticker ?? asset.isin ?? ''}</Link>{/if}
					</span>
				</div>
				{#if surfacedAssetIds.has(entry.assetId)}
					<Badge tone="up" variant="soft">surfaced</Badge>
				{/if}
				<span
					class="hidden font-mono text-2xs whitespace-nowrap text-text-muted tabular-nums sm:inline"
					title="Added to watchlist"
				>
					{formatDayMonthYear(entry.addedAt)}
				</span>
				<Button
					variant="ghost"
					size="icon"
					title="Remove {entry.name} from your watchlist"
					aria-label="Remove {entry.name} from your watchlist"
					onclick={() => onremove(entry.assetId)}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.7"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M6 6 L18 18 M18 6 L6 18" />
					</svg>
				</Button>
			<div class="w-full [&>details]:border-t-0 [&>details]:px-0 [&>details]:py-1">
					<ShortSellerPanel analysis={shortSellersByAssetId[entry.assetId]} />
				</div>
			</li>
		{/each}
	</ul>
</section>
