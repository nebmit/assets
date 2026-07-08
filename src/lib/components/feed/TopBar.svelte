<script lang="ts">
	import { tick } from "svelte";
	import Badge from "../ds/Badge.svelte";
	import Button from "../ds/Button.svelte";
	import Input from "../ds/Input.svelte";
	import Tabs from "../ds/Tabs.svelte";

	/**
	 * App chrome. "Use in Claude" opens Claude's add-custom-connector flow.
	 * Claude does not currently honor connector prefill params, so the MCP URL is
	 * copied separately. Sign in / log out are live, driven by the SSO session
	 * (links resolve on the SSO host).
	 */
	interface Props {
		search: string;
		tab: string;
		ontabchange?: (value: string) => void;
		/** Watchlist size shown on its tab; null hides the count (locked/signed out). */
		watchlistCount?: number | null;
		/** Ignore-list size shown on its tab; null hides the count (locked/signed out). */
		ignoredCount?: number | null;
		user: { uuid: string; elevated: boolean } | null;
		signInUrl: string;
		signOutUrl: string;
		connectorUrl: string;
		connectorName: string;
		mcpServerUrl: string;
	}

	let {
		search = $bindable(),
		tab,
		ontabchange,
		watchlistCount = null,
		ignoredCount = null,
		user,
		signInUrl,
		signOutUrl,
		connectorUrl,
		connectorName,
		mcpServerUrl,
	}: Props = $props();

	let copiedMcpUrl = $state(false);
	let copyReset: ReturnType<typeof setTimeout> | undefined;
	let mobileSearchOpen = $state(false);
	let mobileMenuOpen = $state(false);
	let mobileSearchInput: HTMLInputElement | undefined;

	const navTabs = $derived([
		{ value: "overview", label: "Overview" },
		{
			value: "watchlist",
			label: "Watchlist",
			count: watchlistCount ?? undefined,
		},
		{
			value: "ignored",
			label: "Ignored",
			count: ignoredCount ?? undefined,
		},
	]);
	const mobileSearchVisible = $derived(
		mobileSearchOpen || search.trim() !== "",
	);

	async function toggleMobileSearch() {
		mobileMenuOpen = false;
		if (mobileSearchOpen && search.trim() === "") {
			mobileSearchOpen = false;
			return;
		}

		mobileSearchOpen = true;
		await tick();
		mobileSearchInput?.focus();
	}

	function clearMobileSearch() {
		search = "";
		mobileSearchOpen = false;
	}

	async function copyMcpUrl() {
		if (
			typeof navigator === "undefined" ||
			navigator.clipboard === undefined
		)
			return;

		await navigator.clipboard.writeText(mcpServerUrl);
		copiedMcpUrl = true;
		clearTimeout(copyReset);
		copyReset = setTimeout(() => {
			copiedMcpUrl = false;
		}, 1600);
	}
</script>

