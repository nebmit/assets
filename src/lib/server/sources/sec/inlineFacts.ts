import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Decimal } from 'decimal.js';
import { conceptMappings } from './facts.js';
import { date } from './parse.js';

export interface InlineFact { metric: string; value: string; unit: string; currency: string | null; reportingBasis: string; periodStart: string | null; periodEnd: string; classMember: string | null; concept: string; decimals: number | 'INF' | null }
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true });
const list = <T>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
/** Target only standard concepts and contexts having no dimension except a stock-class axis. */
export function parseInlineFacts(source: string): InlineFact[] {
	if (/<!ENTITY/i.test(source)) throw new Error('Inline XBRL entity declarations are unsupported');
	const namespaces = new Map([...source.matchAll(/xmlns:([\w-]+)=["']([^"']+)["']/g)].map((m) => [m[1], m[2]]));
	const contexts = new Map<string, { start: string | null; end: string; member: string | null }>();
	for (const match of source.matchAll(/<(?:\w+:)?context\b[\s\S]*?<\/(?:\w+:)?context\s*>/gi)) {
		if (XMLValidator.validate(match[0]) !== true) throw new Error('Malformed XBRL context');
		const c = parser.parse(match[0]).context;
		const dimensions = [...list(c.entity?.segment?.explicitMember), ...list(c.scenario?.explicitMember)] as { '@_dimension'?: string; '#text'?: string }[];
		if (c.entity?.segment?.typedMember || c.scenario?.typedMember || dimensions.length > 1 || dimensions.some((d) => !/StatementClassOfStockAxis$/.test(d['@_dimension'] ?? ''))) continue;
		const start = c.period?.startDate ? date.parse(c.period.startDate) : null;
		const end = date.parse(c.period?.endDate ?? c.period?.instant);
		contexts.set(c['@_id'], { start, end, member: dimensions[0]?.['#text'] ?? null });
	}
	const units = new Map<string, string>();
	for (const match of source.matchAll(/<(?:\w+:)?unit\b[\s\S]*?<\/(?:\w+:)?unit\s*>/gi)) {
		const u = parser.parse(match[0]).unit;
		if (typeof u.measure === 'string') units.set(u['@_id'], u.measure.split(':').at(-1));
		const numerator = u.divide?.unitNumerator?.measure, denominator = u.divide?.unitDenominator?.measure;
		if (typeof numerator === 'string' && typeof denominator === 'string') units.set(u['@_id'], `${numerator.split(':').at(-1)}/${denominator.split(':').at(-1)}`);
	}
	const output: InlineFact[] = [];
	// Older filings carry standard XBRL instance elements instead of inline wrappers.
	source = source.replace(/<([\w-]+):([\w-]+)\b([^>]*\bcontextRef=[^>]*)>([\s\S]*?)<\/\1:\2\s*>/g, (match, prefix, concept, attrs, content) => prefix === 'ix' ? match : `<ix:nonFraction name="${prefix}:${concept}"${attrs}>${content}</ix:nonFraction>`);
	for (const match of source.matchAll(/<ix:nonFraction\b[\s\S]*?<\/ix:nonFraction\s*>/gi)) {
		const f = parser.parse(match[0]).nonFraction;
		if (f['@_nil'] === 'true' || f['@_nil'] === '1') continue;
		const [prefix, concept] = String(f['@_name'] ?? '').split(':');
		const namespace = namespaces.get(prefix) ?? '';
		if (!/^https?:\/\/(?:fasb.org|xbrl.us)\/us-gaap\//.test(namespace) && !/^https?:\/\/xbrl.sec.gov\/dei\//.test(namespace)) continue;
		const mapping = conceptMappings.find((m) => m[1] === concept);
		const ctx = contexts.get(f['@_contextRef']), unit = units.get(f['@_unitRef']);
		if (!mapping || !ctx || !unit) continue;
		const expectsShares = mapping[0].includes('shares');
		const expectsPerShare = mapping[0].startsWith('eps_') || mapping[0] === 'dividend_per_share';
		if (expectsShares ? unit !== 'shares' : expectsPerShare ? !/^[A-Z]{3}\/shares$/.test(unit) : !/^[A-Z]{3}$/.test(unit)) continue;
		const format = String(f['@_format'] ?? '').split(':').at(-1);
		if (format && !['num-dot-decimal', 'num-comma-decimal', 'numdotdecimal', 'numcommadecimal', 'zerodash', 'fixed-zero'].includes(format)) continue;
		let raw = match[0].replace(/^<[^>]+>/, '').replace(/<[^>]+>/g, '').replace(/&#160;|&nbsp;|\s/g, '').trim();
		if (format === 'zerodash' || format === 'fixed-zero') raw = /^[–—-]$/.test(raw) ? '0' : raw;
		raw = format?.includes('comma') ? raw.replaceAll('.', '').replace(',', '.') : raw.replaceAll(',', '');
		if (!/^-?\d+(?:\.\d+)?$/.test(raw)) continue;
		const scale = Number(f['@_scale'] ?? 0); if (!Number.isInteger(scale) || Math.abs(scale) > 18) throw new Error('Unsupported XBRL scale');
		const value = new Decimal(raw).mul(new Decimal(10).pow(scale)).mul(f['@_sign'] === '-' ? -1 : 1).toString();
		output.push({ metric: mapping[0], value, unit, currency: unit === 'shares' ? null : /^[A-Z]{3}(?:\/shares)?$/.test(unit) ? unit.slice(0, 3) : null, reportingBasis: mapping[2], periodStart: ctx.start, periodEnd: ctx.end, classMember: ctx.member, concept, decimals: f['@_decimals'] === 'INF' ? 'INF' : /^-?\d+$/.test(String(f['@_decimals'] ?? '')) ? Number(f['@_decimals']) : null });
	}
	return output;
}

/** Extract the primary financial document without buffering binary exhibits or an entire submission. */
export async function readPrimaryDocument(file: string, form: string, maxBytes = 64 * 1024 * 1024): Promise<string | null> {
	const { createReadStream } = await import('node:fs');
	const stream = createReadStream(file, { encoding: 'utf8' });
	let buffer = '', inside = false, selected: boolean | null = null, output = '';
	try {
		for await (const chunk of stream) {
			buffer += chunk;
			while (true) {
				if (!inside) {
					const begin = buffer.indexOf('<DOCUMENT>');
					if (begin < 0) { buffer = buffer.slice(-20); break; }
					buffer = buffer.slice(begin + 10); inside = true; selected = null;
				}
				if (selected === null) {
					const type = /<TYPE>([^\r\n<]+)/.exec(buffer);
					if (!type) { if (buffer.length > 4096) throw new Error('Missing submission document type'); break; }
					selected = type[1].trim() === form;
				}
				const end = buffer.indexOf('</DOCUMENT>');
				if (end >= 0) {
					if (selected) { output += buffer.slice(0, end); if (Buffer.byteLength(output) > maxBytes) throw new Error('Primary XBRL document exceeds qualification size limit'); return output; }
					buffer = buffer.slice(end + 11); inside = false; continue;
				}
				if (selected) { output += buffer.slice(0, -20); if (Buffer.byteLength(output) > maxBytes) throw new Error('Primary XBRL document exceeds qualification size limit'); }
				buffer = buffer.slice(-20); break;
			}
		}
		if (inside && selected) throw new Error('Incomplete primary XBRL document');
		return null;
	} finally { stream.destroy(); }
}
