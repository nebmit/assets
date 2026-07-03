// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** SSO user from the shared timben.net session cookie; null when signed out. */
			user: { uuid: string; elevated: boolean } | null;
		}
		// interface PageData {}
		// interface Platform {}
	}
}

export {};
