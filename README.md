# assets

Secure portfolio management application with SSO authentication.

## Prerequisites

Ensure you have the latest LTS version of Node.js installed.

## Getting Started

### Installation

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/nebmit/assets.git
cd assets
npm install
```

2. Configure environment variables:

Create a `.env` file in the root directory with the following variables:

```env
# Authentication Configuration (Required)
VITE_AUTH_URL=https://your-auth-domain.com/auth
VITE_LOGIN_URL=https://your-auth-domain.com/login

# Application Configuration (Optional)
# PORT=3000
# ORIGIN=http://localhost:3000
```

- `VITE_AUTH_URL`: URL for token validation endpoint
- `VITE_LOGIN_URL`: URL for SSO login redirect

Refer to `.env.example` for a template.

## Developing

Start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

## Authentication

This application uses SSO (Single Sign-On) authentication with passkey support. The authentication flow:

1. User clicks "Sign In / Register" button
2. User is redirected to the SSO provider (configured via `VITE_LOGIN_URL`)
3. After successful authentication, user is redirected back with a session cookie
4. The application validates the session token against the auth provider (`VITE_AUTH_URL`)
5. User proceeds to encryption setup or unlock based on their account status

## Deployment

The application uses `@sveltejs/adapter-node` for deployment. Ensure your deployment environment has the necessary environment variables configured.
