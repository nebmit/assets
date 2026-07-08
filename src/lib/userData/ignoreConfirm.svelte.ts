/**
 * Coordinates the one flow that touches both lists: adding an asset to the
 * ignore list. Every entry point (the eye-off button on a card, the
 * "Ignore" button on an Ignored-tab search row) calls request() to open the
 * shared confirmation dialog; confirm() then enforces the cross-list rule —
 * an ignored asset is also removed from the watchlist, so "hidden from all
 * pages" stays strictly true. When the encrypted watchlist is still locked,
 * the removal there is deferred to the layout's reconciliation effect,
 * which applies it as soon as the watchlist next unlocks.
 */

import type { CardData } from '$lib/feed/types';

export type IgnoreCandidate = Pick<CardData, 'isin' | 'name'>;

/** Structural slices of the real stores, so tests can stub them. */
interface WatchlistLike {
	remove(isin: string): void;
}

interface IgnoredLike {
	add(card: IgnoreCandidate): void;
}

export class IgnoreConfirmController {
	/** The asset awaiting confirmation; non-null means the dialog is open. */
	pending = $state<IgnoreCandidate | null>(null);

	private readonly watchlist: WatchlistLike;
	private readonly ignored: IgnoredLike;

	constructor(watchlist: WatchlistLike, ignored: IgnoredLike) {
		this.watchlist = watchlist;
		this.ignored = ignored;
	}

	/** Opens the confirmation dialog for an asset. */
	request(card: IgnoreCandidate): void {
		this.pending = { isin: card.isin, name: card.name };
	}

	confirm(): void {
		const card = this.pending;
		if (card === null) return;
		// remove() is a no-op while the watchlist is locked; the layout's
		// reconciliation effect finishes the job after the next unlock.
		this.watchlist.remove(card.isin);
		this.ignored.add(card);
		this.pending = null;
	}

	cancel(): void {
		this.pending = null;
	}
}
