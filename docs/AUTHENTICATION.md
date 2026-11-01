# Authentication design

## Current adapter

The stage 1 prototype uses `chrome.identity.getAuthToken` with a Chrome Extension OAuth client. Chrome manages token expiration and renewal. No refresh token or client secret is handled by this app.

Scopes currently requested:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/calendar.calendarlist.readonly
```

The OAuth manifest is omitted when no client ID is configured, so the extension remains loadable with a clear setup state. A configured but malformed client ID is rejected at build time.

## Explicit account onboarding

An Add Google account action resets this extension's remembered native account choice with `clearAllCachedAuthTokens`, then calls interactive `getAuthToken`. This can invalidate other cached tokens belonging to this extension; their durable account metadata remains intact and their next check requests a new token by verified account ID. The operation does not sign the user out of Google's browser sessions.

The returned token is used to fetch `https://www.googleapis.com/oauth2/v3/userinfo`. Verified `sub` and email are required before loading the calendar list. Re-selecting a previously connected identity updates that record instead of creating a duplicate.

Native chooser behavior is a **live feasibility gate**, not a guarantee established by unit tests. Chrome's stable API does not enumerate all Google web sessions. The implementation uses no cookie scraping, private Google endpoints, hard-coded Gmail account indexes, or Dev-channel-only APIs.

## Known-account checks and reconnect

Every subsequent check pins `getAuthToken` to `{ account: { id: savedGoogleSub } }`. It verifies the profile `sub` again before reading calendars. If Google returns a different account, the app preserves the intended account's saved data and requires reconnection.

- Startup/alarms/manual checks request tokens noninteractively.
- Reconnect is interactive only after a user action and uses the intended account ID.
- HTTP 401 evicts the individual cached token and retries once noninteractively for that account.
- Test token renewal explicitly evicts a single token and obtains another. This checks re-acquisition, not natural expiration or refresh-token behavior.
- Calendar-list access is read-only in stage 1. Do not claim event read/write verification from a successful list request.

Every outgoing request uses an Authorization header, never a token query parameter; no credentials/cookies are attached. Requests reject redirects and time out after 15 seconds. Token strings and raw provider error details never cross the worker/UI boundary or enter logs, diagnostics, or persistence.

## What remains to be proven

With one registered OAuth client and two real accounts in stable Chrome:

1. Explicit chooser can authorize each desired account.
2. Each saved `sub` is accepted by native account-specific token requests.
3. Both accounts can continue being checked after adding the second one.
4. A full browser restart retains metadata and can silently reacquire account-specific access.
5. Natural access-token expiry recovers without prompting when consent remains valid.
6. Revoking one account's consent leaves the other usable and raises the correct badge/banner.
7. Reconnecting the affected account clears only its failure.

Until these pass, stage 1's implementation is ready for testing but the authentication feasibility gate is open. If native behavior fails, investigate a supported `launchWebAuthFlow` alternative with its actual Google client-type/redirect/renewal requirements, record an ADR, and test it before adopting it. Do not ship a speculative OAuth/PKCE flow or embed a web-client secret as a shortcut.

## References

- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Chrome OAuth tutorial](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)
