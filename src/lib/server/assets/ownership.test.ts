import { describe, expect, it } from 'vitest';
import type { insiderTransaction, sourceFiling } from '../db/schema.js';
import { euroAmount, matchShareClass, qualifyDealings } from './ownership.js';
import { insiderConvictionSignal } from '../signals/definitions/insiderConviction.js';
import type { UniverseInstrument } from '../signals/types.js';
import { unknownShortSellers } from '../../shortSellers.js';
const securities = [{ instrumentId: 1, isin: null, securityClass: 'Common Stock', currency: 'USD' }];
const owner = { cik: '1', name: 'Owner', officer: true, director: true, tenPercentOwner: true };
function transaction(overrides: Partial<typeof insiderTransaction.$inferSelect> = {}): typeof insiderTransaction.$inferSelect {
	return { id: 1, source: 'sec', sourceRecordId: 'r1', filingId: null, publishedAt: null, observedAt: new Date('2026-07-01'), amendmentStatus: 'original', qualification: 'unqualified', qualificationReason: null, issuerId: 1, isin: null, instrumentId: null, economicKey: 'tx1', issuerNameRaw: 'Example', partyName: 'Owner', partyRole: 'other', side: 'buy', instrumentType: 'common stock', price: '100', volume: '1000', amount: null, currency: null, transactionDate: '2026-06-30', publishedDate: '2026-07-01', venue: null, naturalKeyHash: 'n1', raw: { owners: [owner], securityTitle: 'Common Stock', derivative: false, transactionCode: 'P' }, ...overrides };
}
function filing(id: number, form = '4', overrides: Partial<typeof sourceFiling.$inferSelect> = {}): typeof sourceFiling.$inferSelect {
	return { id, source: 'sec', externalId: `filing${id}`, issuerId: 1, form, filedDate: id === 1 ? '2026-07-01' : '2026-07-02', reportDate: null, acceptedAt: null, observedAt: new Date('2026-07-02'), url: 'https://www.sec.gov/fixture', status: 'processed', attempts: 1, error: null, metadata: {}, updatedAt: new Date('2026-07-02'), ...overrides };
}
const rates = [{ date: '2026-06-29', currency: 'USD', unitsPerEur: '1.25', observedAt: new Date('2026-06-29'), evidence: {} }];
const qualify = (rows = [transaction()], filings: ReturnType<typeof filing>[] = []) => qualifyDealings(rows, filings, securities, rates, new Date('2026-07-03')).get(1) ?? [];
describe('economic insider qualification', () => {
	it('infers USD only for a matched common class and converts using dated FX', () => {
		expect(qualify()[0].fxRateEvidence).toMatchObject({ date: '2026-06-29', currency: 'USD', unitsPerEur: '1.25' });
		expect(qualify()[0]).toMatchObject({ amount: 100000, amountEur: 80000, currency: 'USD', currencyStatus: 'inferred_usd', partyRole: 'executive', qualification: 'qualified' });
		expect(matchShareClass('Class A Common Stock', [{ ...securities[0], securityClass: 'Class B Common Stock' }])).toBeNull();
		expect(matchShareClass('Common Stock', [...securities, { ...securities[0], instrumentId: 2 }])).toBeNull();
	});
	it('keeps explicit and contradictory currencies distinct', () => {
		expect(qualify([transaction({ currency: 'EUR' })])[0]).toMatchObject({ currencyStatus: 'explicit', amountEur: 100000 });
		const raw = { ...transaction().raw as object, footnotes: { F1: 'Prices are in Canadian dollars, CAD.' } };
		expect(qualify([transaction({ currency: 'USD', raw })])[0]).toMatchObject({ currencyStatus: 'conflicting', amountEur: null });
		expect(euroAmount(100, 'USD', '2026-07-10', rates)).toBeNull();
	});
	it('excludes derivatives, awards and missing FX without turning them into zero', () => {
		expect(qualify([transaction({ side: 'other' })])[0].amountEur).toBeNull();
		expect(qualify([transaction({ raw: { ...transaction().raw as object, derivative: true } })])[0].amountEur).toBeNull();
		expect(qualifyDealings([transaction()], [], securities, []).get(1)?.[0]).toMatchObject({ amount: 100000, amountEur: null, qualificationReason: 'Dated FX rate unavailable' });
	});
	it('deduplicates replayed revisions and does not use future source revisions', () => {
		const old = transaction({ filingId: 1, raw: { ...transaction().raw as object, payloadHash: 'old' } });
		const newer = transaction({ id: 2, filingId: 1, volume: '2000', raw: { ...transaction().raw as object, payloadHash: 'new' } });
		const f = filing(1, '4', { metadata: { currentHash: 'new', documents: [{ hash: 'old', observedAt: '2026-07-01T00:00:00.000Z' }, { hash: 'new', observedAt: '2026-07-05T00:00:00.000Z' }] } });
		expect(qualify([old, newer], [f])).toHaveLength(1); expect(qualify([old, newer], [f])[0].amount).toBe(100000);
	});
	it('replaces defensibly matched partial amendments once and quarantines ambiguous families', () => {
		const original = transaction({ filingId: 1 });
		const amendment = transaction({ id: 2, filingId: 2, economicKey: 'amended', volume: '500', amendmentStatus: 'unresolved' });
		const filings = [filing(1), filing(2, '4/A', { metadata: { parsed: { originalSubmissionDate: '2026-07-01' }, amendmentStatus: 'unresolved' } })];
		expect(qualify([original, amendment], filings)).toHaveLength(1); expect(qualify([original, amendment], filings)[0].amountEur).toBe(40000);
		const ambiguous = transaction({ ...original, id: 3, economicKey: 'another' });
		expect(qualify([original, ambiguous, amendment], filings).every((r) => r.amountEur === null)).toBe(true);
	});
	it('selects the latest defensibly matched amendment in a correction chain', () => {
		const rows = [transaction({ filingId: 1 }), transaction({ id: 2, filingId: 2, economicKey: 'a2', volume: '500', amendmentStatus: 'unresolved' }), transaction({ id: 3, filingId: 3, economicKey: 'a3', volume: '250', amendmentStatus: 'unresolved' })];
		const metadata = { parsed: { originalSubmissionDate: '2026-07-01' } };
		const selected = qualify(rows, [filing(1), filing(2, '4/A', { metadata }), filing(3, '4/A', { metadata })]);
		expect(selected).toHaveLength(1); expect(selected[0].amountEur).toBe(20000);
	});
	it('does not qualify preferred securities through an explicit instrument match', () => {
		const selected = qualify([transaction({ instrumentId: 1, raw: { ...transaction().raw as object, securityTitle: 'Preferred Stock' } })]);
		expect(selected[0].amountEur).toBeNull();
	});
	it('joint owners and overlapping individual reports never establish an independent cluster', () => {
		const txs = qualify([transaction({ volume: '300', raw: { ...transaction().raw as object, owners: [owner, { ...owner, cik: '2' }] } }), transaction({ id: 2, economicKey: 'individual', volume: '300' })]);
		const asset: UniverseInstrument = { instrumentId: 1, issuerId: 1, assetId: 'test', isin: null, ticker: 'TEST', name: 'Test', sector: null, currency: 'USD', sizeBand: 'large', close: null, closeDate: null, epsBasic: null, marketCap: null, dividendPerShare: null, priceToBook: null, return3m: null, return6m: null, drawdown52w: null, above52wLow: null, insiderTx: txs, shortSellers: unknownShortSellers() };
		const result = insiderConvictionSignal.evaluate(asset, { runDate: '2026-07-01', instruments: [asset] });
		expect(result.rationale.buyer_count).toBe(1); expect(result.passedGate).toBe(false);
	});
});
