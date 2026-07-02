<script lang="ts">
	import { formatDayMonth } from '$lib/format.js';
	import type { NewsRowView } from '$lib/screener/types.js';
	import Badge from '../ds/Badge.svelte';
	import Link from '../ds/Link.svelte';

	/**
	 * Up to two recent regulatory headlines. No per-item URL is ingested yet,
	 * so headlines link out to the issuer's Börse Frankfurt news page.
	 */
	interface Props {
		news: NewsRowView[];
		isin: string;
	}

	let { news, isin }: Props = $props();

	const newsUrl = $derived(`https://www.boerse-frankfurt.de/equity/${isin.toLowerCase()}`);
</script>

<div class="flex w-full flex-none flex-col px-5 pt-[11px] pb-[13px] sm:w-[312px]">
	<span class="micro-label mb-[3px]">Regulatory news</span>
	{#if news.length === 0}
		<div class="border-t border-border-subtle py-[7px] font-mono text-xs text-text-muted">—</div>
	{:else}
		{#each news as item (item)}
			<div class="flex flex-col gap-[3px] border-t border-border-subtle py-[7px]">
				<div class="flex items-center gap-[7px]">
					<Badge tone="neutral" variant="outline">{item.newsType ?? 'News'}</Badge>
					<span class="font-mono text-2xs text-text-muted tabular-nums">
						{formatDayMonth(item.publishedAt)}
					</span>
				</div>
				<span class="text-sm leading-snug">
					<Link href={newsUrl} external variant="inline">{item.headline}</Link>
				</span>
			</div>
		{/each}
	{/if}
</div>
