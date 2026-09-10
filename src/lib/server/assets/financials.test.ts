import { describe, expect, it } from 'vitest';
import { resolveFinancials, selectFacts, splitFactor, type Fact, type Action } from './financials.js';

let sequence = 0;
function fact(metric: string, value: string, start: string | null, end: string, overrides: Partial<Fact> = {}): Fact {
	return { id: ++sequence, issuerId: 1, instrumentId: null, metric, value, currency: metric.includes('shares') ? null : 'USD', periodStart: start, periodEnd: end, periodType: start ? 'FY' : 'INSTANT', unit: metric.includes('shares') ? 'shares' : 'USD', reportingBasis: metric.includes('shares_basic') ? 'basic' : 'common_basic', source: 'sec', sourceRecordId: null, filingId: 1, publishedAt: null, publishedDate: '2026-02-01', observedAt: new Date('2026-02-02'), metadata: {}, qualification: 'unqualified', qualificationReason: 'requires_snapshot_qualification', ...overrides };
}
function action(overrides: Partial<Action> = {}): Action {
	return { id: 1, instrumentId: 1, source: 'alpaca', externalId: 'split', type: 'forward_splits', exDate: '2026-03-01', ratio: '2', amount: null, currency: null, observedAt: new Date('2026-03-01'), sourceRecordId: 'split', evidence: {}, qualification: 'qualified', metadata: {}, ...overrides };
}
function resolve(facts: Fact[], overrides: Partial<Parameters<typeof resolveFinancials>[0]> = {}) {
	return resolveFinancials({ facts, instrumentId: 1, scope: { earnings: 'issuer', classes: ['issuer'], inventoryComplete: true }, currency: 'USD', close: 20, runDate: '2026-03-05', actions: [], actionsComplete: true, ...overrides });
}
const annual = () => [fact('net_income_common', '1000', '2025-01-01', '2025-12-31'), fact('weighted_average_shares_basic', '100', '2025-01-01', '2025-12-31')];

