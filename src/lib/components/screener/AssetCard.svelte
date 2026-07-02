<script lang="ts">
	import { FILINGS_SEARCH_URL } from '$lib/externalLinks.js';
	import { formatCompactEur, formatPrice, formatRatio } from '$lib/format.js';
	import type { CardData } from '$lib/screener/types.js';
	import Badge from '../ds/Badge.svelte';
	import DeltaBadge from '../ds/DeltaBadge.svelte';
	import Link from '../ds/Link.svelte';
	import InsiderList from './InsiderList.svelte';
	import NewsList from './NewsList.svelte';
	import PriceChart from './PriceChart.svelte';

	/**
	 * One equity as a rich card: basics + hero price, scrubbable price chart,
	 * valuation vs sector, then insider trades and regulatory news on a
	 * sunken second row. Surfaces facts only — no rank, no recommendation.
	 */
	interface Props {
		card: CardData;
		runDate: string;
	}

	let { card, runDate }: Props = $props();

	const equityUrl = $derived(`https://www.boerse-frankfurt.de/equity/${card.isin.toLowerCase()}`);
</script>

<article
	class="flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-sunken shadow-xs"
>
	<div class="flex flex-col items-stretch bg-surface-card md:flex-row">
		<div
			class="flex flex-none flex-col justify-start gap-2 border-b border-border-subtle px-5 pt-4 pb-[14px] max-md:flex-row max-md:items-center max-md:justify-between md:w-[230px] md:border-r md:border-b-0"
		>
			<div class="flex flex-col gap-[6px] md:pr-5">
				{#if card.sector !== null}
					<span class="self-start"><Badge tone="neutral">{card.sector}</Badge></span>
				{/if}
				<span class="text-lg font-medium tracking-tight">{card.name}</span>
				<span class="font-mono tabular-nums">
					<Link href={equityUrl} external variant="quiet" size="xs">
						{card.isin}{#if card.wkn !== null}&nbsp;· {card.wkn}{/if}
					</Link>
				</span>
			</div>
			<div class="flex items-baseline gap-[3px] md:mt-[6px]">
				{#if card.price === null}
					<span class="font-mono text-3xl font-medium text-text-muted">—</span>
				{:else}
					<span class="font-mono text-sm text-text-tertiary">€</span>
					<span class="font-mono text-3xl leading-none font-medium tracking-tight tabular-nums">
						{formatPrice(card.price)}
					</span>
				{/if}
			</div>
		</div>

		<div class="flex min-w-0 flex-1 border-b border-border-subtle md:border-r md:border-b-0">
			<PriceChart series={card.series} {runDate} hi52={card.hi52} lo52={card.lo52} />
		</div>

		<div
			class="flex flex-none flex-col px-[18px] py-3 max-md:flex-row max-md:flex-wrap max-md:items-start max-md:justify-between max-md:gap-4 md:w-[170px]"
		>
			<div class="flex flex-col gap-[5px]">
				<span class="micro-label">P / E vs sector</span>
				<div class="flex items-baseline gap-[7px]">
					{#if card.pe === null}
						<span class="font-mono text-xl font-medium text-text-muted">—</span>
					{:else}
						<span
							class="font-mono text-xl leading-none font-medium tracking-tight text-text-secondary tabular-nums"
						>
							{formatRatio(card.pe)}
						</span>
						{#if card.peDeltaPct !== null}
							<DeltaBadge value={card.peDeltaPct} variant="soft" showArrow={false} invert />
						{/if}
					{/if}
				</div>
				{#if card.peerMedianPe !== null}
					<span class="font-mono text-2xs text-text-muted tabular-nums">
						median {formatRatio(card.peerMedianPe)}
					</span>
				{/if}
			</div>
			<div
				class="flex items-baseline gap-[7px] md:mt-3 md:border-t md:border-border-subtle md:pt-[11px]"
			>
				<span class="font-sans text-2xs font-medium text-text-tertiary uppercase">EPS</span>
				<span class="font-mono text-sm font-medium tabular-nums">
					{card.eps === null ? '—' : `€${card.eps.toFixed(2)}`}
				</span>
				<span class="font-mono text-2xs text-text-muted">ttm</span>
			</div>
			<div
				class="flex items-baseline gap-[7px] md:mt-3 md:border-t md:border-border-subtle md:pt-[11px]"
			>
				<span class="micro-label whitespace-nowrap">Mkt cap</span>
				<span class="font-mono text-sm font-medium tabular-nums">
					{card.marketCap === null ? '—' : `€${formatCompactEur(card.marketCap)}`}
				</span>
			</div>
			<div class="md:mt-auto md:pt-3">
				<Link href={FILINGS_SEARCH_URL} external variant="quiet" size="xs">
					Filings
				</Link>
			</div>
		</div>
	</div>

	<div class="flex flex-col items-stretch border-t border-border-subtle bg-surface-sunken sm:flex-row">
		<InsiderList insiders={card.insiders} asOf={runDate} isin={card.isin} />
		<NewsList news={card.news} isin={card.isin} />
	</div>
</article>
