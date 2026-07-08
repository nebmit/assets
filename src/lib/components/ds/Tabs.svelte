<script lang="ts">
	/**
	 * Segmented tabs: inset track, boxed active segment. Sentence-case
	 * labels; active is ink on card white, inactive is tertiary text. A tab
	 * may carry a small count (e.g. watchlist size) rendered tabular so the
	 * segment doesn't jitter as it changes.
	 */
	interface Tab {
		value: string;
		label: string;
		disabled?: boolean;
		count?: number;
	}

	interface Props {
		tabs: Tab[];
		value: string;
		onchange?: (value: string) => void;
		/** Stretch the segmented control and divide available width across tabs. */
		fullWidth?: boolean;
		/** Tooltip for disabled segments. */
		disabledHint?: string;
	}

	let {
		tabs,
		value,
		onchange,
		fullWidth = false,
		disabledHint = 'Coming soon'
	}: Props = $props();
</script>

<div
	class="gap-[2px] rounded-md bg-surface-inset p-[2px]"
	class:flex={fullWidth}
	class:w-full={fullWidth}
	class:inline-flex={!fullWidth}
>
	{#each tabs as tab (tab.value)}
		{@const active = tab.value === value}
		<button
			type="button"
			disabled={tab.disabled}
			title={tab.disabled ? disabledHint : undefined}
			aria-pressed={active}
			class="inline-flex cursor-pointer items-center gap-[6px] rounded-sm border-none px-[10px] py-[4px] font-sans text-xs font-medium whitespace-nowrap transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-40"
			class:min-w-0={fullWidth}
			class:flex-1={fullWidth}
			class:justify-center={fullWidth}
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
			{#if tab.count !== undefined}
				<span
					class="font-mono text-2xs leading-none tabular-nums"
					class:text-text-tertiary={active}
					class:text-text-muted={!active}>{tab.count}</span
				>
			{/if}
		</button>
	{/each}
</div>
