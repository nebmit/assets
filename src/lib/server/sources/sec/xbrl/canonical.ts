/** PostgreSQL JSONB reorders object keys. Evidence identities must survive a DB round trip. */
export function canonicalJson(value: unknown): string {
	function sort(input: unknown): unknown {
		if (Array.isArray(input)) return input.map(sort);
		if (input !== null && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)]));
		return input;
	}
	return JSON.stringify(sort(value));
}
