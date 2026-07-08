<script lang="ts">
	import ConfirmDialog from '../ds/ConfirmDialog.svelte';
	import { getIgnoreConfirm, getWatchlist } from '$lib/userData/context.js';

	/**
	 * The single confirmation surface for ignoring an asset, shared by the
	 * card eye-off button and the Ignored tab's search results. States the
	 * full consequence up front: hidden everywhere, and — because ignoring
	 * wins over watching — removal from the watchlist. While the encrypted
	 * watchlist is locked its membership is unknowable, so the note is
	 * hedged and the removal happens on the next unlock.
	 */
	const ignoreConfirm = getIgnoreConfirm();
	const watchlist = getWatchlist();

	const card = $derived(ignoreConfirm.pending);
	const watchlisted = $derived(
		watchlist.status === 'ready' && card !== null && watchlist.isins.has(card.isin)
	);
	const watchlistUnknown = $derived(
		watchlist.status === 'locked' ||
			watchlist.status === 'unlocking' ||
			watchlist.status === 'restoring' ||
			watchlist.status === 'error'
	);
</script>

{#if card !== null}
	<ConfirmDialog
		open={true}
		title="Ignore {card.name}?"
		confirmLabel="Ignore asset"
		onconfirm={() => ignoreConfirm.confirm()}
		oncancel={() => ignoreConfirm.cancel()}
	>
		<p class="m-0">
			<span class="font-medium text-text-secondary">{card.name}</span>
			<span class="tabular-nums">({card.isin})</span>
			will be hidden from every page — overview, watchlist, search and the
			MCP tools.
		</p>
		{#if watchlisted}
			<p class="m-0 font-medium text-text-secondary">
				It will also be removed from your watchlist.
			</p>
		{:else if watchlistUnknown}
			<p class="m-0">
				If it is on your watchlist, it will also be removed the next time
				you unlock it.
			</p>
		{/if}
		<p class="m-0 text-text-muted">
			You can stop ignoring it any time from the Ignored tab.
		</p>
	</ConfirmDialog>
{/if}
