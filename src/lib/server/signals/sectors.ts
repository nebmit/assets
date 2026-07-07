/**
 * Coarse "super-sector" buckets over Börse Frankfurt's granular free-text
 * sector vocabulary. BF sectors are too fine for a 160-name universe — most
 * would fall below any minimum peer count and silently degrade P/E
 * comparisons to the index median, which structurally ranks the perennially
 * cheap sectors (banks, autos, steel) on top. Buckets are keyword-matched so
 * unseen vocabulary still lands somewhere sensible; unmatched sectors return
 * null and fall back to the index peer group.
 */

const RULES: [RegExp, string][] = [
	[/real.?estate|immobilien|property|reit/i, 'Real Estate'],
	[/bank|financ|asset|invest|exchange|insur|payment|leasing/i, 'Financials'],
	[/software|internet|it.?(service|consult)|semiconduct|tech|electronic|computer/i, 'Technology'],
	[/pharma|biotech|health|medical|diagnostic|lab/i, 'Health Care'],
	[/chemi|material|steel|metal|mining|paper|packag|glass|cement/i, 'Materials'],
	[/telecom|communication|media|entertain|publish|broadcast/i, 'Communications'],
	[/energy|oil|gas|utilit|power|renewab|solar|wind|hydrogen/i, 'Energy & Utilities'],
	[/transport|logisti|airline|airport|shipping|rail|mobility/i, 'Transport'],
	[/retail|consumer|food|beverage|apparel|fashion|luxur|travel|leisure|e.?commerce|household|cosmetic/i, 'Consumer'],
	[/auto|machin|industrial|engineer|aerospace|defen[cs]e|construction|electric|plant|manufactur/i, 'Industrials']
];

export function superSector(sector: string | null): string | null {
	if (sector === null) return null;
	for (const [pattern, bucket] of RULES) {
		if (pattern.test(sector)) return bucket;
	}
	return null;
}
