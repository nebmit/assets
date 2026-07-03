# Passkey-derived client-side encryption (WebAuthn PRF)

Client-side encryption keyed by the shared timben.net passkeys — no
passwords, no recovery email, no personal information. The SSO host
(core.timben) registers passkeys with the WebAuthn PRF extension enabled;
because the RP ID is the parent domain (`timben.net`), any `*.timben.net`
app can run an assertion ceremony against those credentials and have the
authenticator evaluate its PRF.

## How the pieces fit

```
passkey ceremony (prf.ts)          envelope (envelope.ts)
────────────────────────           ─────────────────────────────
navigator.credentials.get()   →    PRF output (32 bytes, per-credential)
  + prf eval over purpose salt →   HKDF-SHA256 → KEK (AES-GCM 256)
                                   KEK wraps a random DEK
                                   DEK encrypts the actual payloads
```

- The **DEK** is generated once per user and stored *wrapped* (server-side
  storage is fine — it's ciphertext).
- Each enrolled passkey produces a **different PRF output**, so the DEK is
  wrapped once per passkey. Enrolling another passkey requires one unwrap
  (`extractable: true`) and one extra wrap.
- The PRF output only leaves the authenticator after **user verification**,
  and the ceremony must be started from a user gesture.

```ts
const kek = await derivePrfKek({ purpose: 'assets-user-data' });
const dek = await unwrapDek(storedBlob, kek); // or generateDek() on first use
const ciphertext = await encryptJson(dek, watchlist);
```

## Constraints to keep in mind

- **Lost passkeys = lost data.** There is deliberately no fallback. Surface
  this in the UI and push users to enroll a second passkey before trusting
  encrypted storage.
- **Support is progressive enhancement.** Synced platform passkeys (iCloud
  Keychain, Google Password Manager) on current browsers are reliable;
  security keys must have been registered PRF-capable; some combinations
  (Firefox on Android, security keys on iOS) don't do PRF at all. Catch
  `PrfNotAvailableError` and degrade gracefully.
- **Don't rotate the purpose string.** `purpose` determines the PRF salt and
  the HKDF domain; changing it derives a different KEK and orphans every
  wrapped DEK.
