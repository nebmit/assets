<script lang="ts">
	import { FILINGS_SEARCH_URL } from '$lib/externalLinks.js';
	import { FINANCIAL_TERMS, type FinancialTerm } from '$lib/financialTerms.js';
	import { formatCompactEur, formatPrice, formatRatio } from '$lib/format.js';
	import type { CardData } from '$lib/feed/types.js';
	import { getIgnoreConfirm, getIgnored, getWatchlist } from '$lib/userData/context.js';
	import Badge from '../ds/Badge.svelte';
	import DeltaBadge from '../ds/DeltaBadge.svelte';
	import Link from '../ds/Link.svelte';
	import TermHelp from '../ds/TermHelp.svelte';
	import InsiderList from './InsiderList.svelte';
	import NewsList from './NewsList.svelte';
	import PriceChart from './PriceChart.svelte';

	/**
	 * One equity as a rich card: why it was surfaced (fired signals as factual
	 * evidence badges + day-over-day state), basics + hero price, scrubbable
	 * price chart, valuation vs sector, then insider trades and regulatory
	 * news on a sunken second row. Surfaces facts only — no recommendation.
	 * Signed-in users get a watch toggle and an ignore action in the evidence
	 * strip (ink, like all actions — blue/amber stay reserved for data
	 * direction). Ignoring asks for confirmation; ignored cards never render,
	 * so the eye-off button is one-way and un-ignoring lives in the Ignored tab.
	 */
	interface Props {
		card: CardData;
		runDate: string;
	}

	let { card, runDate }: Props = $props();

	const watchlist = getWatchlist();
	const ignored = getIgnored();
	const ignoreConfirm = getIgnoreConfirm();
	const watchlisted = $derived(watchlist.isins.has(card.isin));
	/** Hidden while signed out/unsupported; the tab itself explains those states. */
	const watchable = $derived(
		watchlist.status === 'ready' ||
			watchlist.status === 'locked' ||
			watchlist.status === 'unlocking' ||
			watchlist.status === 'error'
	);
	/** The plaintext ignore list needs no passkey — signed in is enough. */
	const ignorable = $derived(ignored.status === 'ready');
	const watchTitle = $derived(
		watchlist.status === 'ready'
			? watchlisted
				? `Remove ${card.name} from your watchlist`
				: `Add ${card.name} to your watchlist`
			: 'Unlocks your encrypted watchlist with one passkey tap'
	);

	const equityUrl = $derived(`https://www.boerse-frankfurt.de/equity/${card.isin.toLowerCase()}`);

	const lifecycleTone = $derived(
		card.lifecycle === 'new' || card.lifecycle === 'strengthening' ? 'up' : 'neutral'
	);

	const REASON_TERM_KEYS: Record<string, keyof typeof FINANCIAL_TERMS> = {
		insider_conviction: 'insiderConviction',
		relative_value: 'relativeValue'
	};

	function termForReason(signal: string): FinancialTerm | null {
		const key = REASON_TERM_KEYS[signal];
		return key === undefined ? null : FINANCIAL_TERMS[key];
	}
</script>

<article
	class="flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-sunken shadow-xs"
