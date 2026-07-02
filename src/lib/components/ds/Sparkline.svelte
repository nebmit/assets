<script lang="ts">
	import { sparkGeometry } from '$lib/chart.js';

	/**
	 * Compact inline trend — no axes, no grid, just the shape of the series.
	 * Colored by direction (blue up / amber down) with a faint area fill;
	 * the last point gets a dot. The one permitted gradient in the system.
	 */
	interface Props {
		values: number[];
		width: number;
		height?: number;
		strokeWidth?: number;
		direction: 'up' | 'down' | 'flat';
	}

	let { values, width, height = 118, strokeWidth = 1.75, direction }: Props = $props();

	const gid = $props.id();
	const geometry = $derived(sparkGeometry(values, width, height, strokeWidth));
	const color = $derived(
		{ up: 'var(--dir-up)', down: 'var(--dir-down)', flat: 'var(--dir-flat)' }[direction]
	);
	const last = $derived(geometry.pts.at(-1));
</script>

<svg {width} {height} class="block overflow-visible" aria-hidden="true">
	{#if geometry.pts.length > 0}
		<defs>
			<linearGradient id="spark-{gid}" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={color} stop-opacity="0.14" />
				<stop offset="100%" stop-color={color} stop-opacity="0" />
			</linearGradient>
		</defs>
		<path d={geometry.areaPath} fill="url(#spark-{gid})" />
		<path
			d={geometry.linePath}
			fill="none"
			stroke={color}
			stroke-width={strokeWidth}
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		{#if last}
			<circle cx={last[0]} cy={last[1]} r={strokeWidth + 0.5} fill={color} />
		{/if}
	{/if}
</svg>
