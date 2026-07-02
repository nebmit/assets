<script lang="ts">
	/**
	 * Text field: hairline border, ink focus ring, no fill.
	 */
	interface Props {
		value?: string;
		placeholder?: string;
	}

	let { value = $bindable(''), placeholder }: Props = $props();
</script>

<input
	type="text"
	bind:value
	{placeholder}
	class="ds-input h-[26px] w-full min-w-0 rounded-sm border border-border-default bg-surface-card px-[10px] font-sans text-xs text-text-primary outline-none placeholder:text-text-muted"
/>

<style>
	.ds-input {
		transition:
			border-color 120ms var(--ease-standard),
			box-shadow 120ms var(--ease-standard);
	}
	.ds-input:focus {
		border-color: var(--ink);
		box-shadow: var(--ring-focus);
	}
</style>
