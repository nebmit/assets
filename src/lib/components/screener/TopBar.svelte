<script lang="ts">
	import Button from '../ds/Button.svelte';
	import Input from '../ds/Input.svelte';
	import Tabs from '../ds/Tabs.svelte';

	/**
	 * App chrome. Watchlist/Ignored, "Use in Claude" and "Log in" are
	 * rendered per the design but disabled — their features ship later.
	 */
	interface Props {
		search: string;
	}

	let { search = $bindable() }: Props = $props();

	const navTabs = [
		{ value: 'overview', label: 'Overview' },
		{ value: 'watchlist', label: 'Watchlist', disabled: true },
		{ value: 'ignored', label: 'Ignored', disabled: true }
	];
</script>

<header
	class="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-border-subtle bg-surface-card px-[18px] py-[11px] sm:px-[22px] lg:px-8 xl:px-10 2xl:px-12"
>
	<div class="flex items-center gap-[9px]">
		<div class="flex flex-col items-center gap-[2px]">
			<svg
				width="17"
				height="14"
				viewBox="0 0 17 14"
				fill="none"
				stroke="var(--ink)"
				stroke-width="1.7"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M2 11 L8.5 2.5 L15 11" />
			</svg>
			<span class="h-[2px] w-[17px] rounded-[1px] bg-blue-600"></span>
		</div>
		<span class="text-md font-medium tracking-tight">assets</span>
	</div>
	<span class="hidden h-5 w-px bg-border-subtle lg:block"></span>
	<div class="hidden lg:block">
		<Tabs tabs={navTabs} value="overview" />
	</div>
	<span class="flex-1"></span>
	<div class="w-full order-last sm:order-none sm:w-[230px]">
		<Input bind:value={search} placeholder="Name, ISIN or WKN" />
	</div>
	<span class="hidden h-5 w-px bg-border-subtle sm:block"></span>
	<Button variant="secondary" disabled title="Coming soon">
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M12 3 V21 M3 12 H21 M5.6 5.6 L18.4 18.4 M18.4 5.6 L5.6 18.4" />
		</svg>
		<span class="hidden md:inline">Use in Claude</span>
	</Button>
	<Button variant="ghost" disabled title="Coming soon">Log in</Button>
</header>
