import { describe, expect, it } from 'vitest';
import { IgnoreConfirmController, type IgnoreCandidate } from './ignoreConfirm.svelte';

const CARD: IgnoreCandidate = { isin: 'DE0007164600', name: 'SAP' };

function makeStubs() {
	const calls = { removed: [] as string[], added: [] as IgnoreCandidate[] };
	const watchlist = { remove: (isin: string) => void calls.removed.push(isin) };
	const ignored = { add: (card: IgnoreCandidate) => void calls.added.push(card) };
	return { watchlist, ignored, calls };
}

describe('IgnoreConfirmController', () => {
	it('request() opens the dialog with a snapshot of the asset', () => {
		const { watchlist, ignored } = makeStubs();
		const controller = new IgnoreConfirmController(watchlist, ignored);
		controller.request(CARD);
		expect(controller.pending).toEqual(CARD);
	});

	it('confirm() removes from the watchlist, adds to the ignore list and closes', () => {
		const { watchlist, ignored, calls } = makeStubs();
		const controller = new IgnoreConfirmController(watchlist, ignored);
		controller.request(CARD);
		controller.confirm();
		expect(calls.removed).toEqual([CARD.isin]);
		expect(calls.added).toEqual([CARD]);
		expect(controller.pending).toBeNull();
	});

	it('confirm() without a pending asset is a no-op', () => {
		const { watchlist, ignored, calls } = makeStubs();
		const controller = new IgnoreConfirmController(watchlist, ignored);
		controller.confirm();
		expect(calls.removed).toEqual([]);
		expect(calls.added).toEqual([]);
	});

	it('cancel() closes without touching either list', () => {
		const { watchlist, ignored, calls } = makeStubs();
		const controller = new IgnoreConfirmController(watchlist, ignored);
		controller.request(CARD);
		controller.cancel();
		expect(controller.pending).toBeNull();
		expect(calls.removed).toEqual([]);
		expect(calls.added).toEqual([]);
	});
});
