<script lang="ts">
	import { bafinDealingsUrl } from '$lib/externalLinks.js';
	import { ageOpacity, formatCompactEur, formatDayMonth } from '$lib/format.js';
	import type { InsiderRowView, PartyRole, TransactionSide } from '$lib/screener/types.js';
	import Badge from '../ds/Badge.svelte';
	import Link from '../ds/Link.svelte';

	/**
	 * Up to five recent buy/sell directors' dealings. Rows fade with age but never
	 * below 50% opacity so the oldest trade stays legible. Badge tone follows
	 * direction: buy = up (blue), sell = down (amber) — never "buy = good".
	 */
	interface Props {
		insiders: InsiderRowView[];
		asOf: string;
		isin: string;
	}

	let { insiders, asOf, isin }: Props = $props();

	const bafinUrl = $derived(bafinDealingsUrl(isin));
	const displayedInsiders = $derived(insiders.filter((trade) => trade.side !== 'other'));

	const ROLE_LABELS: Record<PartyRole, string> = {
		executive_board: 'Exec. board',
		supervisory_board: 'Sup. board',
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
		<span class="micro-label">Insider trades</span>
		<Link href={bafinUrl} external variant="quiet" size="xs">BaFin</Link>
	</div>
	{#if displayedInsiders.length === 0}
		<div class="border-t border-border-subtle py-[7px] font-mono text-xs text-text-muted">
			None in window
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
				<span class="text-right font-mono text-xs font-medium tabular-nums">
					{trade.amount === null ? '—' : `€${formatCompactEur(trade.amount)}`}
				</span>
			</div>
		{/each}
	{/if}
</div>
