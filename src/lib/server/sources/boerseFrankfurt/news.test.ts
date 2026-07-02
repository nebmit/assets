import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapInstrumentNews, type NewsMember } from './news.js';
import { instrumentNewsResponse } from './schemas.js';

// Real SAP instrument_news response (captured 2026-07) plus crafted edge cases.
const fixture = instrumentNewsResponse.parse(
	JSON.parse(
		readFileSync(new URL('../../../../../tests/fixtures/bf_instrument_news.json', import.meta.url), 'utf8')
	)
);

const MEMBER: NewsMember = { id: 7, issuerId: 3, isin: 'DE0007164600' };

describe('mapInstrumentNews', () => {
	it('maps items to rows and skips unparseable timestamps', () => {
		const { rows, unparseable } = mapInstrumentNews(fixture.data!, MEMBER);
		expect(rows).toHaveLength(3);
		expect(unparseable).toBe(1);
		expect(rows[0]).toMatchObject({
			source: 'boerse_frankfurt',
			externalId: '3ac5730c-344a-4f6d-a5ef-7206ccc21804',
			instrumentId: 7,
			issuerId: 3,
			isin: 'DE0007164600',
			headline: "ANALYSE-FLASH: Berenberg belässt SAP auf 'Buy' - Ziel 215 Euro",
			newsType: null,
			publishedDate: '2026-06-19'
		});
		// raw keeps passthrough fields the typed schema does not consume
		expect((rows[0].raw as { pathSegment?: string }).pathSegment).toContain('ANALYSE-FLASH');
	});

	it('normalizes numeric ids and keeps an explicit newsType', () => {
		const { rows } = mapInstrumentNews(fixture.data!, MEMBER);
		expect(rows[2].externalId).toBe('12345');
		expect(rows[2].newsType).toBe('COMPANY_NEWS');
	});

	it('books publishedDate on the Berlin calendar day', () => {
		const { rows } = mapInstrumentNews(fixture.data!, MEMBER);
		// 23:30 UTC on 06-30 is already 07-01 in Berlin (UTC+2)
		expect(rows[2].publishedDate).toBe('2026-07-01');
		// offset-carrying timestamps stay on their local day
		expect(rows[1].publishedDate).toBe('2024-02-11');
	});

	it('derives a deterministic natural key that varies by ISIN', () => {
		const first = mapInstrumentNews(fixture.data!, MEMBER).rows[0];
		const again = mapInstrumentNews(fixture.data!, MEMBER).rows[0];
		const otherIsin = mapInstrumentNews(fixture.data!, { ...MEMBER, isin: 'DE0008404005' }).rows[0];
		expect(first.naturalKeyHash).toBe(again.naturalKeyHash);
		expect(otherIsin.naturalKeyHash).not.toBe(first.naturalKeyHash);
		expect(first.naturalKeyHash).toMatch(/^[0-9a-f]{32}$/);
	});
});
