<script lang="ts">
	import { unknownShortSellers, type ShortSellerAnalysis } from '$lib/shortSellers.js';
	import { formatDayMonthYear } from '$lib/format.js';
	import { FINANCIAL_TERMS } from '$lib/financialTerms.js';
	import TermHelp from '../ds/TermHelp.svelte';
	import Link from '../ds/Link.svelte';

	let { analysis = unknownShortSellers() }: { analysis?: ShortSellerAnalysis } = $props();
	const stale = $derived(analysis.freshness === 'stale');
	const label = $derived(analysis.status === 'present' ? 'Publicly disclosed short positions' :
		analysis.status === 'none_disclosed' ? 'No publicly disclosed short positions' :
		analysis.status === 'unavailable' ? 'Named short-holder disclosures unavailable' : 'Short seller data unavailable');
	const tone = $derived(stale || (analysis.status === 'unknown' || analysis.status === 'unavailable') ? 'text-text-tertiary' :
		analysis.status === 'present' ? 'text-dir-down' : 'text-dir-up');
</script>

<details class="short-sellers min-w-0 border-t border-border-subtle px-5 py-3">
	<summary class="cursor-pointer text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-4">
		<span class="font-medium {tone}">{label}{stale ? ' · stale' : ''}</span>
		{#if analysis.holderCount !== null}
			<span class="mt-1 block font-mono whitespace-nowrap text-text-secondary tabular-nums sm:mt-0 sm:ml-2 sm:inline-block">
				{analysis.holderCount} {analysis.holderCount === 1 ? 'holder' : 'holders'} · {analysis.totalDisclosedPct?.toFixed(2)}%
			</span>
		{/if}
		{#if analysis.capturedAt}
			<span class="mt-1 block text-2xs text-text-muted">
				Checked {formatDayMonthYear(analysis.capturedAt, 'Europe/Berlin')}
			</span>
		{/if}
	</summary>
	<div class="mt-3 text-xs text-text-secondary">
		{#if analysis.holders.length > 0}
			<ul class="m-0 list-none space-y-2 p-0">
				{#each analysis.holders as holder (holder.holderName)}
					<li class="flex items-baseline justify-between gap-3">
						<span class="min-w-0 break-words">{holder.holderName}</span>
						<span class="shrink-0 text-right font-mono tabular-nums">
							{holder.positionPct.toFixed(2)}%
							<span class="block text-2xs text-text-muted">Position {formatDayMonthYear(holder.positionDate)}</span>
						</span>
					</li>
				{/each}
			</ul>
		{:else if analysis.status === 'none_disclosed'}
			<p>No holders at or above the public disclosure threshold in this snapshot.</p>
		{:else if analysis.status === 'unavailable'}
			<p>US stocks do not have the German public named-holder disclosure coverage used here. Aggregate US short interest is not yet integrated.</p>
		{:else}
			<p>Complete short seller coverage is unavailable for this asset.</p>
		{/if}
		{#if stale}<p class="mt-2">This snapshot is more than three days old and does not contribute a confirmation.</p>{/if}
		{#if analysis.status !== 'unavailable'}
		<div class="mt-3 flex flex-wrap items-center gap-2 text-text-muted">
			<TermHelp term={FINANCIAL_TERMS.shortSellers.term} definition={FINANCIAL_TERMS.shortSellers.definition}
				clarification={FINANCIAL_TERMS.shortSellers.clarification}>
				<span>Public disclosure threshold: 0.5% per holder</span>
			</TermHelp>
			<Link href="https://www.bundesanzeiger.de/pub/de/nlp" external variant="quiet" size="xs">Bundesanzeiger</Link>
		</div>
		<p class="mt-2 text-2xs text-text-muted">Disclosed totals are not total market short interest. Smaller positions may exist.</p>
		{/if}
	</div>
</details>
