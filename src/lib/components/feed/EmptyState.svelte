<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Graceful blank/error panels the design doesn't cover: fresh installs
	 * without a signal run, an unreachable database, a run where nothing
	 * passed the composite gate, a search with no matches — and the
	 * encrypted user data's lifecycle states (signed out, locked behind the
	 * passkey, unsupported browser, empty, sync error). The lock/unsupported/
	 * error states belong to the shared keyring, so their copy is list-
	 * agnostic. `action` renders below the hint for a button or link that
	 * resolves the state.
	 */
	interface Props {
		kind:
			| 'no-runs'
			| 'db-error'
			| 'no-passers'
			| 'no-matches'
			| 'watchlist-signed-out'
			| 'watchlist-empty'
			| 'ignored-signed-out'
			| 'ignored-empty'
			| 'ignored-error'
			| 'user-data-locked'
			| 'user-data-unsupported'
			| 'user-data-error';
		query?: string;
		runDate?: string;
		/** Overrides the kind's default hint (e.g. a concrete error message). */
		detail?: string;
		action?: Snippet;
	}

	let { kind, query = '', runDate = '', detail, action }: Props = $props();

	const content = $derived(
		{
			'no-runs': {
				headline: 'No signal run yet',
				hint: 'Run the pipeline: npm run worker -- run'
			},
			'db-error': {
				headline: 'Database unavailable',
				hint: 'Check DATABASE_URL and try again'
			},
			'no-passers': {
				headline: 'Nothing surfaced today',
				hint: `Run of ${runDate} · no signal cleared its materiality floor — a quiet day is a valid answer`
			},
			'no-matches': {
				headline: 'No matches',
				hint: `Nothing matches “${query}”`
			},
			'watchlist-signed-out': {
				headline: 'Sign in to build a watchlist',
				hint: 'Your watchlist is encrypted with your passkey — no password, nothing readable on our servers'
			},
			'watchlist-empty': {
				headline: 'Nothing watchlisted yet',
				hint: 'Tap the bookmark on any asset card to pin it here'
			},
			'ignored-signed-out': {
				headline: 'Sign in to ignore assets',
				hint: 'Ignored assets are hidden from every page and from the MCP tools of your account'
			},
			'ignored-empty': {
				headline: 'Nothing ignored',
				hint: 'Ignored assets disappear from every page. Click the eye-off icon on any card, or search above to pick one'
			},
			'ignored-error': {
				headline: 'Could not load your ignore list',
				hint: 'A network or server hiccup — nothing was lost'
			},
			'user-data-locked': {
				headline: 'Encrypted data locked',
				hint: 'Encrypted with your passkey · one tap to unlock'
			},
			'user-data-unsupported': {
				headline: 'Passkey encryption unavailable',
				hint: 'This passkey or browser did not return an encryption key. Synced platform passkeys (iCloud Keychain, Google Password Manager) on current browsers are the reliable path'
			},
			'user-data-error': {
				headline: 'Could not unlock your encrypted data',
				hint: 'Something went wrong during the passkey ceremony'
			}
		}[kind]
	);
</script>

<div class="flex justify-center px-[22px] py-16">
	<div
		class="flex w-full max-w-[420px] flex-col items-center gap-3 rounded-md border border-border-subtle bg-surface-card px-8 py-10 text-center shadow-xs"
	>
		<div class="flex flex-col items-center gap-[3px]">
			<svg
				width="22"
				height="18"
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
			<span class="h-[2px] w-[22px] rounded-[1px] bg-blue-600"></span>
		</div>
		<span class="text-md font-medium">{content.headline}</span>
		<span class="font-mono text-xs text-text-tertiary">{detail ?? content.hint}</span>
		{#if action !== undefined}
			<div class="mt-2 flex flex-col items-center gap-3">
				{@render action()}
			</div>
		{/if}
	</div>
</div>
