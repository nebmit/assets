<script lang="ts">
	import type { AssetLinks } from '$lib/externalLinks.js';
	import { FINANCIAL_TERMS } from '$lib/financialTerms.js';
	import { ageOpacity, formatCompactNumber, formatDayMonth } from '$lib/format.js';
	import type { InsiderRowView, PartyRole, TransactionSide } from '$lib/feed/types.js';
	import Badge from '../ds/Badge.svelte';
	import Link from '../ds/Link.svelte';
	import TermHelp from '../ds/TermHelp.svelte';

	/**
	 * Up to five recent buy/sell directors' dealings. Rows fade with age but never
	 * below 50% opacity so the oldest trade stays legible. Badge tone follows
	 * direction: buy = up (blue), sell = down (amber) — never "buy = good".
	 */
	interface Props {
		insiders: InsiderRowView[];
		asOf: string;
		links: AssetLinks;
	}

	let { insiders, asOf, links }: Props = $props();

	const sourceUrl = $derived(links.insiders);
	const displayedInsiders = $derived(insiders.filter((trade) => trade.side !== 'other'));

	const ROLE_LABELS: Record<PartyRole, string> = {
		executive: 'Executive',
		director: 'Director',
		related_party: 'Related',
		other: 'Other'
	};

	const SIDE_TONE: Record<TransactionSide, 'up' | 'down' | 'neutral'> = {
		buy: 'up',
		sell: 'down',
		other: 'neutral'
	};

	const SIDE_LABELS: Record<TransactionSide, string> = {
		buy: 'Buy',
		sell: 'Sell',
		other: 'Other'
	};
</script>

<div class="min-w-0 flex-1 px-5 pt-[11px] pb-[13px] max-sm:border-b sm:border-r border-border-subtle">
	<div class="mb-[3px] flex items-baseline justify-between">
		<TermHelp
			term={FINANCIAL_TERMS.insiderTrades.term}
			definition={FINANCIAL_TERMS.insiderTrades.definition}
			clarification={FINANCIAL_TERMS.insiderTrades.clarification}
			align="left"
		>
			<span class="micro-label">Insider trades</span>
		</TermHelp>
		<span class="inline-flex items-center gap-[5px]">
			{#if sourceUrl}<Link href={sourceUrl} external variant="quiet" size="xs">Filings</Link>{/if}
		</span>
	</div>
	{#if displayedInsiders.length === 0}
		<div class="border-t border-border-subtle py-[7px] font-mono text-xs text-text-muted">
			No transactions available in this window
		</div>
	{:else}
		{#each displayedInsiders as trade (trade)}
			<div
				class="-mx-1 grid grid-cols-[44px_1fr_68px_92px] items-center gap-3 rounded-xs border-t border-border-subtle px-1 py-[6px] transition-colors duration-[120ms] hover:bg-surface-hover"
				style:opacity={ageOpacity(trade.transactionDate, asOf)}
			>
				<Badge tone={SIDE_TONE[trade.side]}>{SIDE_LABELS[trade.side]}</Badge>
				<span class="overflow-hidden text-xs text-ellipsis whitespace-nowrap">
					{trade.partyName ?? '—'}
					<span class="text-text-muted">· {ROLE_LABELS[trade.partyRole]}</span>
				</span>
				<span class="font-mono text-2xs text-text-tertiary tabular-nums">
					{formatDayMonth(trade.transactionDate)}
				</span>
				<span title={trade.qualificationReason ?? (trade.currencyStatus === 'inferred_usd' ? 'USD inferred from matched share class' : undefined)} class="text-right font-mono text-xs font-medium tabular-nums">
					{trade.amount === null ? '—' : `${trade.currency ?? ''} ${formatCompactNumber(trade.amount)}`}
					{#if trade.currencyStatus === 'inferred_usd'}<span class="block text-2xs font-normal text-text-muted">USD inferred</span>{/if}
					{#if trade.qualification !== 'qualified'}<span class="block text-2xs font-normal text-text-muted">Not scored</span>{/if}
				</span>
			</div>
		{/each}
	{/if}
</div>
