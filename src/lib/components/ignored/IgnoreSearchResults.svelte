<script lang="ts">
	import type { CardData } from '$lib/feed/types.js';
	import Badge from '../ds/Badge.svelte';
	import Button from '../ds/Button.svelte';
	import Link from '../ds/Link.svelte';

	/**
	 * The Ignored tab's search-to-add surface: surfaced, not-yet-ignored
	 * assets matching the global search box, each with an Ignore action that
	 * opens the shared confirmation dialog. Search covers the current run's
	 * surfaced assets — the same universe the feed itself shows.
	 */
	interface Props {
		cards: Pick<CardData, 'isin' | 'name' | 'wkn' | 'sector'>[];
		query: string;
		onignore: (card: Pick<CardData, 'isin' | 'name'>) => void;
	}

	let { cards, query, onignore }: Props = $props();

	function equityUrl(isin: string): string {
		return `https://www.boerse-frankfurt.de/equity/${isin.toLowerCase()}`;
	}
</script>

<section
	class="overflow-hidden rounded-md border border-border-subtle bg-surface-card shadow-xs"
	aria-label="Surfaced assets matching the search"
>
	<header
		class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border-subtle bg-surface-card px-5 py-[9px]"
	>
		<span class="text-sm font-medium tracking-tight">Add to ignore list</span>
		<span class="font-mono text-xs text-text-tertiary">
			surfaced assets matching “{query}”
		</span>
	</header>
	{#if cards.length === 0}
		<div class="px-5 py-[18px] text-center">
			<span class="font-mono text-xs text-text-tertiary">
				No surfaced asset matches “{query}” — only assets surfaced by the
				current run can be searched here
			</span>
		</div>
	{:else}
		<ul class="m-0 list-none p-0">
			{#each cards as card (card.isin)}
				<li
					class="flex items-center gap-3 border-b border-border-subtle py-[9px] pr-[14px] pl-5 transition-colors duration-[120ms] last:border-b-0 hover:bg-surface-hover"
					style:transition-timing-function="var(--ease-standard)"
				>
					<div
						class="flex min-w-0 flex-1 flex-col gap-[2px] sm:flex-row sm:items-baseline sm:gap-[10px]"
					>
						<span class="truncate text-sm font-medium tracking-tight">{card.name}</span>
						<span class="font-mono tabular-nums">
							<Link href={equityUrl(card.isin)} external variant="quiet" size="xs">
								{card.isin}{#if card.wkn !== null}&nbsp;· {card.wkn}{/if}
							</Link>
						</span>
					</div>
					{#if card.sector !== null}
						<span class="hidden sm:inline"><Badge tone="neutral">{card.sector}</Badge></span>
					{/if}
					<Button
						variant="secondary"
						title="Ignore {card.name} — hide it from all pages"
						onclick={() => onignore(card)}
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
							<path
								d="M17.94 17.94 A10.07 10.07 0 0 1 12 20 c-7 0 -11 -8 -11 -8 a18.45 18.45 0 0 1 5.06 -5.94 M9.9 4.24 A9.12 9.12 0 0 1 12 4 c7 0 11 8 11 8 a18.5 18.5 0 0 1 -2.16 3.19 m-6.72 -1.07 a3 3 0 1 1 -4.24 -4.24"
							/>
							<path d="M1 1 L23 23" />
						</svg>
						Ignore
					</Button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
