/**
 * IndexedDB cache for unlocked data-encryption keys, so a returning visitor
 * reaches their encrypted data with zero ceremonies. Only NON-extractable
 * CryptoKeys go in here (they survive structured clone but their bytes stay
 * inside the browser's crypto layer); the wrapped copies on the server
 * remain the durable source of truth.
 *
 * Every operation swallows failures into its fallback value: IndexedDB is
 * unavailable in some private-browsing modes, and the caller then simply
 * degrades to in-memory keys (one extra passkey tap per visit).
 */

const DB_NAME = 'assets-keys';
const STORE = 'dek';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE)) {
				request.result.createObjectStore(STORE);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function cacheKey(userUuid: string, purpose: string): string {
	return `${userUuid}/${purpose}`;
}

async function withStore<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const request = run(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

export async function getCachedDek(userUuid: string, purpose: string): Promise<CryptoKey | null> {
	try {
		const value = await withStore('readonly', (store) => store.get(cacheKey(userUuid, purpose)));
		return value instanceof CryptoKey ? value : null;
	} catch {
		return null;
	}
}

export async function putCachedDek(
	userUuid: string,
	purpose: string,
	dek: CryptoKey
): Promise<void> {
	try {
		await withStore('readwrite', (store) => store.put(dek, cacheKey(userUuid, purpose)));
	} catch {
		// Cache miss on the next visit costs one passkey tap; nothing to do.
	}
}

/** Drops every cached key — call on sign-out or when the signed-in user changes. */
export async function clearCachedDeks(): Promise<void> {
	try {
		await withStore('readwrite', (store) => store.clear());
	} catch {
		// Nothing cached or no IndexedDB; either way there is nothing to purge.
	}
}
