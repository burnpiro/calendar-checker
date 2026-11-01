# ADR 0005: Optional explicit Google account chooser

Date: 2026-11-02

Status: Implemented for local validation in v0.3.3; real second-account and lifecycle acceptance remain pending.

## Evidence and problem

The user reports that Add Google account returns the already connected identity without a chooser. Clearing Chrome's client token cache does not reliably reset Google's server-side account selection. `getAuthToken` has no documented `prompt` option; without an account ID it selects a profile/default account. Stable `getAccounts` is unavailable. Do not revoke existing Google consent or scrape sessions to force a different choice.

## Decision

Keep existing Chrome-managed connections unchanged. Add an optional Web application OAuth client and Google's documented browser token flow through `chrome.identity.launchWebAuthFlow`. New-account requests set `prompt=select_account`. Existing web connections set the verified Google `sub` as `login_hint`; silent requests use `prompt=none`, `interactive=false`, and a 15-second timeout. A hint never replaces identity verification: verify userinfo before any calendar access. Persist only `authMethod: web`, account metadata, and the public client ID setting.

The redirect is exactly `https://<extension-id>.chromiumapp.org/`, intercepted by Chrome. This requires a separate Web application client with that authorized redirect, not the existing Chrome Extension client. A client secret is never requested, embedded, exchanged, or stored. Only the current read-only scopes are requested.

Validate callback origin/path, a fresh unpredictable state, unique parameters, Bearer type, bounded lifetime/token length, and the complete scope grant before using a token. Tokens/callback URLs stay inside the worker; the small per-account/client cache is memory-only and is lost on worker/browser restart. HTTP 401 invalidates the matching entry and allows the existing one pinned retry. No token is persisted in storage or sent to UI. Google failures remain sanitized.

Reject an already connected `sub` before loading calendar lists. Preserve existing accounts/cache and return a specific failure instead of showing an addition-success message. Users reconnect existing accounts through their account card.

## Tradeoffs and acceptance gate

Google now discourages the implicit browser grant in favor of authorization code/PKCE; the documented token flow remains a legacy option. A Web application code exchange requiring a confidential client secret/application server does not meet this project's local-only design. This choice is a constrained optional path, not a claim that implicit flow is Google's preferred architecture or that PKCE is supported here without a backend.

There is no refresh token or guaranteed background renewal. After the memory cache expires or the worker restarts, silent authorization depends on a usable Google session and existing consent. Otherwise require explicit Reconnect and keep cached data. Do not open background sign-in windows. If live second-account, restart, or renewal checks fail, revisit this architecture before claiming production multi-account support. Do not quietly introduce a client secret, persist bearer tokens, revoke existing consent, or substitute accounts.

The user supplied a public Web client ID on 2026-11-02. It is configured only in ignored local build settings, preserving the existing native client. The authorized redirect registration has not been independently inspected. Synthetic tests establish implementation behavior, not Google's live acceptance of the client or durable session behavior.

## Sources

- [Chrome Identity reference](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google client-side OAuth requirements, parameters, callback and grant validation](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [Chrome team discussion of native account selection and cache reset limits](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/4OX3cv_wepY)
