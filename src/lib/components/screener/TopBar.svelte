<script lang="ts">
	import Badge from '../ds/Badge.svelte';
	import Button from '../ds/Button.svelte';
	import Input from '../ds/Input.svelte';
	import Tabs from '../ds/Tabs.svelte';

	/**
	 * App chrome. "Use in Claude" opens Claude's add-custom-connector flow.
	 * Claude does not currently honor connector prefill params, so the MCP URL is
	 * copied separately. Watchlist/Ignored are rendered per the design but
	 * disabled — their features ship later. Sign in / log out are live, driven by
	 * the SSO session (links resolve on the SSO host).
	 */
	interface Props {
		search: string;
		user: { uuid: string; elevated: boolean } | null;
		signInUrl: string;
		signOutUrl: string;
		connectorUrl: string;
		connectorName: string;
		mcpServerUrl: string;
	}

	let {
		search = $bindable(),
		user,
		signInUrl,
		signOutUrl,
		connectorUrl,
		connectorName,
		mcpServerUrl
	}: Props = $props();

	let copiedMcpUrl = $state(false);
	let copyReset: ReturnType<typeof setTimeout> | undefined;

	const navTabs = [
		{ value: 'overview', label: 'Overview' },
		{ value: 'watchlist', label: 'Watchlist', disabled: true },
		{ value: 'ignored', label: 'Ignored', disabled: true }
	];

	async function copyMcpUrl() {
		if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return;

		await navigator.clipboard.writeText(mcpServerUrl);
		copiedMcpUrl = true;
		clearTimeout(copyReset);
		copyReset = setTimeout(() => {
			copiedMcpUrl = false;
		}, 1600);
	}
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
	<Button
		variant="ghost"
		onclick={copyMcpUrl}
		title={copiedMcpUrl ? 'Copied Remote MCP server URL' : `Copy the Remote MCP server URL Claude asks for: ${mcpServerUrl}`}
	>
		{#if copiedMcpUrl}
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M20 6 L9 17 L4 12" />
			</svg>
		{:else}
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<rect x="9" y="9" width="13" height="13" rx="2" />
				<path d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1" />
			</svg>
		{/if}
		<span class="hidden md:inline">
			{copiedMcpUrl ? 'Copied Remote MCP URL' : 'Copy Remote MCP URL'}
		</span>
	</Button>
	<Button
		variant="secondary"
		href={connectorUrl}
		target="_blank"
		rel="noopener noreferrer"
		title="Open Claude Connectors. Paste the copied URL into Claude's Remote MCP server URL field. Use name: {connectorName}"
	>
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
	{#if user}
		<span class="hidden h-5 w-px bg-border-subtle sm:block"></span>
		<span class="flex items-center gap-[7px]" title="Account {user.uuid}">
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="text-text-tertiary"
				aria-hidden="true"
			>
				<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
				<circle cx="12" cy="7" r="4" />
			</svg>
			<span class="font-mono text-2xs text-text-tertiary tabular-nums">{user.uuid.slice(0, 8)}</span>
			{#if user.elevated}
				<Badge tone="ink" variant="soft">admin</Badge>
			{/if}
		</span>
		<Button variant="ghost" href={signOutUrl}>Log out</Button>
	{:else}
		<Button variant="ghost" href={signInUrl}>Log in</Button>
	{/if}
</header>
