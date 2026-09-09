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
	if (RULES.some(([, bucket]) => bucket === sector)) return sector;
	for (const [pattern, bucket] of RULES) {
		if (pattern.test(sector)) return bucket;
	}
	return null;
}

/** Version 1 SIC-to-sector mapping. Unmapped activities stay unknown. */
export function sectorFromSic(sic: string): string | null {
	if (!/^\d{4}$/.test(sic)) return null;
	const code = Number(sic);
	if (code >= 6500 && code < 6600 || code === 6798) return 'Real Estate';
	if (code >= 6000 && code < 6800) return 'Financials';
	if (code >= 7370 && code < 7380 || code >= 3570 && code < 3580 || code >= 3670 && code < 3680) return 'Technology';
	if (code >= 2830 && code < 2840 || code >= 3840 && code < 3860 || code >= 8000 && code < 8100) return 'Health Care';
	if (code >= 4800 && code < 4900 || code >= 7800 && code < 7900) return 'Communications';
	if (code >= 4900 && code < 5000 || code >= 1300 && code < 1400 || code >= 2900 && code < 3000) return 'Energy & Utilities';
	if (code >= 4000 && code < 4800) return 'Transport';
	if (code >= 5000 && code < 6000 || code >= 2000 && code < 2400 || code >= 7000 && code < 7300 || code >= 7900 && code < 8000) return 'Consumer';
	if (code >= 1000 && code < 1300 || code >= 2400 && code < 2800 || code >= 2800 && code < 2830 || code >= 3300 && code < 3500) return 'Materials';
	if (code >= 1500 && code < 1800 || code >= 3000 && code < 4000) return 'Industrials';
	return null;
}
