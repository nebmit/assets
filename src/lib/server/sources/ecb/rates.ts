import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { fxRate } from '../../db/schema.js';
import { fetchText } from '../../http.js';
import { archiveObservation } from '../../assets/evidence.js';
import type { Job } from '../../pipeline/types.js';
import { date } from '../sec/parse.js';
const URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';
export function parseRates(xml: string) {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid ECB XML');
	const root = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, isArray: (name, path) => name === 'Cube' && typeof path === 'string' && path.split('.').length >= 3 }).parse(xml);
	const days = z.array(z.object({ '@_time': date, Cube: z.array(z.object({ '@_currency': z.string().regex(/^[A-Z]{3}$/), '@_rate': z.coerce.number().positive().finite() })) })).parse(root.Envelope?.Cube?.Cube);
	if (!days.length) throw new Error('Empty ECB rate history');
	return days.flatMap((day) => day.Cube.map((r) => ({ date: day['@_time'], currency: r['@_currency'], unitsPerEur: String(r['@_rate']) })));
}
export const ecbRatesJob: Job = { name: 'ecb_rates', source: 'ecb', async run(ctx) {
	const text = await fetchText(URL); const evidence = await archiveObservation('ecb', URL, text);
	const rows = parseRates(text).filter((r) => r.date <= ctx.runDate && r.date >= `${Number(ctx.runDate.slice(0, 4)) - 4}-01-01`);
	// Re-observing identical rates must preserve their first observation time.
	const existing = await ctx.db.select().from(fxRate);
	const latest = new Map<string, string>();
	for (const r of existing.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())) if (!latest.has(`${r.date}:${r.currency}`)) latest.set(`${r.date}:${r.currency}`, r.unitsPerEur);
	const changed = rows.filter((r) => latest.get(`${r.date}:${r.currency}`) !== r.unitsPerEur);
	for (let i = 0; i < changed.length; i += 500) await ctx.db.insert(fxRate).values(changed.slice(i, i + 500).map((r) => ({ ...r, observedAt: new Date(evidence.observedAt), evidence })));
	return { rates: rows.length, inserted: changed.length };
} };
