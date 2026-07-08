---
name: verify
description: Build, launch and drive this app end-to-end (dev server + scratch Postgres + stubbed SSO + Chromium with a PRF-capable virtual authenticator) to verify changes at the real surface.
---

# Verifying assets end-to-end

The app is a SvelteKit dev server over Postgres, with auth delegated to the
SSO host (core.timben) via the `session_id` cookie. Everything below runs
without core: SSO is a 15-line stub.

## 1. Database (Postgres ≥ 16 must be installed; no Docker needed)

```bash
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/testdata -A trust -U postgres"
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/testdata -l /var/lib/postgresql/test.log -o '-p 5433 -k /var/lib/postgresql' start"
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/createdb -p 5433 -h 127.0.0.1 assets_dev -U postgres"
DATABASE_URL="postgres://postgres@127.0.0.1:5433/assets_dev" npm run seed:demo   # runs migrations + seeds demo cards
```

Note: postgres can't traverse the session scratchpad path — keep the data
dir under /var/lib/postgresql. Integration tests: set `TEST_DATABASE_URL`
(a separate, throwaway DB — tests drop the schema) and run `npm test`.

## 2. SSO stub (any Bearer session id → fixed test user)

```js
// sso-stub.mjs — run with: node sso-stub.mjs &
import http from 'node:http';
http.createServer((req, res) => {
    if (req.url === '/auth/sso' && req.headers.authorization?.startsWith('Bearer ')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { uuid: '11111111-2222-4333-8444-555555555555', elevated: false } }));
        return;
    }
    res.writeHead(404); res.end();
}).listen(5172);
```

## 3. App

```bash
DATABASE_URL="postgres://postgres@127.0.0.1:5433/assets_dev" AUTH_ORIGIN="http://localhost:5172" \
  npm run dev -- --port 5173 --strictPort &
```

Sign-in = adding cookie `session_id=anything` for `localhost` in the browser
context. Authenticated APIs are then live (`/api/keywraps`, `/api/user-blobs/…`).

## 4. Browser (Playwright is installed globally; never `playwright install`)

```bash
NODE_PATH=/opt/node22/lib/node_modules node your-driver.cjs
# chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true })
```

Passkeys/PRF (watchlist encryption) need a virtual authenticator via CDP:

```js
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
               hasUserVerification: true, isUserVerified: true, hasPrf: true,
               automaticPresenceSimulation: true }
});
```

Create the "shared timben.net passkey" (normally made during core sign-up) by
calling `navigator.credentials.create` from the page with `rp.id: 'localhost'`,
`residentKey: 'required'`, `extensions: { prf: {} }`.

## Gotchas

- **Hydration race**: after a full page load, wait ~2s before clicking —
  SSR paints the UI before event handlers attach, and clicks landing in that
  window silently do nothing.
- **Hash-only navigations don't reload**: `page.goto` to a URL differing only
  in `#fragment` won't re-run the app. Interpose `page.goto('about:blank')`
  when testing the SSO key-handoff fragment.
- **Simulating the SSO handoff**: wrap `navigator.credentials.get` via
  `addInitScript` to capture `getClientExtensionResults().prf.results.first`
  from the app's own unlock ceremony, then navigate to
  `/#prf=<b64url output>&prf_cred=<cred id>&prf_purpose=assets-user-data`.
  Removing the virtual authenticator first proves the fragment (not a
  ceremony) did the unlock.

## Flows worth driving after changes in this area

Unlock (locked → ceremony → ready), star/unstar from Overview, watchlist tab
(cards + management panel + tab count), remove, reload (silent IndexedDB
restore), handoff fragment (unlock with authenticator removed; fragment must
vanish from the URL), malformed/wrong-key fragments (degrade to locked),
signed-out state, and the API's 400/401/404/409/413 responses.
