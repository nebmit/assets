import { describe, expect, it, vi } from 'vitest';
import { SessionStore, type SessionTransport } from './sessions.js';

function makeClock(start = 0) {
	let time = start;
	return { now: () => time, advance: (ms: number) => (time += ms) };
}

function makeTransport(): SessionTransport & { close: ReturnType<typeof vi.fn> } {
	return {
		handleRequest: async () => new Response(),
		close: vi.fn(async () => {})
	};
}

describe('SessionStore', () => {
	it('stores and returns transports by session id', () => {
		const store = new SessionStore(60_000, 10);
		const transport = makeTransport();
		store.set('s1', transport);
		expect(store.get('s1')).toBe(transport);
		expect(store.get('unknown')).toBeUndefined();
	});

	it('expires idle sessions and closes their transports', () => {
		const clock = makeClock();
		const store = new SessionStore(60_000, 10, clock.now);
		const transport = makeTransport();
		store.set('s1', transport);
		clock.advance(59_000);
		expect(store.get('s1')).toBe(transport);
		// the get above refreshed the idle timer
		clock.advance(59_000);
		expect(store.get('s1')).toBe(transport);
		clock.advance(60_000);
		expect(store.get('s1')).toBeUndefined();
		expect(transport.close).toHaveBeenCalledOnce();
	});

	it('caps stored sessions, evicting the least recently seen', () => {
		const clock = makeClock();
		const store = new SessionStore(60_000, 2, clock.now);
		const [t1, t2, t3] = [makeTransport(), makeTransport(), makeTransport()];
		store.set('s1', t1);
		clock.advance(1000);
		store.set('s2', t2);
		clock.advance(1000);
		store.get('s1'); // s2 is now least recently seen
		store.set('s3', t3);
		expect(store.size).toBe(2);
		expect(store.get('s2')).toBeUndefined();
		expect(t2.close).toHaveBeenCalledOnce();
		expect(store.get('s1')).toBe(t1);
		expect(store.get('s3')).toBe(t3);
	});

	it('prunes expired sessions before evicting live ones', () => {
		const clock = makeClock();
		const store = new SessionStore(60_000, 2, clock.now);
		const stale = makeTransport();
		store.set('stale', stale);
		clock.advance(61_000);
		const live = makeTransport();
		store.set('live', live);
		store.set('new', makeTransport());
		expect(stale.close).toHaveBeenCalledOnce();
		expect(store.get('live')).toBe(live);
	});

	it('forgets deleted sessions without closing the transport again', () => {
		const store = new SessionStore(60_000, 10);
		const transport = makeTransport();
		store.set('s1', transport);
		store.delete('s1');
		expect(store.get('s1')).toBeUndefined();
		expect(transport.close).not.toHaveBeenCalled();
	});
});