{#snippet brandLockup()}
	<div class="flex min-w-0 items-center gap-[9px]">
		<div class="flex shrink-0 flex-col items-center gap-[2px]">
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
{/snippet}

{#snippet searchIcon()}
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="11" cy="11" r="7" />
		<path d="M20 20 L16.5 16.5" />
	</svg>
{/snippet}

{#snippet closeIcon()}
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M18 6 L6 18 M6 6 L18 18" />
	</svg>
{/snippet}

{#snippet menuIcon()}
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="3"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path d="M12 5 H12.01 M12 12 H12.01 M12 19 H12.01" />
	</svg>
{/snippet}

{#snippet copyIcon()}
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
			<path
				d="M5 15 H4 a2 2 0 0 1 -2 -2 V4 a2 2 0 0 1 2 -2 h9 a2 2 0 0 1 2 2 v1"
			/>
		</svg>
	{/if}
{/snippet}

{#snippet claudeIcon()}
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
		<path
			d="M12 3 V21 M3 12 H21 M5.6 5.6 L18.4 18.4 M18.4 5.6 L5.6 18.4"
		/>
	</svg>
{/snippet}

{#snippet accountIcon()}
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
{/snippet}

<header
	class="border-b border-border-subtle bg-surface-card px-[12px] py-[8px] sm:hidden"
>
	<div class="flex h-[30px] items-center gap-[8px]">
		{@render brandLockup()}
		<span class="flex-1"></span>
		<button
			type="button"
			class="mobile-icon-btn"
			class:mobile-active={mobileSearchVisible}
			aria-label="Search assets"
			aria-expanded={mobileSearchVisible}
			title="Search assets"
			onclick={toggleMobileSearch}
		>
			{@render searchIcon()}
		</button>
		<div class="relative">
			<button
				type="button"
				class="mobile-icon-btn"
				class:mobile-active={mobileMenuOpen}
				aria-label="Open actions"
				aria-haspopup="true"
				aria-expanded={mobileMenuOpen}
				title="Actions"
				onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
			>
				{@render menuIcon()}
			</button>
			{#if mobileMenuOpen}
				<button
					type="button"
					class="fixed inset-0 z-20 cursor-default border-0 bg-transparent p-0"
					tabindex="-1"
					aria-label="Close actions"
					onclick={() => (mobileMenuOpen = false)}
				></button>
				<div
					class="absolute top-[calc(100%+6px)] right-0 z-30 w-[238px] rounded-md border border-border-subtle bg-surface-card p-[5px] shadow-popover"
				>
					<button
						type="button"
						class="mobile-menu-item"
						title={copiedMcpUrl
							? "Copied Remote MCP server URL"
							: `Copy the Remote MCP server URL Claude asks for: ${mcpServerUrl}`}
						onclick={() => void copyMcpUrl()}
					>
						<span class="shrink-0">{@render copyIcon()}</span>
						<span
							>{copiedMcpUrl
								? "Copied Remote MCP URL"
								: "Copy Remote MCP URL"}</span
						>
					</button>
					<a
						class="mobile-menu-item"
						href={connectorUrl}
						target="_blank"
						rel="noopener noreferrer"
						title="Open Claude Connectors. Paste the copied URL into Claude's Remote MCP server URL field. Use name: {connectorName}"
						onclick={() => (mobileMenuOpen = false)}
					>
						<span class="shrink-0">{@render claudeIcon()}</span>
						<span>Use in Claude</span>
					</a>
					{#if user}
						<div class="my-[5px] h-px bg-border-subtle"></div>
						<div
							class="flex items-center gap-[7px] px-2 py-[7px]"
							title="Account {user.uuid}"
						>
							{@render accountIcon()}
							<span
								class="min-w-0 flex-1 font-mono text-2xs text-text-tertiary tabular-nums"
								>{user.uuid.slice(0, 8)}</span
							>
							{#if user.elevated}
								<Badge tone="ink" variant="soft">admin</Badge>
							{/if}
						</div>
						<a
							class="mobile-menu-item"
							href={signOutUrl}
							onclick={() => (mobileMenuOpen = false)}
							>Log out</a
						>
					{/if}
				</div>
			{/if}
		</div>
		{#if !user}
			<Button variant="ghost" href={signInUrl}>Log in</Button>
		{/if}
	</div>

	{#if mobileSearchVisible}
		<div class="mt-[8px] flex items-center gap-[6px]">
			<input
				bind:this={mobileSearchInput}
				type="text"
				bind:value={search}
				placeholder="Name, ISIN or WKN"
				class="mobile-search-input h-[30px] w-full min-w-0 rounded-sm border border-border-default bg-surface-card px-[10px] font-sans text-xs text-text-primary outline-none placeholder:text-text-muted"
				onkeydown={(event) => {
					if (event.key === "Escape" && search.trim() === "") {
						mobileSearchOpen = false;
					}
				}}
			/>
			{#if search.trim() !== ""}
				<button
					type="button"
					class="mobile-icon-btn shrink-0"
					aria-label="Clear search"
					title="Clear search"
					onclick={clearMobileSearch}
				>
					{@render closeIcon()}
				</button>
			{/if}
		</div>
	{/if}

	<div class="mt-[8px]">
		<Tabs
			tabs={navTabs}
			value={tab}
			onchange={(value) => {
				mobileMenuOpen = false;
				ontabchange?.(value);
			}}
			fullWidth
		/>
	</div>
</header>

<header
	class="hidden flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-border-subtle bg-surface-card px-[18px] py-[11px] sm:flex sm:px-[22px] lg:px-8 xl:px-10 2xl:px-12"
>
	{@render brandLockup()}
	<span class="hidden h-5 w-px bg-border-subtle sm:block"></span>
	<Tabs tabs={navTabs} value={tab} onchange={ontabchange} />

	<span class="flex-1"></span>
	<div class="w-full order-last sm:order-none sm:w-[230px]">
		<Input bind:value={search} placeholder="Name, ISIN or WKN" />
	</div>
	<span class="hidden h-5 w-px bg-border-subtle sm:block"></span>
	<Button
		variant="ghost"
		onclick={copyMcpUrl}
		title={copiedMcpUrl
			? "Copied Remote MCP server URL"
			: `Copy the Remote MCP server URL Claude asks for: ${mcpServerUrl}`}
	>
		{@render copyIcon()}
		<span class="hidden md:inline">
			{copiedMcpUrl ? "Copied Remote MCP URL" : "Copy Remote MCP URL"}
		</span>
	</Button>
	<Button
		variant="secondary"
		href={connectorUrl}
		target="_blank"
		rel="noopener noreferrer"
		title="Open Claude Connectors. Paste the copied URL into Claude's Remote MCP server URL field. Use name: {connectorName}"
	>
		{@render claudeIcon()}
		<span class="hidden md:inline">Use in Claude</span>
	</Button>
	{#if user}
		<span class="hidden h-5 w-px bg-border-subtle sm:block"></span>
		<span class="flex items-center gap-[7px]" title="Account {user.uuid}">
			{@render accountIcon()}
			<span class="font-mono text-2xs text-text-tertiary tabular-nums"
				>{user.uuid.slice(0, 8)}</span
			>
			{#if user.elevated}
				<Badge tone="ink" variant="soft">admin</Badge>
			{/if}
		</span>
		<Button variant="ghost" href={signOutUrl}>Log out</Button>
	{:else}
		<Button variant="ghost" href={signInUrl}>Log in</Button>
	{/if}
</header>

<style>
	.mobile-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		flex: 0 0 auto;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--ink);
		transition:
			background 120ms var(--ease-standard),
			border-color 120ms var(--ease-standard),
			color 120ms var(--ease-standard);
	}
	.mobile-icon-btn:hover {
		background: var(--color-surface-hover);
	}
	.mobile-icon-btn.mobile-active {
		background: var(--color-surface-hover);
	}
	.mobile-icon-btn:focus-visible,
	.mobile-menu-item:focus-visible,
	.mobile-search-input:focus {
		outline: none;
		box-shadow: var(--ring-focus);
	}
	.mobile-search-input {
		transition:
			border-color 120ms var(--ease-standard),
			box-shadow 120ms var(--ease-standard);
	}
	.mobile-search-input:focus {
		border-color: var(--ink);
	}
	.mobile-menu-item {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		width: 100%;
		border-radius: var(--radius-sm);
		padding: 7px 8px;
		color: var(--color-text-primary);
		font-family: var(--font-sans);
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1.2;
		text-align: left;
		text-decoration: none;
		white-space: nowrap;
		transition: background 120ms var(--ease-standard);
	}
	button.mobile-menu-item {
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.mobile-menu-item:hover {
		background: var(--color-surface-hover);
	}
</style>
