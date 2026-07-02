import type { CardData } from './types.js';

/** Client-side search over the loaded grid: substring match on name, ISIN or WKN. */
export function matchesSearch(card: CardData, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (q === '') return true;
	return (
		card.name.toLowerCase().includes(q) ||
		card.isin.toLowerCase().includes(q) ||
		(card.wkn ?? '').toLowerCase().includes(q)
	);
}
