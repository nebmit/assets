import { describe, expect, it } from 'vitest';
import { financialDocuments, type Filing } from './store.js';
const filing = (id: number, form: string, filedDate: string, status = 'processed') => ({ id, form, filedDate, status }) as Filing;
describe('current inline financial document selection', () => {
	it('includes current annual and quarterly statements plus their subsequent amendments', () => {
		const rows = [filing(1, '10-K', '2025-01-20'), filing(2, '10-K', '2026-01-20'), filing(3, '10-Q', '2026-04-20'), filing(4, '10-Q', '2026-07-20'), filing(5, '10-Q/A', '2026-08-20')];
		expect(financialDocuments(rows, '2026-09-08').map((f) => f.id)).toEqual([2, 4, 5]);
		expect(financialDocuments(rows, '2026-05-01').map((f) => f.id)).toEqual([2, 3]);
	});
	it('does not select pending filings or let an amendment hide its original statement', () => {
		expect(financialDocuments([filing(1, '10-K', '2026-01-20'), filing(2, '10-K/A', '2026-01-25'), filing(3, '10-Q', '2026-04-20', 'pending')], '2026-09-08').map((f) => f.id)).toEqual([1, 2]);
	});
});
