<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		term: string;
		definition: string;
		clarification?: string;
		align?: 'left' | 'center' | 'right';
		children?: Snippet;
	}

	let { term, definition, clarification, align = 'center', children }: Props = $props();

	const tooltipId = $props.id();
	const ariaLabel = $derived(
		`${term}: ${definition}${clarification === undefined ? '' : `. ${clarification}`}`
	);
</script>

<span class="term-help">
	{#if children}
		<span class="term-help__label">
			{@render children()}
		</span>
	{/if}
	<span class="term-help__anchor">
		<button
			type="button"
			class="term-help__trigger"
			aria-label={ariaLabel}
			aria-describedby={tooltipId}
		>
			<svg
				class="term-help__icon"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.4"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M9 9a3 3 0 1 1 5.7 1.3c-.9.7-1.7 1.3-1.7 2.7" />
				<path d="M12 17h.01" />
			</svg>
		</button>
		<span id={tooltipId} role="tooltip" class="term-help__tooltip" data-align={align}>
			<span class="term-help__definition">{definition}</span>
			{#if clarification !== undefined}
				<span class="term-help__clarification">{clarification}</span>
			{/if}
		</span>
	</span>
</span>

<style>
	.term-help {
		display: inline-flex;
		min-width: 0;
		align-items: baseline;
		gap: 3px;
		vertical-align: baseline;
	}

	.term-help__label {
		min-width: 0;
	}

	.term-help__anchor {
		position: relative;
		display: inline-flex;
		flex: none;
		align-items: center;
	}

	.term-help__trigger {
		display: inline-block;
		box-sizing: border-box;
		border: 0;
		background: transparent;
		color: currentColor;
		cursor: help;
		line-height: 1;
		opacity: 0.6;
		padding: 0;
		transition:
			color 120ms var(--ease-standard),
			opacity 120ms var(--ease-standard);
	}

	.term-help__trigger:hover,
	.term-help__trigger:focus-visible {
		color: var(--color-text-primary);
		opacity: 1;
	}

	.term-help__trigger:focus-visible {
		border-radius: var(--radius-xs);
		outline: none;
		box-shadow: var(--ring-focus);
	}

	.term-help__icon {
		display: inline-block;
		width: 0.88em;
		height: 0.88em;
		transform: translateY(-0.06em);
	}

	.term-help__tooltip {
		position: absolute;
		top: calc(100% + 6px);
		z-index: 40;
		display: flex;
		width: max-content;
		max-width: min(250px, calc(100vw - 32px));
		flex-direction: column;
		gap: 2px;
		border: 1px solid color-mix(in srgb, var(--color-gray-0) 10%, transparent);
		border-radius: var(--radius-sm);
		background: var(--color-gray-950);
		box-shadow: var(--shadow-popover);
		color: var(--color-gray-0);
		font-family: var(--font-sans);
		font-size: var(--text-2xs);
		font-weight: 400;
		letter-spacing: 0;
		line-height: 1.35;
		opacity: 0;
		padding: 7px 8px;
		pointer-events: none;
		text-transform: none;
		transform: translateY(-2px);
		transition:
			opacity 120ms var(--ease-standard),
			transform 120ms var(--ease-standard),
			visibility 120ms var(--ease-standard);
		visibility: hidden;
		white-space: normal;
	}

	.term-help__tooltip[data-align='left'] {
		left: 0;
	}

	.term-help__tooltip[data-align='center'] {
		left: 50%;
		transform: translate(-50%, -2px);
	}

	.term-help__tooltip[data-align='right'] {
		right: 0;
	}

	.term-help__anchor:hover .term-help__tooltip,
	.term-help__anchor:focus-within .term-help__tooltip {
		opacity: 1;
		transform: translateY(0);
		visibility: visible;
	}

	.term-help__anchor:hover .term-help__tooltip[data-align='center'],
	.term-help__anchor:focus-within .term-help__tooltip[data-align='center'] {
		transform: translate(-50%, 0);
	}

	.term-help__definition {
		display: block;
		font-weight: 600;
	}

	.term-help__clarification {
		display: block;
		color: var(--color-gray-200);
	}
</style>
