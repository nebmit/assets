import { config } from '../../config.js';
import { RateLimiter } from '../../http.js';
import { archiveObservation } from '../../assets/evidence.js';
import { sleep } from '../../util.js';
const limiter = new RateLimiter(350);
export class AlpacaAccessError extends Error {}

/** Explicit SIP requests only; never retry an entitlement failure on a different feed. */
export async function alpacaRequest(path: string, params: Record<string, string>) {
	const { APCA_API_KEY_ID: key, APCA_API_SECRET_KEY: secret } = config();
	if (!key || !secret) throw new AlpacaAccessError('Alpaca credentials are not configured');
	const url = `https://data.alpaca.markets${path}?${new URLSearchParams(params)}`;
	for (let attempt = 0; attempt < 4; attempt++) {
		await limiter.acquire();
		let response: Response;
		try {
			response = await fetch(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret }, signal: AbortSignal.timeout(30_000), redirect: 'error' });
		} catch (error) { if (attempt === 3) throw error; await sleep(1000 * 2 ** attempt); continue; }
		if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new AlpacaAccessError(`Alpaca access rejected (${response.status})`); }
		if (response.status === 429 || response.status >= 500) {
			await response.body?.cancel();
			const header = response.headers.get('retry-after');
			const seconds = header === null ? 2 ** attempt : /^\d+$/.test(header) ? Number(header) : Math.max(0, (Date.parse(header) - Date.now()) / 1000);
			if (attempt === 3 || !Number.isFinite(seconds) || seconds > 30) throw new Error(`Alpaca retry deferred (${response.status})`);
			await sleep(seconds * 1000); continue;
		}
		if (!response.ok) { await response.body?.cancel(); throw new Error(`Alpaca HTTP ${response.status}`); }
		const reader = response.body?.getReader(); if (!reader) throw new Error('Alpaca empty response');
		const chunks: Uint8Array[] = []; let bytes = 0;
		while (true) { const r = await reader.read(); if (r.done) break; bytes += r.value.length; if (bytes > 20 * 1024 * 1024) { await reader.cancel(); throw new Error('Alpaca response too large'); } chunks.push(r.value); }
		const text = Buffer.concat(chunks).toString('utf8');
		const data: unknown = JSON.parse(text);
		return { data, evidence: await archiveObservation('alpaca', url, text) };
	}
	throw new Error('Alpaca retry budget exhausted');
}
