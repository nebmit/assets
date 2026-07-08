/** Svelte context plumbing so any component can reach the layout's store instances. */

import { getContext, setContext } from 'svelte';
import type { IgnoreConfirmController } from './ignoreConfirm.svelte';
import type { IgnoredAssetsStore } from './ignoredStore.svelte';
import type { UserDataKeyring } from './keyring.svelte';
import type { EncryptedListStore } from './listStore.svelte';

export interface UserDataContext {
	keyring: UserDataKeyring;
	watchlist: EncryptedListStore;
	ignored: IgnoredAssetsStore;
	ignoreConfirm: IgnoreConfirmController;
}

const KEY = Symbol('user-data');

export function provideUserData(context: UserDataContext): void {
	setContext(KEY, context);
}

function getUserData(): UserDataContext {
	return getContext<UserDataContext>(KEY);
}

export function getWatchlist(): EncryptedListStore {
	return getUserData().watchlist;
}

export function getIgnored(): IgnoredAssetsStore {
	return getUserData().ignored;
}

export function getIgnoreConfirm(): IgnoreConfirmController {
	return getUserData().ignoreConfirm;
}
