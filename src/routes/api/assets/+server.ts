import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db/index.js';
import { assetCatalog } from '$lib/server/assets/catalog.js';
export async function GET() { return json({ assets: await assetCatalog(getDb()) }, { headers: { 'cache-control': 'public, max-age=60' } }); }
