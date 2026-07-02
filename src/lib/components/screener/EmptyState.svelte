<script lang="ts">
	/**
	 * Graceful blank/error panels the design doesn't cover: fresh installs
	 * without a signal run, an unreachable database, a run where nothing
	 * passed the composite gate, and a search with no matches.
	 */
	interface Props {
		kind: 'no-runs' | 'db-error' | 'no-passers' | 'no-matches';
		query?: string;
		runDate?: string;
	}

	let { kind, query = '', runDate = '' }: Props = $props();

	const content = $derived(
		{
			'no-runs': {
				headline: 'No screening run yet',
				hint: 'Run the pipeline: npm run worker -- run'
			},
			'db-error': {
				headline: 'Database unavailable',
				hint: 'Check DATABASE_URL and try again'
			},
			'no-passers': {
				headline: 'Nothing passed the composite gate',
				hint: `Run of ${runDate} · 0 names surfaced`
			},
			'no-matches': {
				headline: 'No matches',
				hint: `Nothing matches “${query}”`
			}
		}[kind]
	);
</script>

<div class="flex justify-center px-[22px] py-16">
	<div
		class="flex w-full max-w-[420px] flex-col items-center gap-3 rounded-md border border-border-subtle bg-surface-card px-8 py-10 text-center shadow-xs"
	>
		<div class="flex flex-col items-center gap-[3px]">
			<svg
				width="22"
				height="18"
				viewBox="0 0 17 14"
				fill="none"
				stroke="var(--ink)"
				stroke-width="1.7"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M2 11 L8.5 2.5 L15 11" />
			</svg>
			<span class="h-[2px] w-[22px] rounded-[1px] bg-blue-600"></span>
		</div>
		<span class="text-md font-medium">{content.headline}</span>
		<span class="font-mono text-xs text-text-tertiary">{content.hint}</span>
	</div>
</div>
