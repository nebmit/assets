<script lang="ts">
	import { formatSignedPercent } from '$lib/format.js';

	/**
	 * Directional change indicator: blue = up, amber = down, gray = flat.
	 * `invert` flips the tone (not the sign) for figures where more is a
	 * caution, not a gain — e.g. a P/E premium over the sector median.
	 */
	interface Props {
		value: number;
		decimals?: number;
		showArrow?: boolean;
		variant?: 'text' | 'soft';
		invert?: boolean;
	}

	let { value, decimals = 2, showArrow = true, variant = 'text', invert = false }: Props = $props();

	const dir = $derived(value > 0 ? 'up' : value < 0 ? 'down' : 'flat');
	const toneDir = $derived(
		invert ? (dir === 'up' ? 'down' : dir === 'down' ? 'up' : 'flat') : dir
	);
	const color = $derived(
		{ up: 'var(--dir-up)', down: 'var(--dir-down)', flat: 'var(--dir-flat)' }[toneDir]
	);
	const softBg = $derived(
		{
			up: 'var(--color-dir-up-soft)',
			down: 'var(--color-dir-down-soft)',
			flat: 'var(--color-surface-inset)'
		}[toneDir]
	);
	const arrow = $derived({ up: '↑', down: '↓', flat: '→' }[dir]);
</script>

<span
	class="inline-flex items-center gap-[3px] font-mono text-2xs leading-none font-medium tabular-nums"
	class:rounded-xs={variant === 'soft'}
	class:px-[6px]={variant === 'soft'}
	class:py-[2px]={variant === 'soft'}
	style:color
	style:background={variant === 'soft' ? softBg : 'transparent'}
>
	{#if showArrow}<span style:font-size="0.9em">{arrow}</span>{/if}
	{formatSignedPercent(value, decimals)}
</span>
