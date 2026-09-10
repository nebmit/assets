import { Decimal } from 'decimal.js';
import { canonicalJson } from './canonical.js';
import type { XbrlArtifact, XbrlFact } from './types.js';

/** A calculation can reconstruct its standard parent, never rename an arbitrary custom child. */
export function reconstructStandardTotals(artifact: XbrlArtifact): { facts: XbrlFact[]; inputs: Map<string, string[]> } {
	const allowed = new Set(['CommonStocksIncludingAdditionalPaidInCapital', 'CommonStockIncludingAdditionalPaidInCapital', 'CommonStockValue', 'AdditionalPaidInCapitalCommonStock']);
	const contexts = new Map(artifact.contexts.map((c) => [c.id, canonicalJson([c.entity, c.scheme, c.start, c.end, c.dimensions])]));
	const units = new Map(Object.entries(artifact.units).map(([id, u]) => [id, canonicalJson(u)]));
	const invalid = new Set(artifact.diagnostics.filter((d) => /error|fatal|inconsistency/i.test(d.severity)).flatMap((d) => d.refs));
	const relationships = artifact.relationships.filter((r) => /summation-item$/.test(r.arcrole) && /^\{https?:\/\/(?:fasb.org|xbrl.us)\/us-gaap\/[^}]+\}/.test(r.from) && allowed.has(r.from.slice(r.from.indexOf('}') + 1)));
	const groups = new Map<string, typeof relationships>();
	for (const r of relationships) { const key = canonicalJson([r.role, r.from]); const group = groups.get(key) ?? []; group.push(r); groups.set(key, group); }
	const derived: XbrlFact[] = [], inputs = new Map<string, string[]>();
	for (const group of groups.values()) {
		if (group.some((r) => r.weight === null)) continue;
		const children = new Map(group.map((r) => [r.to, r.weight!]));
		for (const template of artifact.facts.filter((f) => f.concept === group[0].to && f.valid && !f.nil && f.numeric && f.context && f.unit)) {
			const same = (f: XbrlFact) => contexts.get(f.context ?? '') === contexts.get(template.context!) && units.get(f.unit ?? '') === units.get(template.unit!);
			// A reported parent, including a nil/conflicting one, is never silently replaced.
			if (artifact.facts.some((f) => f.concept === group[0].from && same(f))) continue;
			const terms = [...children].map(([concept, weight]) => {
				const rows = artifact.facts.filter((f) => f.concept === concept && same(f));
				if (!rows.length || rows.some((f) => !f.valid || f.nil || f.value === null || invalid.has(f.id))) return null;
				if (rows.some((f) => f.value !== rows[0].value)) return null;
				return { rows, weight };
			});
			if (terms.some((t) => t === null)) continue;
			const valid = terms.filter((t) => t !== null);
			if (valid.some((t) => t.rows[0].decimals === null)) continue;
			const value = valid.reduce((total, t) => total.add(new Decimal(t.rows[0].value!).mul(t.weight)), new Decimal(0));
			const tolerance = valid.reduce((total, t) => total.add(t.rows[0].decimals === 'INF' ? 0 : new Decimal(10).pow(-Number(t.rows[0].decimals)).div(2).mul(new Decimal(t.weight).abs())), new Decimal(0));
			// A conservative power-of-ten precision encloses the accumulated input error.
			const decimals = tolerance.isZero() ? 'INF' : String(-Math.ceil(Math.log10(tolerance.mul(2).toNumber())));
			const id = `${template.document}#derived:${group[0].from}:${template.context}:${template.unit}:${group[0].role}`;
			if (inputs.has(id)) continue;
			derived.push({ ...template, id, concept: group[0].from, value: value.toString(), decimals, precision: null });
			inputs.set(id, valid.flatMap((t) => t.rows.map((f) => f.id)));
		}
	}
	return { facts: derived, inputs };
}
