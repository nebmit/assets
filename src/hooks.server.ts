import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { paraglideMiddleware } from '$lib/paraglide/server';

const AUTH_URL = import.meta.env.VITE_AUTH_URL;
const LOGIN_URL = import.meta.env.VITE_LOGIN_URL;

const handleParaglide: Handle = ({ event, resolve }) => paraglideMiddleware(event.request, ({ request, locale }) => {
	event.request = request;

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
	});
});

const handleAuth: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get('session_id');
	
	// Check if this is a protected route
	if (!sessionId && isProtectedRoute(event.url.pathname)) {
		// Validate and use a relative redirect URI to prevent open redirects
		const redirectUri = encodeURIComponent(event.url.pathname + event.url.search);
		throw redirect(303, `${LOGIN_URL}?redirect_uri=${redirectUri}`);
	}

	// Validate the session token
	const user = await validateToken(sessionId);
	if (user) {
		event.locals = {
			user: {
				isAuthenticated: true,
				uuid: user.uuid
			}
		};
	} else {
		// If token is invalid and route is protected, redirect to login with current path
		if (isProtectedRoute(event.url.pathname)) {
			const redirectUri = encodeURIComponent(event.url.pathname + event.url.search);
			throw redirect(303, `${LOGIN_URL}?redirect_uri=${redirectUri}`);
		}
	}

	return resolve(event);
};

function isProtectedRoute(pathname: string): boolean {
	// Define routes that don't require authentication
	const publicRoutes = ['/', '/health'];
	return !publicRoutes.includes(pathname);
}

async function validateToken(token: string | undefined): Promise<{ uuid: string } | null> {
	if (!token || !AUTH_URL) {
		return null;
	}

	try {
		// Session tokens from cookies are sent directly in the Authorization header
		// The auth provider will validate the session token format
		const response = await fetch(AUTH_URL, {
			headers: {
				'Authorization': `Bearer ${token}`
			}
		});

		if (!response.ok) {
			return null;
		}

		const content = await response.json();

		if (content.success) {
			return content.user;
		}

		return null;
	} catch (error) {
		// Log only error type to avoid exposing sensitive information
		console.error('Token validation failed:', error instanceof Error ? error.name : 'Unknown error');
		return null;
	}
}

export const handle: Handle = sequence(handleAuth, handleParaglide);
