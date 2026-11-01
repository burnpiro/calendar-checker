# Implementation status

Last updated: 2026-11-01.

## Stage 1

Implemented: local Git project, WXT/React/strict TypeScript, stable extension ID, optional build-time OAuth client configuration, native identity adapter, account isolation, calendar-list loading/cache, silent token checks/retry, reconnect controls and badge, enabled-account checks, local preferences, popup/options UI, and sanitized diagnostics.

Verified locally:

- Strict TypeScript and production build pass.
- 38 unit/adapter tests pass, covering identity pinning, retry limits, partial consent, offline preservation, independent accounts, safe persistence and diagnostics, queue ordering, and alarm recovery.
- Two isolated Chromium extension tests pass: settings and alarm persistence across a full browser restart; account-specific popup warning and toolbar badge removal when an affected account is paused. The latter uses synthetic local account records, not live Google authorization.
- Both missing-client setup and configured OAuth manifest generation were exercised. The configured build used a clearly synthetic client ID, not a registered Google credential.
- Popup and options screenshots were visually inspected. No personal Chrome profile was used.
- Dependencies are pinned in the lockfile; npm installation reported no known vulnerabilities.

The final distributable build intentionally has no OAuth client configured and opens in setup mode. Generated builds and test screenshots remain local and Git-ignored.

Live OAuth checks: **pending**. The user is obtaining the public Google OAuth client ID. No real two-account success, natural token-expiry recovery, or revoked-consent behavior is claimed. Follow `STAGE-1-VALIDATION.md`.

## Next work

Finish the stage 1 live matrix once the client is configured. Resolve any native chooser/account-ID/renewal failures before treating the provider architecture as accepted. Stage 2 then introduces the calendar shell; stages 3–5 implement events, offline writes, sounds, notifications, DND, time zones, and the broader settings page.
