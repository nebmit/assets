<script lang="ts">
	import { formatDayMonthYear } from '$lib/format.js';
	import type { ListEntry } from '$lib/userData/types.js';
	import Badge from '../ds/Badge.svelte';
	import Button from '../ds/Button.svelte';
	import Link from '../ds/Link.svelte';

	/**
	 * The management surface: every ignored asset as a compact row — rendered
	 * from the name snapshot inside the encrypted document, so it works for
	 * assets the current signal run didn't surface. The "surfaced" chip means
	 * the asset is being actively hidden from today's feed. Un-ignoring is
	 * optimistic and unconfirmed (mirroring the watchlist panel): re-ignoring
	 * is two clicks away, and the eye glyph makes the direction obvious.
	 */
	interface Props {
		catalog: import('$lib/feed/types.js').AssetCatalogEntry[];
		entries: ListEntry[];
		/** ISINs present in the current feed payload (drives the "surfaced" chip). */
		surfacedAssetIds: Set<string>;
		onremove: (assetId: string) => void;
	}

	let { catalog, entries, surfacedAssetIds, onremove }: Props = $props();

	const sorted = $derived([...entries].sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1)));


</script>

<section
	class="overflow-hidden rounded-md border border-border-subtle bg-surface-card shadow-xs"
	aria-label="All ignored assets"
>
	<header
		class="flex items-baseline justify-between gap-3 border-b border-border-subtle bg-surface-card px-5 py-[9px]"
	>
		<span class="text-sm font-medium tracking-tight">All ignored</span>
		<span class="font-mono text-xs text-text-tertiary tabular-nums">
			<span class="font-semibold text-text-secondary">{entries.length}</span>
			{entries.length === 1 ? 'asset' : 'assets'}
		</span>
	</header>
	<ul class="m-0 list-none p-0">
		{#each sorted as entry (entry.assetId)}
			{@const asset = catalog.find((a) => a.assetId === entry.assetId)}
			<li
				class="flex items-center gap-3 border-b border-border-subtle py-[9px] pr-[14px] pl-5 transition-colors duration-[120ms] last:border-b-0 hover:bg-surface-hover"
				style:transition-timing-function="var(--ease-standard)"
			>
				<div class="flex min-w-0 flex-1 flex-col gap-[2px] sm:flex-row sm:items-baseline sm:gap-[10px]">
					<span class="truncate text-sm font-medium tracking-tight">{entry.name}</span>
					<span class="font-mono tabular-nums">
						{#if asset?.links.quote}<Link href={asset.links.quote} external variant="quiet" size="xs">{asset.ticker ?? asset.isin ?? ''}</Link>{/if}
					</span>
				</div>
				{#if surfacedAssetIds.has(entry.assetId)}
					<Badge tone="neutral" variant="soft">hidden today</Badge>
				{/if}
				<span
					class="hidden font-mono text-2xs whitespace-nowrap text-text-muted tabular-nums sm:inline"
					title="Ignored since"
				>
					{formatDayMonthYear(entry.addedAt)}
				</span>
				<Button
					variant="ghost"
					size="icon"
					title="Stop ignoring {entry.name} — it will reappear on all pages"
					aria-label="Stop ignoring {entry.name} — it will reappear on all pages"
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
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M1 12 s4 -8 11 -8 11 8 11 8 -4 8 -11 8 -11 -8 -11 -8" />
						<circle cx="12" cy="12" r="3" />
					</svg>
				</Button>
			</li>
		{/each}
	</ul>
</section>
