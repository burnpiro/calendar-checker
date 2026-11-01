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

Stage 4: event creation/editing, writable account/calendar selection, recurrence edit semantics, durable outbox, retry-safe creation, and conflict resolution. Add event-write scope only with that feature and protect pending edits from cache reconciliation/removal.

After reloading v0.3.0, approve the new read-only event scope through Reconnect where required and exercise the live checks in `STAGE-3.md`. Continue the stage 1 two-account/lifecycle matrix before treating multi-account authentication as accepted. First-account connection is user-confirmed; live stage 3 event reads are not yet verified. Custom sounds, notifications, snooze, DND, and secondary zones remain stage 5.

## Stage 3 · v0.3.0

Implemented: read-only Google event scope; identity-verified event operations; paginated unexpanded change feed and separate bounded expanded instances; independent calendar cursors and durable backoff; atomic cache/coverage/cursor replacement; 410 rebuild with stale-cache preservation; orphan/account/calendar cleanup; schema 1→2 migration; interrupted-worker recovery; and one-minute background scheduling of the configurable per-calendar cadence.

The UI now reads real cached Google events, distinguishes offline/stale/uncovered dates from successful empty results, selects the best cached copy of shared calendars, and exposes event/recurrence details and safe HTTPS links. Settings adds sync interval, refresh on open, cache months, and per-calendar checks/errors/retry/coverage information. Diagnostics include only aggregate sync counts and safe settings; no content, OAuth tokens, cursor values, or identifiers.

Verification:

- `npm run check`: TypeScript, **92 unit/adapter tests**, formatting, and the v0.3.0 production build pass.
- **Five isolated Chromium tests** cover the native popup and previous regressions, independent sync-setting restart persistence, and the production worker's complete synthetic Google flow: account connect, scoped reads, occurrence updates, unchanged-feed optimization, safe details, diagnostic redaction, cache display, offline preservation, and Google-cache survival through a full offline browser restart. Uncached future dates are explicitly labelled.
- Fixture Google/full-calendar/popup/offline screenshots were inspected. No personal Chrome profile or live Google credentials were used for stage 3 tests. The fixture uses a disposable copied extension with a synthetic public client; the final build preserves `.env.local`.
- Local application storage only; no backend, remote scripts, telemetry, new Chrome host permissions, or event-writing scope. The production bundle is `.output/chrome-mv3`.

Live acceptance remains pending for the additional event scope and real multi-account/recurrence/lifecycle behavior. See `STAGE-3.md` and ADR 0004. No new Google Cloud project/client is needed; update the existing OAuth Data Access scopes and reconnect accounts as necessary.

## Stage 2 · v0.2.2

Implemented: modern popup/full-tab month and week calendar, date navigation and sidebar, calendar visibility and text/type filters, event dialog and one-second hover previews, keyboard event access, reactive Dexie storage, isolated local sample data, and a shared appearance/settings page. Preferences include primary time zone, visible week hours, week start/weekends, clock format, theme, density, default view, and explicit demo/Google mode.

Existing accounts and OAuth configuration are preserved. New appearance defaults are compatible with stage 1 records. Settings updates are worker-serialized partial patches; individual visibility-key changes preserve other calendars. Diagnostic exports remain free of visibility identifiers. There are no new extension permissions or Google scopes.

Verified locally:

- `npm run check`: strict TypeScript, **67 unit/adapter tests**, formatting, and production build pass. New cases cover legacy preferences, independent patches, diagnostic privacy, database isolation/reset/reopening, valid event instants, exclusive all-day ends, DST, overnight date labels, and filters.
- **Four isolated Chromium extension tests pass**: actual toolbar-popup sizing/reopening; native transport and settings/alarm restart persistence; affected-account reconnect popup/badge behavior; calendar navigation, filters, click/keyboard details, shared theme changes, demo/Google separation, and offline browser-restart persistence. Popup page checks verify all six month rows fit and overflow controls do not overlap events.
- Month, week, compact popup, options, and dark-theme screenshots were inspected using fictional test data. The browser tests use disposable profiles, with no live Google authorization or personal Chrome profile.
- Stage 2 was verified with v0.2.2; the current bundle is stage 3 v0.3.0. Generated output and screenshots remain ignored.

Google event sync is **not implemented** in this release. Demo preview is explicitly labelled; My calendars explains that sync has not started. Sample-only cache reset cannot touch reserved Google rows. See `STAGE-2.md` and ADR 0003.

Popup layout refinement (v0.2.1): grid spans the available width, toolbar/context replace the taller header stack, and month overflow adapts to available height. Week view uses hourly slots with compact labels, fitting the selected hours without scrolling. Page-based browser coverage checked full width and absence of page/calendar scroll overflow at 800×600 and 760×600, all 24 hours with a 12-hour clock, and the month layout with a reconnect warning. Those page tests did not prove native toolbar-popup sizing.

Native sizing correction (v0.2.2): reproduced the user's failure with a real `chrome.action.openPopup()` window at 25×25. Viewport-relative component caps accepted that initial minimum size and prevented expansion. The popup now requests dimensions through a head-linked document stylesheet independently of React and fits its visible content to the granted viewport. The native regression checks opening/reopening at 800×600 on an explicitly configured 1440×1000 virtual display. A smaller native display may grant less height, which the content follows.