>
	{#if card.reasons.length > 0 || card.lifecycle !== null || watchable || ignorable}
		<div
			class="flex flex-wrap items-center gap-[6px] border-b border-border-subtle bg-surface-card py-[9px] pr-[14px] pl-5"
		>
			{#if card.lifecycle !== null}
				<Badge tone={lifecycleTone} variant="outline">{card.lifecycle}</Badge>
			{/if}
			{#each card.reasons as reason (reason.signal)}
				{@const term = termForReason(reason.signal)}
				<span class="inline-flex items-center gap-[4px]">
					<Badge tone="neutral">{reason.headline}</Badge>
					{#if term !== null}
						<TermHelp
							term={term.term}
							definition={term.definition}
							clarification={term.clarification}
							align="left"
						/>
					{/if}
				</span>
			{/each}
			{#if watchable || ignorable}
				<span class="ml-auto inline-flex items-center gap-[2px]">
					{#if ignorable}
						<button
							type="button"
							class="card-action-btn inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-sm border-none bg-transparent disabled:cursor-not-allowed disabled:opacity-40"
							aria-label="Ignore {card.name} — hide it from all pages"
							title="Ignore {card.name} — hide it from all pages"
							onclick={() => ignoreConfirm.request(card)}
						>
							<svg
								width="15"
								height="15"
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
						</button>
					{/if}
					{#if watchable}
						<button
							type="button"
							class="card-action-btn inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-sm border-none bg-transparent disabled:cursor-not-allowed disabled:opacity-40"
							class:card-action-btn--on={watchlisted}
							aria-pressed={watchlisted}
							aria-label={watchTitle}
							title={watchTitle}
							disabled={watchlist.status === 'unlocking'}
							onclick={() => void watchlist.toggle(card)}
						>
							<svg
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill={watchlisted ? 'currentColor' : 'none'}
								stroke="currentColor"
								stroke-width="1.7"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M19 21 12 16 5 21 V5 a2 2 0 0 1 2 -2 h10 a2 2 0 0 1 2 2 Z" />
							</svg>
						</button>
					{/if}
				</span>
			{/if}
		</div>
	{/if}
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
				<TermHelp
					term={FINANCIAL_TERMS.pe.term}
					definition={FINANCIAL_TERMS.pe.definition}
					clarification={FINANCIAL_TERMS.pe.clarification}
					align="right"
				>
					<span class="micro-label">P / E vs sector</span>
				</TermHelp>
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
				<TermHelp
					term={FINANCIAL_TERMS.eps.term}
					definition={FINANCIAL_TERMS.eps.definition}
					align="right"
				>
					<span class="font-sans text-2xs font-medium text-text-tertiary uppercase">EPS</span>
				</TermHelp>
				<span class="font-mono text-sm font-medium tabular-nums">
					{card.eps === null ? '—' : `€${card.eps.toFixed(2)}`}
				</span>
				<TermHelp
					term={FINANCIAL_TERMS.ttm.term}
					definition={FINANCIAL_TERMS.ttm.definition}
					align="right"
				>
					<span class="font-mono text-2xs text-text-muted">ttm</span>
				</TermHelp>
			</div>
			<div
				class="flex items-baseline gap-[7px] md:mt-3 md:border-t md:border-border-subtle md:pt-[11px]"
			>
				<TermHelp
					term={FINANCIAL_TERMS.marketCap.term}
					definition={FINANCIAL_TERMS.marketCap.definition}
					clarification={FINANCIAL_TERMS.marketCap.clarification}
					align="right"
				>
					<span class="micro-label whitespace-nowrap">Mkt cap</span>
				</TermHelp>
				<span class="font-mono text-sm font-medium tabular-nums">
					{card.marketCap === null ? '—' : `€${formatCompactEur(card.marketCap)}`}
				</span>
			</div>
			<div class="md:mt-auto md:pt-3">
				<span class="inline-flex items-center gap-[5px]">
					<Link href={FILINGS_SEARCH_URL} external variant="quiet" size="xs">
						Filings
					</Link>
					<TermHelp
						term={FINANCIAL_TERMS.filings.term}
						definition={FINANCIAL_TERMS.filings.definition}
						clarification={FINANCIAL_TERMS.filings.clarification}
						align="right"
					/>
				</span>
			</div>
		</div>
	</div>

	<div class="flex flex-col items-stretch border-t border-border-subtle bg-surface-sunken sm:flex-row">
		<InsiderList insiders={card.insiders} asOf={runDate} isin={card.isin} />
		<NewsList news={card.news} isin={card.isin} />
	</div>
</article>

<style>
	.card-action-btn {
		color: var(--color-text-tertiary);
		transition:
			color 120ms var(--ease-standard),
			background 120ms var(--ease-standard);
	}
	.card-action-btn:hover:not(:disabled) {
		color: var(--ink);
		background: var(--color-surface-hover);
	}
	.card-action-btn--on {
		color: var(--ink);
	}
	.card-action-btn:focus-visible {
		outline: none;
		box-shadow: var(--ring-focus);
	}
</style>
