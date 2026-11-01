# ADR 0001: Start with native Chrome OAuth

Date: 2026-11-01

Status: Provisional; implementation available, live two-account acceptance pending.

## Context

The app must run locally, access multiple Google calendars, avoid an application backend, and survive token expiry/browser restarts. Stable Chrome cannot enumerate all signed-in Google accounts through `identity.getAccounts`.

## Decision

Use a registered Chrome Extension OAuth client and Chrome-managed access tokens for the stage 1 prototype. Add accounts explicitly through native authorization; retain verified Google `sub` identifiers and request subsequent tokens by account ID. Check the returned identity before reading calendar data.

Reset this extension's remembered chooser/token cache only during explicit Add account. Never clear all accounts' token caches during background checks or reconnect. Use a committed public manifest key to keep the unpacked extension ID stable. Add event access scopes only when those features are implemented.

## Consequences

- No app backend, embedded client secret, local refresh-token database, or remote JavaScript SDK is required.
- One account's network or authorization failure can be isolated from the others.
- Adding another account can evict cached tokens belonging to this extension; existing records remain and must successfully reacquire pinned tokens.
- Native chooser behavior, Google `sub` compatibility with account-specific requests, and renewal across full restarts remain empirical acceptance gates.
- If the native adapter fails these gates, document and test a supported alternative rather than silently weakening account verification or scraping sessions.

## Evidence

Automated tests cover the service and adapter behavior, not Google's live chooser. Real acceptance results belong in `../STAGE-1-VALIDATION.md`.
