<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Text link. Ink with a hairline underline that firms up on hover —
	 * never blue, so links don't read as a directional signal. External
	 * links carry a small north-east arrow and open in a new tab.
	 */
	interface Props {
		href: string;
		external?: boolean;
		variant?: 'inline' | 'quiet';
		size?: 'xs' | 'sm' | 'base';
		children: Snippet;
	}

	let { href, external = false, variant = 'inline', size, children }: Props = $props();

	const isExternal = $derived(external || /^https?:\/\//.test(href));
	const sizeClass = $derived(
		size === 'xs' ? 'text-2xs' : size === 'sm' ? 'text-sm' : size === 'base' ? 'text-base' : ''
	);
</script>

<a
	{href}
	target={isExternal ? '_blank' : undefined}
	rel={isExternal ? 'noopener noreferrer' : undefined}
	class="ds-link cursor-pointer border-b border-border-default pb-px no-underline transition-colors duration-[120ms] {sizeClass}"
	class:text-text-secondary={variant === 'quiet'}
	class:text-text-primary={variant === 'inline'}
	style:transition-timing-function="var(--ease-standard)"
>
	{@render children()}{#if isExternal}<svg
			width="0.72em"
			height="0.72em"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.4"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="ml-[3px] inline-block shrink-0 opacity-60"
			style:transform="translateY(-0.06em)"
			aria-hidden="true"
		>
			<line x1="7" y1="17" x2="17" y2="7" />
			<polyline points="7 7 17 7 17 17" />
		</svg>{/if}
</a>

<style>
	.ds-link:hover {
		color: var(--color-text-primary);
		border-bottom-color: var(--color-text-primary);
	}
</style>
