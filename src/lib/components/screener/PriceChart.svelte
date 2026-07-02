<script lang="ts">
	import {
		CHART_RANGES,
		nearestIndex,
		rangeChangePct,
		sliceByRange,
		sparkGeometry,
		type ChartRange
	} from '$lib/chart.js';
	import { formatDayMonth, formatPrice } from '$lib/format.js';
	import type { PricePoint } from '$lib/screener/types.js';
	import DeltaBadge from '../ds/DeltaBadge.svelte';
	import Sparkline from '../ds/Sparkline.svelte';
	import Tabs from '../ds/Tabs.svelte';

	/**
	 * Card chart column: range toggle, direction-colored sparkline with 52w
	 * hi/lo pinned right, and a hover-scrub (guideline + dot + tooltip that
	 * tracks the nearest data point).
	 */
	interface Props {
		series: PricePoint[];
		runDate: string;
		hi52: number | null;
		lo52: number | null;
	}

	let { series, runDate, hi52, lo52 }: Props = $props();

	const CHART_HEIGHT = 118;
	const STROKE_WIDTH = 1.75;

	let range = $state<ChartRange>('1Y');
	let hoverX = $state<number | null>(null);
	let chartW = $state(0);

	const visible = $derived(sliceByRange(series, range, runDate));
	const closes = $derived(visible.map((p) => p.close));
	const rangeChg = $derived(rangeChangePct(closes));
	const direction = $derived(rangeChg >= 0 ? ('up' as const) : ('down' as const));
	const geometry = $derived(sparkGeometry(closes, chartW, CHART_HEIGHT, STROKE_WIDTH));

	const hover = $derived.by(() => {
		if (hoverX === null || visible.length < 2 || chartW <= 0) return null;
		const idx = nearestIndex(hoverX, chartW, visible.length);
		const [px, py] = geometry.pts[idx];
		return {
			point: visible[idx],
			px,
			py,
			tipLeft: Math.min(Math.max(px - 34, 0), Math.max(chartW - 68, 0))
		};
	});

	function onPointerMove(event: PointerEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		hoverX = event.clientX - rect.left;
	}
</script>

<div class="flex min-w-0 flex-1 flex-col px-[18px] py-[12px]">
	<div class="flex items-center justify-between gap-3">
		<div class="flex items-baseline gap-2">
			<span class="font-sans text-2xs font-medium text-text-secondary">{range}</span>
			<DeltaBadge value={rangeChg} />
		</div>
		<Tabs
			tabs={CHART_RANGES.map((r) => ({ value: r, label: r }))}
			value={range}
			onchange={(v) => (range = v as ChartRange)}
		/>
	</div>
	<div class="mt-2 flex h-[150px] items-stretch">
		{#if series.length === 0}
			<div class="flex flex-1 items-center justify-center font-mono text-xs text-text-muted">
				No price history
			</div>
		{:else}
			<div
				class="relative flex min-w-0 flex-1 items-center"
				role="img"
				aria-label="Trailing {range} price chart"
				bind:clientWidth={chartW}
				onpointermove={onPointerMove}
				onpointerleave={() => (hoverX = null)}
			>
				{#if chartW > 0}
					<Sparkline
						values={closes}
						width={chartW}
						height={CHART_HEIGHT}
						strokeWidth={STROKE_WIDTH}
						{direction}
					/>
				{/if}
				{#if hi52 !== null}
					<span class="absolute top-[6px] right-1 font-mono text-xs text-text-tertiary tabular-nums">
						{formatPrice(hi52)}
					</span>
				{/if}
				{#if lo52 !== null}
					<span
						class="absolute right-1 bottom-[6px] font-mono text-xs text-text-tertiary tabular-nums"
					>
						{formatPrice(lo52)}
					</span>
				{/if}
				{#if hover}
					<div
						class="pointer-events-none absolute inset-y-0 w-px"
						style:left="{hover.px}px"
						style:background="var(--border-strong)"
					></div>
					<div
						class="pointer-events-none absolute h-[6px] w-[6px] rounded-full"
						style:left="{hover.px - 3}px"
						style:top="{hover.py - 3}px"
						style:background="var(--ink)"
						style:border="1.5px solid var(--surface-card)"
					></div>
					<div
						class="pointer-events-none absolute -top-[2px] flex flex-col items-center gap-px rounded-xs border border-border-subtle bg-surface-card px-[6px] py-[3px] shadow-xs"
						style:left="{hover.tipLeft}px"
					>
						<span class="font-mono text-2xs text-text-tertiary tabular-nums">
							{formatDayMonth(hover.point.date)}
						</span>
						<span class="font-mono text-xs font-medium tabular-nums">
							€{formatPrice(hover.point.close)}
						</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
