<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Compact status/label chip. Tones map to meaning: up (blue), down
	 * (amber), neutral (gray) — direction or category, never good/bad.
	 */
	interface Props {
		tone?: 'neutral' | 'up' | 'down' | 'ink';
		variant?: 'soft' | 'outline' | 'solid';
		children: Snippet;
	}

	let { tone = 'neutral', variant = 'soft', children }: Props = $props();

	const tones = {
		neutral: {
			fg: 'var(--color-text-secondary)',
			soft: 'var(--color-surface-inset)',
			border: 'var(--color-border-default)',
			solid: 'var(--color-gray-700)'
		},
		up: {
			fg: 'var(--dir-up)',
			soft: 'var(--color-dir-up-soft)',
			border: 'var(--color-dir-up-border)',
			solid: 'var(--dir-up)'
		},
		down: {
			fg: 'var(--dir-down)',
			soft: 'var(--color-dir-down-soft)',
			border: 'var(--color-dir-down-border)',
			solid: 'var(--dir-down)'
		},
		ink: {
			fg: 'var(--ink)',
			soft: 'var(--color-surface-inset)',
			border: 'var(--border-strong)',
			solid: 'var(--ink)'
		}
	} as const;

	const t = $derived(tones[tone]);
	const bg = $derived(variant === 'soft' ? t.soft : variant === 'solid' ? t.solid : 'transparent');
	const fg = $derived(variant === 'solid' ? 'var(--color-gray-0)' : t.fg);
	const borderColor = $derived(variant === 'outline' ? t.border : 'transparent');
</script>

<span
	class="inline-flex items-center gap-[5px] rounded-xs px-[6px] py-px font-sans text-2xs leading-[1.4] font-medium whitespace-nowrap"
	style:background={bg}
	style:color={fg}
	style:border="1px solid {borderColor}"
>
	{@render children()}
</span>
