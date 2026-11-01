# Implementation status

Last updated: 2026-11-01.

## Stage 1

Implemented: local Git project, WXT/React/strict TypeScript, stable extension ID, optional build-time OAuth client configuration, native identity adapter, account isolation, calendar-list loading/cache, silent token checks/retry, reconnect controls and badge, enabled-account checks, local preferences, popup/options UI, and sanitized diagnostics.

Verified locally:

- Strict TypeScript and production build pass.
- 51 unit/adapter tests pass, covering identity pinning, retry limits, partial consent, offline preservation, independent accounts, safe persistence and diagnostics, queue ordering, alarm recovery, bounded GET retries, response-body interruption, safe failure-step reporting, and native-fetch receiver handling.
- Two isolated Chromium extension tests pass: native transport execution in a real extension worker plus settings/alarm persistence across a full browser restart; account-specific popup warning and toolbar badge removal when an affected account is paused. The latter uses synthetic local account records, not live Google authorization.
- Both missing-client setup and configured OAuth manifest generation were exercised. The configured build used a clearly synthetic client ID, not a registered Google credential.
- Popup and options screenshots were visually inspected. No personal Chrome profile was used.
- Dependencies are pinned in the lockfile; npm installation reported no known vulnerabilities.

The original build opened in setup mode. The user has since configured an OAuth client in the ignored local environment file; subsequent builds preserve that configuration. Generated builds, local credentials/configuration, and test screenshots remain Git-ignored.

Live OAuth checks: **partially exercised, full acceptance pending**. Native authorization and direct authorized account/calendar requests succeeded (HTTP 200); host access was present. The actual gateway failed because it invoked native `fetch` with an invalid receiver, which Chrome reported as `Illegal invocation`. This was reproduced in an extension worker and fixed with a global-context wrapper. Safe failure-step diagnostics and one bounded retry for actual transport failures have also been added. The user confirmed successful account connection after reloading the corrected bundle on 2026-11-01. No real two-account success, natural token-expiry recovery, or revoked-consent behavior is claimed. Follow `STAGE-1-VALIDATION.md`.

## Next work

Stage 3: add event read permissions and direct Google event synchronization, recurrence handling, coverage/cursors, stale/offline states, manual sync, and configurable event-sync timing. Extend the reserved Google cache deliberately; never populate it with samples or present an uncovered interval as an empty synced calendar.

Continue the stage 1 two-account/lifecycle validation with the configured client before treating multi-account authentication as accepted. First-account connection is user-confirmed. Event writing, custom sounds, notifications, snooze, DND, and secondary time zones remain stages 4–5.

## Stage 2 · v0.2.0

Implemented: modern popup/full-tab month and week calendar, date navigation and sidebar, calendar visibility and text/type filters, event dialog and one-second hover previews, keyboard event access, reactive Dexie storage, isolated local sample data, and a shared appearance/settings page. Preferences include primary time zone, visible week hours, week start/weekends, clock format, theme, density, default view, and explicit demo/Google mode.

Existing accounts and OAuth configuration are preserved. New appearance defaults are compatible with stage 1 records. Settings updates are worker-serialized partial patches; individual visibility-key changes preserve other calendars. Diagnostic exports remain free of visibility identifiers. There are no new extension permissions or Google scopes.

Verified locally:

- `npm run check`: strict TypeScript, **67 unit/adapter tests**, formatting, and production build pass. New cases cover legacy preferences, independent patches, diagnostic privacy, database isolation/reset/reopening, valid event instants, exclusive all-day ends, DST, overnight date labels, and filters.
- **Three isolated Chromium extension tests pass**: native transport and settings/alarm restart persistence; affected-account reconnect popup/badge behavior; calendar navigation, filters, click/keyboard details, shared theme changes, demo/Google separation, and offline browser-restart persistence. Popup checks verify all six month rows fit and overflow controls do not overlap events.
- Month, week, compact popup, options, and dark-theme screenshots were inspected using fictional test data. The browser tests use disposable profiles, with no live Google authorization or personal Chrome profile.
- Version 0.2.0 production bundle is available in `.output/chrome-mv3`; reload the unpacked extension to use it. Generated output and screenshots remain ignored.

Google event sync is **not implemented** in this release. Demo preview is explicitly labelled; My calendars explains that sync has not started. Sample-only cache reset cannot touch reserved Google rows. See `STAGE-2.md` and ADR 0003.
