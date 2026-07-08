import { describe, expect, it } from 'vitest';
import type { Db } from '../db/index.js';
import type { FeedPayload } from '../../feed/types.js';
import { FEED_VIEWS, type FeedViewSlug } from '../../feed/views.js';
import type { CardData } from '../../feed/types.js';
import { FeedCache } from './cache.js';

const db = {} as Db;

function payloadFor(runDate: string): FeedPayload {
	const cardsByView = {} as Record<FeedViewSlug, CardData[]>;
	for (const view of FEED_VIEWS) cardsByView[view.slug] = [];
	return { runDate, universeSize: 100, views: [...FEED_VIEWS], cardsByView };
}

/** Test harness: counting stubs for the two DB operations plus a manual clock. */
function harness(initialRunDate: string | null) {
	const state = { runDate: initialRunDate, probes: 0, builds: 0, nowMs: 0 };
	const cache = new FeedCache(
		async () => {
			state.probes++;
			return state.runDate;
		},
		async () => {
			state.builds++;
			if (state.runDate === null) throw new Error('build without run');
			return payloadFor(state.runDate);
		},
		() => state.nowMs
	);
	return { cache, state };
}

describe('FeedCache', () => {
	it('builds once and serves from memory within the revalidation window', async () => {
		const { cache, state } = harness('2026-07-07');
		const first = await cache.get(db);
		state.nowMs = 59_000;
		const second = await cache.get(db);
		expect(first?.runDate).toBe('2026-07-07');
		expect(second).toBe(first);
		expect(state.probes).toBe(1);
		expect(state.builds).toBe(1);
	});

	it('revalidates with only the run-date probe when nothing changed', async () => {
		const { cache, state } = harness('2026-07-07');
		const first = await cache.get(db);
		state.nowMs = 61_000;
		const second = await cache.get(db);
		expect(second).toBe(first);
		expect(state.probes).toBe(2);
		expect(state.builds).toBe(1);
		// The successful probe restarts the window.
		state.nowMs = 120_000;
		await cache.get(db);
		expect(state.probes).toBe(2);
	});

	it('rebuilds when a new run lands', async () => {
		const { cache, state } = harness('2026-07-07');
		await cache.get(db);
		state.runDate = '2026-07-08';
		state.nowMs = 61_000;
		const fresh = await cache.get(db);
		expect(fresh?.runDate).toBe('2026-07-08');
		expect(state.builds).toBe(2);
	});

	it('collapses concurrent misses into one build', async () => {
		const { cache, state } = harness('2026-07-07');
		const [a, b] = await Promise.all([cache.get(db), cache.get(db)]);
		expect(a).toBe(b);
		expect(state.probes).toBe(1);
		expect(state.builds).toBe(1);
	});

	it('serves null uncached-forever-free: re-probes after the window', async () => {
		const { cache, state } = harness(null);
		expect(await cache.get(db)).toBeNull();
		expect(state.builds).toBe(0);
		state.runDate = '2026-07-08';
		state.nowMs = 61_000;
		const fresh = await cache.get(db);
		expect(fresh?.runDate).toBe('2026-07-08');
	});

	it('does not cache failures', async () => {
		let probes = 0;
		const cache = new FeedCache(
			async () => {
				probes++;
				if (probes === 1) throw new Error('db down');
				return '2026-07-07';
			},
			async () => payloadFor('2026-07-07'),
			() => 0
		);
		await expect(cache.get(db)).rejects.toThrow('db down');
		expect((await cache.get(db))?.runDate).toBe('2026-07-07');
	});
});
