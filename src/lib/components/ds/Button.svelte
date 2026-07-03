<script lang="ts">
	import type { Snippet } from "svelte";

	/**
	 * Primary action control. Actions stay ink: primary is solid black,
	 * never blue — blue and amber carry data direction only. Pass `href` to
	 * render a navigating anchor with the same styling (used for links that
	 * should read as buttons, e.g. sign in / log out).
	 */
	interface Props {
		variant?: "primary" | "secondary" | "ghost";
		disabled?: boolean;
		title?: string;
		href?: string;
		target?: string;
		rel?: string;
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
	}

	let {
		variant = "primary",
		disabled = false,
		title,
		href,
		target,
		rel,
		onclick,
		children,
	}: Props = $props();
</script>

{#if href !== undefined}
	<a
		{href}
		{target}
		{rel}
		{title}
		{onclick}
		class="ds-btn ds-btn--{variant} inline-flex h-[26px] cursor-pointer items-center justify-center gap-[6px] rounded-sm px-[12px] font-sans text-xs font-medium tracking-tight whitespace-nowrap no-underline select-none"
	>
		{@render children()}
	</a>
{:else}
	<button
		type="button"
		{disabled}
		{title}
		{onclick}
		class="ds-btn ds-btn--{variant} inline-flex h-[26px] cursor-pointer items-center justify-center gap-[6px] rounded-sm px-[12px] font-sans text-xs font-medium tracking-tight whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-40"
	>
		{@render children()}
	</button>
{/if}

<style>
	.ds-btn {
		border: 1px solid transparent;
		transition:
			background 120ms var(--ease-standard),
			border-color 120ms var(--ease-standard),
			color 120ms var(--ease-standard);
	}
	.ds-btn:focus-visible {
		outline: none;
		box-shadow: var(--ring-focus);
	}
	.ds-btn--primary {
		background: var(--ink);
		color: var(--color-gray-0);
		border-color: var(--ink);
	}
	.ds-btn--primary:hover:not(:disabled) {
		background: var(--color-gray-800);
		border-color: var(--color-gray-800);
	}
	.ds-btn--secondary {
		background: var(--surface-card);
		color: var(--color-text-primary);
		border-color: var(--color-border-default);
	}
	.ds-btn--secondary:hover:not(:disabled) {
		background: var(--color-surface-hover);
		border-color: var(--border-strong);
	}
	.ds-btn--ghost {
		background: transparent;
		color: var(--ink);
	}
	.ds-btn--ghost:hover:not(:disabled) {
		background: var(--color-surface-hover);
	}
</style>