describe('qualified financial snapshots', () => {
	it('derives annual basic EPS from common earnings and basic shares', () => {
		expect(resolve(annual()).eps.value).toBe(10);
	});
	it('builds trailing earnings from four contiguous quarters with duration-weighted shares', () => {
		const periods = [['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'], ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31']];
		const rows = periods.flatMap(([start, end], i) => [fact('net_income_common', '250', start, end, { periodType: 'Q' }), fact('weighted_average_shares_basic', i === 3 ? '200' : '100', start, end, { periodType: 'Q' })]);
		expect(resolve(rows).eps.value).toBeCloseTo(1000 / ((273 * 100 + 92 * 200) / 365));
		expect(resolve(rows.slice(2)).eps.value).toBeNull();
	});
	it('keeps losses as losses rather than missing or zero', () => {
		const rows = annual(); rows[0].value = '-1000'; expect(resolve(rows).eps.value).toBe(-10);
	});
	it('weights reconstructed YTD share counts by duration and never subtracts EPS', () => {
		const rows = [...annual(), fact('net_income_common', '400', '2026-01-01', '2026-03-31', { periodType: 'Q' }), fact('net_income_common', '200', '2025-01-01', '2025-03-31', { periodType: 'Q' }), fact('weighted_average_shares_basic', '200', '2026-01-01', '2026-03-31', { periodType: 'Q' }), fact('weighted_average_shares_basic', '100', '2025-01-01', '2025-03-31', { periodType: 'Q' }), fact('eps_basic', '999', '2026-01-01', '2026-03-31', { periodType: 'Q' })];
		expect(resolve(rows, { runDate: '2026-04-30' }).eps.value).toBeCloseTo(1200 / ((36500 + 18000 - 9000) / 365));
		expect(resolve(rows.filter((r) => r.periodEnd !== '2025-03-31'), { runDate: '2026-04-30' }).eps.value).toBeNull();
	});
	it('handles a non-calendar 53-week year without annualizing per-share values', () => {
		const rows = [fact('net_income_common', '1200', '2024-09-29', '2025-10-04'), fact('weighted_average_shares_basic', '100', '2024-09-29', '2025-10-04')];
		expect(resolve(rows, { runDate: '2025-11-15' }).eps.value).toBe(12);
	});
	it('requires class, currency and denominator compatibility', () => {
		expect(resolve(annual(), { scope: { earnings: null, classes: [], inventoryComplete: false } }).eps.value).toBeNull();
		expect(resolve(annual(), { currency: 'EUR' }).eps.value).toBeNull();
		const rows = annual(); rows[1].reportingBasis = 'diluted'; expect(resolve(rows).eps.value).toBeNull();
	});
	it('normalizes split basis for EPS and outstanding shares together', () => {
		const rows = [...annual(), fact('shares_outstanding', '100', null, '2025-12-31')];
		const result = resolve(rows, { actions: [action()] });
		expect(result.eps.value).toBe(5); expect(result.marketCap.value).toBe(4000);
		expect(splitFactor([action()], '2025-12-31', '2026-03-05').toNumber()).toBe(2);
	});
	it('excludes unknown adjustment coverage and ambiguous restated share bases', () => {
		expect(resolve(annual(), { actionsComplete: false }).eps.value).toBeNull();
		expect(resolve(annual(), { actions: [action({ exDate: '2026-01-15' })] }).eps.value).toBeNull();
	});
	it('selects restatements deterministically without mutating observations', () => {
		const rows = annual(); const revision = { ...rows[0], id: 99, value: '1500', filingId: 2, publishedDate: '2026-02-15' };
		expect(resolve([...rows, revision]).eps.value).toBeNull();
		const revisedShares = { ...rows[1], id: 100, filingId: 2, publishedDate: '2026-02-15' };
		expect(resolve([...rows, revision, revisedShares]).eps.value).toBe(15);
		expect(resolve([revision, revisedShares, ...rows]).eps.value).toBe(15);
		expect(rows[0].value).toBe('1000');
	});
	it('keeps contradictory concepts explicitly conflicting', () => {
		const a = fact('shares_outstanding', '100', null, '2025-12-31', { metadata: { concept: 'a' } });
		const b = { ...a, id: 99, value: '200', metadata: { concept: 'b' } };
		expect(selectFacts([a, b])[0].qualification).toBe('conflicting'); expect(a.qualification).toBe('unqualified');
		expect(resolve([a, b]).marketCap.value).toBeNull();
	});
	it('uses trailing payment dates and keeps declared or future payments out', () => {
		const paid = action({ type: 'cash_dividends', ratio: null, amount: '1', currency: 'USD', metadata: { payable_date: '2026-03-03' } });
		const future = { ...paid, id: 2, externalId: 'future', amount: '100', metadata: { payable_date: '2026-03-20' } };
		expect(resolve(annual(), { actions: [paid, future] }).dividend.value).toBe(1);
		expect(resolve(annual(), { actions: [{ ...paid, currency: 'EUR' }] }).dividend.value).toBeNull();
	});
	it('keeps unsupported multi-class equity allocations null', () => {
		const rows = [fact('shares_outstanding', '100', null, '2025-12-31', { instrumentId: 1 }), fact('common_equity', '1000', null, '2025-12-31')];
		expect(resolve(rows).pb.value).toBe(2);
		expect(resolve(rows, { scope: { earnings: null, classes: [], inventoryComplete: false } }).pb.value).toBeNull();
		rows[1].instrumentId = 1;
		expect(resolve(rows, { scope: { earnings: null, classes: [], inventoryComplete: false } }).pb.value).toBeNull();
	});
	it('keeps valuation on the quote share basis before the first post-split close', () => {
		const rows = [...annual(), fact('shares_outstanding', '100', null, '2025-12-31')];
		const split = action({ exDate: '2026-03-02', ratio: '2' });
		const before = resolve(rows, { actions: [split], runDate: '2026-03-02', priceDate: '2026-02-27', close: 100 });
		const after = resolve(rows, { actions: [split], runDate: '2026-03-03', priceDate: '2026-03-02', close: 50 });
		expect(before.marketCap.value).toBe(10000);
		expect(after.marketCap.value).toBe(10000);
		expect(before.eps.value).toBe(after.eps.value! * 2);
	});

});

describe('SEC common attribution', () => {
	const parent = () => [
		fact('net_income', '1000', '2025-01-01', '2025-12-31'),
		fact('weighted_average_shares_basic', '100', '2025-01-01', '2025-12-31'),
		fact('eps_basic', '10', '2025-01-01', '2025-12-31', { unit: 'USD/shares', reportingBasis: 'basic', metadata: { decimals: 2 } })
	];
	const balance = () => [
		fact('shares_outstanding', '100', null, '2025-12-31'),
		fact('equity', '1000', null, '2025-12-31', { reportingBasis: 'parent' }),
		fact('common_capital', '600', null, '2025-12-31'),
		fact('retained_earnings', '450', null, '2025-12-31'),
		fact('other_comprehensive_income', '-50', null, '2025-12-31')
	];
	it('accepts parent income only with matching reported EPS and shares', () => {
		expect(resolve(parent()).eps.value).toBe(10);
		const rows = parent(); rows[0].value = '1000.5';
		expect(resolve(rows).eps.value).toBe(10.005);
		rows[0].value = '1000.51'; expect(resolve(rows).eps.value).toBeNull();
		expect(resolve(parent().slice(0, 2)).eps.value).toBeNull();
		expect(resolve(parent(), { scope: { earnings: null, classes: [], inventoryComplete: false } }).eps.value).toBeNull();
	});
	it('does not bypass explicit common income or preferred capital', () => {
		const common = fact('net_income_common', '500', '2025-01-01', '2025-12-31');
		expect(resolve([...parent(), common]).eps.value).toBe(5);
		expect(resolve([...parent(), { ...common, qualification: 'conflicting' }]).eps.value).toBeNull();
		expect(resolve([...parent(), fact('preferred_equity', '100', null, '2025-12-31')]).eps.value).toBeNull();
	});
	it('reconciles the common breakdown, including separately reported treasury stock', () => {
		const rows = balance(); expect(resolve(rows).pb.value).toBe(2);
		expect(resolve(rows).pb.inputIds).toEqual(expect.arrayContaining(rows.map((f) => f.id)));
		rows[1].value = '900'; expect(resolve(rows).pb.reason).toContain('do not reconcile');
		expect(resolve([...rows, fact('treasury_stock', '100', null, '2025-12-31')]).pb.value).toBeCloseTo(2000 / 900);
	});
	it('rejects missing, conflicting and mixed-statement equity components', () => {
		expect(resolve(balance().slice(0, 4)).pb.reason).toContain('Missing same-statement other comprehensive income');
		const rows = balance(); rows[2].qualification = 'conflicting';
		expect(resolve(rows).pb.state).toBe('conflicting');
		const mixed = balance(); mixed[2].filingId = 2; expect(resolve(mixed).pb.value).toBeNull();
		expect(resolve([...balance(), fact('preferred_shares_issued', '5', null, '2025-12-31')]).pb.value).toBeNull();
	});
	it('honors equity rounding boundaries and rejects contradictory preferred allocation', () => {
		const rows = balance(); rows[1].metadata = { decimals: -1 }; rows[1].value = '1005';
		expect(resolve(rows).pb.value).toBeCloseTo(2000 / 1005);
		rows[1].value = '1005.01'; expect(resolve(rows).pb.state).toBe('conflicting');
		const preferred = [fact('preferred_equity', '0', null, '2025-12-31'), fact('preferred_shares_issued', '10', null, '2025-12-31')];
		expect(resolve([...balance(), ...preferred]).pb.reason).toContain('Preferred capital contradicts');
	});
	it('accepts separate common par and APIC only when the breakdown reconciles', () => {
		const rows = balance().filter((f) => f.metric !== 'common_capital');
		rows.push(fact('common_stock_value', '100', null, '2025-12-31'), fact('additional_paid_in_capital', '500', null, '2025-12-31'));
		expect(resolve(rows).pb.value).toBe(2);
		rows.push(fact('common_capital', '700', null, '2025-12-31'));
		expect(resolve(rows).pb.reason).toContain('Conflicting common-capital breakdown');
	});
	it('subtracts explicit preferred capital and rejects stale and nonpositive equity', () => {
		expect(resolve([...balance(), fact('preferred_equity', '200', null, '2025-12-31')]).pb.value).toBe(2.5);
		expect(resolve(balance(), { runDate: '2026-08-01' }).pb.state).toBe('stale');
		const rows = balance(); rows[1].metric = 'common_equity'; rows[1].value = '-1';
		expect(resolve(rows).pb.value).toBeNull();
	});
});

describe('metric-specific corporate action windows', () => {
	it('does not suppress a current share count because of an old unsupported event', () => {
		const rows = [fact('shares_outstanding', '100', null, '2026-02-28')];
		const old = action({ type: 'spin_offs', ratio: null, qualification: 'unqualified', exDate: '2025-01-01' });
		expect(resolve(rows, { actions: [old] }).marketCap.value).toBe(2000);
		const newer = { ...old, exDate: '2026-03-01' };
		expect(resolve(rows, { actions: [newer] }).marketCap.reason).toContain('Unsupported corporate action');
	});
	it('keeps acquirer earnings and market cap independent of acquiree conversion terms', () => {
		const rows = [...annual(), fact('shares_outstanding', '100', null, '2025-12-31')];
		const merger = action({ type: 'cash_mergers', ratio: null, qualification: 'unqualified', metadata: { acquirer_symbol: 'BUYER', acquiree_symbol: 'TARGET' } });
		const result = resolve(rows, { actions: [merger], adjustmentSymbol: 'BUYER' });
		expect(result.eps.value).toBe(10); expect(result.marketCap.value).toBe(2000);
		expect(resolve(rows, { actions: [merger], adjustmentSymbol: 'TARGET' }).marketCap.value).toBeNull();
	});
	it('does not use an older share count to conceal a conflicting newest count', () => {
		const older = fact('shares_outstanding', '100', null, '2025-12-31');
		const conflict = fact('shares_outstanding', '200', null, '2026-02-28', { qualification: 'conflicting' });
		const result = resolve([older, conflict]);
		expect(result.marketCap.value).toBeNull(); expect(result.marketCap.state).toBe('conflicting');
	});
});


describe('reported outstanding-share precision', () => {
	it('reconciles exact cover counts against rounded balance-sheet counts and preserves both inputs', () => {
		const exact = fact('shares_outstanding', '459674889', null, '2025-12-31', { metadata: { concept: 'EntityCommonStockSharesOutstanding', decimals: 'INF' } });
		const rounded = fact('shares_outstanding', '459700000', null, '2025-12-31', { metadata: { concept: 'CommonStockSharesOutstanding', decimals: -5 } });
		const old = { ...rounded, id: -1, metadata: { concept: 'CommonStockSharesOutstanding' }, qualification: 'conflicting', observedAt: new Date('2026-02-01') };
		const result = resolve([old, exact, rounded]);
		expect(result.marketCap.value).toBe(459674889 * 20);
		expect(result.marketCap.inputIds).toEqual(expect.arrayContaining([exact.id, rounded.id]));
		rounded.value = '459800000';
		expect(resolve([exact, rounded]).marketCap.state).toBe('conflicting');
	});
	it('requires reported precision before reconciling unequal share counts', () => {
		const rows = ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'].map((concept, i) => fact('shares_outstanding', String(1000 + i), null, '2025-12-31', { metadata: { concept } }));
		expect(resolve(rows).marketCap.state).toBe('conflicting');
	});
});

describe('whole-company valuation', () => {
	it('sums listed classes and refuses partial capitalization', () => {
		const rows = ['A', 'B'].map((scope, i) => fact('shares_outstanding', String((i + 1) * 100), null, '2025-12-31', { metadata: { scope } }));
		const prices = ['A', 'B'].map((classId) => ({ classId, close: 20, priceDate: '2026-03-05', actions: [], actionsComplete: true, symbol: classId }));
		const options = { scope: { earnings: 'A', classes: ['A', 'B'], inventoryComplete: true }, classPrices: prices };
		expect(resolve(rows, options).marketCap.value).toBe(6000);
		expect(resolve(rows, { ...options, classPrices: prices.slice(0, 1) }).marketCap).toMatchObject({ value: null, reasonCode: 'unlisted_class_valuation_unavailable' });
	});
	it('does not publish old earnings when the latest financial period is incomplete', () => {
		expect(resolve(annual(), { latestReportEnd: '2026-01-31' }).eps).toMatchObject({ value: null, reasonCode: 'latest_period_missing' });
	});
	it('proves comparative split restatement and adjusts its denominator only once', () => {
		const rows = annual();
		rows[1].metadata = { decimals: 'INF' };
		const revised = rows.map((f) => ({ ...f, id: f.id + 100, filingId: 2, publishedDate: '2026-03-03', value: f.metric === 'weighted_average_shares_basic' ? '200' : f.value, metadata: { decimals: 'INF' } }));
		expect(resolve([...rows, ...revised], { actions: [action()] }).eps.value).toBe(5);
	});
});

it('requires noncontrolling and temporary claims to be resolved for company book value', () => {
	const rows = [fact('shares_outstanding', '100', null, '2025-12-31'), fact('equity', '1100', null, '2025-12-31', { reportingBasis: 'including_noncontrolling' }), fact('noncontrolling_equity', '100', null, '2025-12-31'), fact('preferred_equity', '0', null, '2025-12-31')];
	expect(resolve(rows).pb.value).toBe(2);
	expect(resolve(rows.filter((r) => r.metric !== 'noncontrolling_equity')).pb.value).toBeNull();
	expect(resolve([...rows, fact('temporary_equity', '50', null, '2025-12-31')]).pb.value).toBeNull();
});
