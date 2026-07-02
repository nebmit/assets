<script lang="ts">
	/**
	 * Segmented tabs: inset track, boxed active segment. Sentence-case
	 * labels; active is ink on card white, inactive is tertiary text.
	 */
	interface Tab {
		value: string;
		label: string;
		disabled?: boolean;
	}

	interface Props {
		tabs: Tab[];
		value: string;
		onchange?: (value: string) => void;
	}

	let { tabs, value, onchange }: Props = $props();
</script>

<div class="inline-flex gap-[2px] rounded-md bg-surface-inset p-[2px]">
	{#each tabs as tab (tab.value)}
		{@const active = tab.value === value}
		<button
			type="button"
			disabled={tab.disabled}
			title={tab.disabled ? 'Coming soon' : undefined}
			class="inline-flex cursor-pointer items-center rounded-sm border-none px-[10px] py-[4px] font-sans text-xs font-medium whitespace-nowrap transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40"
			class:bg-surface-card={active}
			class:shadow-xs={active}
			class:text-text-primary={active}
			class:bg-transparent={!active}
			class:text-text-tertiary={!active}
			style:transition-timing-function="var(--ease-standard)"
			onclick={() => {
				if (!active) onchange?.(tab.value);
			}}
		>
			{tab.label}
		</button>
	{/each}
</div>
