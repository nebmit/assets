<script lang="ts">
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
		entries: ListEntry[];
		/** ISINs present in the current feed payload (drives the "surfaced" chip). */
		surfacedIsins: Set<string>;
		onremove: (isin: string) => void;
	}

	let { entries, surfacedIsins, onremove }: Props = $props();

	const sorted = $derived([...entries].sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1)));

	function equityUrl(isin: string): string {
		return `https://www.boerse-frankfurt.de/equity/${isin.toLowerCase()}`;
	}
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
		{#each sorted as entry (entry.isin)}
			<li
				class="flex items-center gap-3 border-b border-border-subtle py-[9px] pr-[14px] pl-5 transition-colors duration-[120ms] last:border-b-0 hover:bg-surface-hover"
				style:transition-timing-function="var(--ease-standard)"
			>
				<div class="flex min-w-0 flex-1 flex-col gap-[2px] sm:flex-row sm:items-baseline sm:gap-[10px]">
					<span class="truncate text-sm font-medium tracking-tight">{entry.name}</span>
					<span class="font-mono tabular-nums">
						<Link href={equityUrl(entry.isin)} external variant="quiet" size="xs">
							{entry.isin}
						</Link>
					</span>
				</div>
				{#if surfacedIsins.has(entry.isin)}
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
					onclick={() => onremove(entry.isin)}
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
			</li>
		{/each}
	</ul>
</section>
