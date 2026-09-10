import { Decimal } from 'decimal.js';
import type { Action, Fact } from './financials.js';
const scope = (f: Fact) => f.metadata?.scope ?? 'issuer';
const error = (f: Fact) => typeof f.metadata?.decimals === 'number' ? new Decimal(10).pow(-f.metadata.decimals).div(2) : new Decimal(0);
/** Prove restatement against a pre-action observation; publication after a split is not proof. */
export function qualifyShareBases(facts: Fact[], actions: Action[]): Fact[] {
	return facts.map((fact) => {
		if (!['weighted_average_shares_basic', 'weighted_average_shares_diluted', 'eps_basic', 'eps_diluted'].includes(fact.metric)) return fact;
		const splits = actions.filter((a) => a.qualification === 'qualified' && a.ratio !== null && a.exDate > fact.periodEnd && a.exDate <= fact.publishedDate);
		if (!splits.length) return fact;
		const first = splits.map((a) => a.exDate).sort()[0];
		const previous = facts.filter((f) => f.metric === fact.metric && scope(f) === scope(fact) && f.periodStart === fact.periodStart && f.periodEnd === fact.periodEnd && f.unit === fact.unit && f.publishedDate < first && f.qualification !== 'conflicting' && f.qualification !== 'rejected').sort((a, b) => b.publishedDate.localeCompare(a.publishedDate))[0];
		if (!previous || !new Decimal(previous.value).isFinite() || new Decimal(previous.value).isZero()) return fact;
		const ratio = splits.reduce((r, a) => r.mul(a.ratio!), new Decimal(1));
		const factor = fact.metric.startsWith('eps_') ? new Decimal(1).div(ratio) : ratio;
		const reportedPrecision = (f: Fact) => typeof f.metadata?.decimals === 'number' || f.metadata?.decimals === 'INF';
		if (!reportedPrecision(fact) || !reportedPrecision(previous) || new Decimal(fact.value).minus(new Decimal(previous.value).mul(factor)).abs().gt(error(fact).add(error(previous).mul(factor)))) return fact;
		return { ...fact, metadata: { ...fact.metadata, shareBasisResolved: true, shareBasisDate: splits.map((a) => a.exDate).sort().at(-1), reconciledInputIds: [...((fact.metadata?.reconciledInputIds ?? []) as number[]), previous.id] } };
	});
}
