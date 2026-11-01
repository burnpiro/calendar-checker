# Authentication design

## Current adapter

The native adapter uses `chrome.identity.getAuthToken` with a Chrome Extension OAuth client. Chrome manages token expiration and renewal. No refresh token or client secret is handled by this app.

Scopes currently requested:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events.readonly
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

Stage 3 adds event-read scope and `withVerifiedToken` for worker-owned event operations. It verifies the pinned identity before invoking the event gateway, retries one HTTP 401 silently, and persists reconnect status/badge on continued failure. Existing grants may need explicit reconnect. Event-specific calendar access failures are separate from OAuth consent failures. The event grant marker is set only after a successfully scoped operation; no write scope is requested.

Every outgoing request uses an Authorization header, never a token query parameter; no credentials/cookies are attached. Requests reject redirects and time out after 15 seconds, including body consumption. A failed read-only GET is retried at most once after 500 ms for transport failures/timeouts. If Chrome reports the device offline, the app skips that retry. HTTP authorization/permission errors and malformed JSON do not use this transport retry path; token renewal after HTTP 401 remains separate.

Diagnostics identify `authorization`, `account-details`, `calendar-list`, or `calendar-events`. Optional details are fixed network categories, bounded numeric browser network codes, HTTP statuses, and bounded retry seconds. Raw native/remote error messages, headers, tokens, callback URLs, and account data are not retained. Aggregate event-sync counts omit identifiers and content. Account records keep safe failure details for consistent UI after reopening the popup, and a successful check clears them. Provider sync cursors are local IndexedDB sync state, distinct from OAuth tokens, and are excluded from diagnostics and UI metadata.

## Investigating a connection failure

A generic fetch failure does not prove that the device is offline or that the OAuth client is misconfigured. Generate a report in Settings → Connection diagnostics and inspect the last failure's `details.stage` and `details.networkFailure`.

- `authorization`: Chrome's native token acquisition failed. `browserNetworkCode`, when present, is the native connection error number only.
- `account-details`: a token was obtained, but loading or validating the Google identity failed.
- `calendar-list`: identity was verified, but the calendar-list request failed.
- `calendar-events`: the worker failed while reading the event change feed or bounded instances. Settings shows calendar-specific errors and retry times.
- `timeout`: either headers or body did not arrive before the deadline.
- `offline`: Chrome explicitly reported an offline device. Other transport errors display as a connection issue rather than assuming offline use.

On 2026-11-01 direct checks in the configured extension succeeded: native token acquisition worked, authorized userinfo/Calendar API endpoints returned HTTP 200, and host access was present. No tokens or account contents were exposed. The gateway itself was then found to call a stored native `fetch` with the gateway as its receiver. Chrome rejected this with `Illegal invocation` before sending a request; Node mocks did not reproduce the browser's receiver requirement. The production transport now calls `globalThis.fetch` through an arrow wrapper, with unit and real-worker regression coverage. See ADR 0002. The user confirmed that the full account connection succeeded after reloading the corrected bundle. Multi-account and lifecycle acceptance remains pending. The gcloud SDK could not be executed from the coding session; no Cloud logs were read.

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
