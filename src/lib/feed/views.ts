export const DEFAULT_VIEW_SLUG = 'surfaced';

/**
 * The headline view is the surfaced feed (union of fired signals with
 * evidence); the individual signals remain as facets of the same data.
 */
export const FEED_VIEWS = [
	{ slug: DEFAULT_VIEW_SLUG, name: 'Surfaced' },
	{ slug: 'insider_conviction', name: 'Insider Conviction' },
	{ slug: 'relative_value', name: 'Relative Value' }
] as const;

export type FeedViewSlug = (typeof FEED_VIEWS)[number]['slug'];
export type FeedViewOption = (typeof FEED_VIEWS)[number];

export function isFeedViewSlug(slug: string | null): slug is FeedViewSlug {
	return FEED_VIEWS.some((view) => view.slug === slug);
}

export function feedViewBySlug(slug: FeedViewSlug): FeedViewOption {
	return FEED_VIEWS.find((view) => view.slug === slug) ?? FEED_VIEWS[0];
}
