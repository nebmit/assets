/** Cover-page trading symbols and security titles share the same DEI XBRL context. */
export function listedShareClasses(source: string): Map<string, string> {
	const namespaces = new Map([...source.matchAll(/xmlns:([\w-]+)=["']([^"']+)["']/g)].map((m) => [m[1], m[2]]));
	const contexts = new Map<string, { symbols: Set<string>; titles: Set<string> }>();
	for (const match of source.matchAll(/<ix:nonNumeric\b([^>]*)>([\s\S]*?)<\/ix:nonNumeric\s*>/gi)) {
		const attrs = new Map([...match[1].matchAll(/([\w:]+)=["']([^"']*)["']/g)].map((m) => [m[1], m[2]]));
		const [prefix, concept] = (attrs.get('name') ?? '').split(':');
		if (!/^https?:\/\/xbrl.sec.gov\/dei\//.test(namespaces.get(prefix) ?? '') || !['TradingSymbol', 'Security12bTitle'].includes(concept)) continue;
		const context = attrs.get('contextRef'); if (!context) continue;
		const text = match[2].replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
		const row = contexts.get(context) ?? { symbols: new Set<string>(), titles: new Set<string>() };
		(concept === 'TradingSymbol' ? row.symbols : row.titles).add(text); contexts.set(context, row);
	}
	const candidates = new Map<string, Set<string>>();
	for (const row of contexts.values()) if (row.symbols.size === 1 && row.titles.size === 1) {
		const symbol = [...row.symbols][0], title = [...row.titles][0];
		const titles = candidates.get(symbol) ?? new Set<string>(); titles.add(title); candidates.set(symbol, titles);
	}
	return new Map([...candidates].filter(([, titles]) => titles.size === 1).map(([symbol, titles]) => [symbol, [...titles][0]]));
}

export function commonClassMembers(members: string[]): string[] {
	return [...new Set(members.filter((member) => !/Preferred/i.test(member)))];
}

/** An undesignated listed common class is distinct from separately reported Class B or nonvoting shares. */
export function isUndesignatedCommonStockTitle(title: string): boolean {
	return /^common (stock|shares)\b/i.test(title.trim()) && !/\b(class|non[ -]?voting|preferred)\b/i.test(title);
}
