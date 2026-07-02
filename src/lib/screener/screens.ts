export const DEFAULT_SCREEN_SLUG = 'value_insider_composite';

export const SCREENER_SCREENS = [
	{ slug: DEFAULT_SCREEN_SLUG, name: 'Value × Insider Composite' },
	{ slug: 'insider_conviction', name: 'Insider Conviction' },
	{ slug: 'relative_value', name: 'Relative Value' }
] as const;

export type ScreenerScreenSlug = (typeof SCREENER_SCREENS)[number]['slug'];
export type ScreenerScreenOption = (typeof SCREENER_SCREENS)[number];

export function isScreenerScreenSlug(slug: string | null): slug is ScreenerScreenSlug {
	return SCREENER_SCREENS.some((screen) => screen.slug === slug);
}

export function screenerScreenBySlug(slug: ScreenerScreenSlug): ScreenerScreenOption {
	return SCREENER_SCREENS.find((screen) => screen.slug === slug) ?? SCREENER_SCREENS[0];
}
