# Implementation status

Last updated: 2026-11-02.

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

After reloading the current build, approve the new read-only event scope through Reconnect where required and exercise the live checks in `STAGE-3.md`. Continue the stage 1 two-account/lifecycle matrix before treating multi-account authentication as accepted. First-account connection is user-confirmed; live stage 3 event reads are not yet verified. Custom sounds, notifications, snooze, DND, and secondary zones remain stage 5.

## Bounded event panels and current-hour navigation · v0.3.7

Event-list popovers now remain inside the actual browser viewport, including the bottom corners of an 800×600 popup and smaller windows. Their bodies scroll independently so long lists and close controls remain accessible. Measured hover-card placement replaces fixed size estimates; long text wraps inside bounded previews/details. Public FullCalendar hooks and its popover z-index variable preserve modal layering without private CSS selectors.

Week entry now reveals the current hour if it is offscreen, with a small amount of context above the hour. It waits for slot sizing, uses the primary zone and configured range, skips fit mode, and leaves an already-visible hour in place. Periodic clock updates and normal manual scrolling do not reset the position.

Validation: **134 unit/adapter tests**, TypeScript, formatting, production build, and **ten isolated Chromium tests** pass. New browser cases cover all four month-grid corners, long-list scrolling, close-button access, hover/detail containment, resizing to 760×500, opening/switching Week at 11:45, an already-visible hour in a larger calendar, fit mode, and a display-zone change. Fictional popup/detail/current-hour screenshots were inspected; no live Google acceptance is inferred.

## Event-colored toolbar badge · v0.3.6

The badge background now matches the selected event's normalized color for both today's time and later-day labels. Text switches between black and white for the higher contrast ratio. Reconnect/storage warning backgrounds stay red.

Validation: **134 unit/adapter tests**, TypeScript, formatting, production build, and **eight isolated Chromium tests** pass. Existing badge coverage now verifies selection of the correct event color, foreground contrast for dark/light colors, native Chrome background/text colors during event changes, and preserved warning color.

## Full-size icon and next-event badge · v0.3.5

The toolbar icon now uses full-canvas calendar artwork with transparent corners and no enclosing tile/border. The local deterministic generator creates 16/24/32/48/128-pixel assets with supersampling; `action.default_icon` explicitly selects the toolbar resolutions.

The event badge defaults on: it shows only today's next timed start (`HH:mm`), or `+Nd` for a later calendar date, using the primary zone. It skips all-day/declined/already-started events, paused accounts, and hidden calendars, and uses the UI's coverage-preferred shared-calendar selection. The tooltip identifies the next saved event. Reconnect and storage warnings retain priority. Appearance settings can disable event display. The existing one-minute tick refreshes it before/after due sync; account/settings/cache changes also update it. It works from local cache offline and reconstructs on startup, without tokens in badge data, new permissions, or reminder delivery.

Validation: **134 unit/adapter tests**, TypeScript, formatting, production build, and **eight isolated Chromium tests** pass. New coverage includes time-only/day-distance selection, local-date boundaries, both DST transitions, filtering/shared calendars, cursor-free cache reads, warning priority, and real Chrome toolbar text changes through the actual alarm while offline. Icon assets were visually inspected. Live Google multi-account acceptance remains pending.

## Readable and fit week layouts · v0.3.4

Week view now defaults to a 48-pixel minimum per hour and scrolls within the calendar when the selected hour range is too tall. Calendar appearance settings expose **Week view layout** (readable/fit) and **Minimum hour height** (32–120 pixels). Fit mode shows the configured day without vertical scrolling on popup and full calendar; it preserves the saved minimum for switching back. Legacy preferences receive the new defaults. Month layout, sync behavior, and native popup document sizing are unchanged.

Validation: **119 unit/adapter tests**, TypeScript, formatting, production build, and **seven isolated Chromium tests** pass. Browser checks verify native 800×600 popup sizing with scrolling and fit layouts, 24-hour scrolling at the requested minimum, access to the last hour, live propagation between Settings/popup/full calendar, fit mode without scroll, and restoration of the saved layout/minimum through a browser restart. Native popup and week screenshots were inspected. No live Google acceptance is inferred from these UI checks.

## Explicit Google account chooser · v0.3.3

The native Add flow returned the existing identity without a chooser in the user's real second-account attempt. This fails the original native chooser gate. Add now rejects duplicate identities before calendar-list loading, preserves existing accounts/cache, and displays an accurate error instead of claiming a second addition succeeded.

An optional Web application client enables explicit `prompt=select_account` authorization through Chrome's intercepted redirect. Existing native connections retain their method. New web accounts verify the selected `sub`, use a memory-only token cache and bounded silent authorization with `login_hint=sub`, and require Reconnect when the Google session cannot renew silently. Current read-only scopes only; no server, secret, refresh-token persistence, consent revocation, or extra Chrome permissions. See ADR 0005 for Google's legacy-flow caveat and live acceptance gate.

The user-supplied public Web client ID is configured only in ignored local build settings. The existing native client/key are preserved; redirect registration is not independently verified. Settings exposes the public client ID and exact redirect. Automated validation: **114 unit/adapter tests** and **six isolated Chromium tests**, TypeScript, formatting, and production build pass. The new browser fixture exercises the actual Settings chooser control, native-plus-web accounts, pinned checks, duplicate rejection, and token-free persisted state. These fixtures do not establish live Google success. Next: reload v0.3.3 and add the second real account; continue two-account renewal/restart/revocation acceptance.

## Preview removal · v0.3.2

Removed the preview toggle, data-source setting, sample-cache controls, sample details/styles, and bundled sample generator. Both calendar surfaces always read Google events. Settings now offers **Sync Google calendars**. Existing data-source preferences are ignored; schema 3 drops the old preview table and deletes its seed markers while preserving Google events, cursors, coverage, and unrelated metadata. No accounts or OAuth configuration need to be reset. The compact week grid also clips its current-time marker at the day boundary so it cannot create a scrollbar near midnight.

Validation: **93 unit/adapter tests**, TypeScript, formatting, production build, and **five isolated Chromium tests** pass. Migration cases cover both legacy schemas and reopening; browser checks cover the empty Google calendar, absence of preview controls, native popup sizing, shared settings, provider-fixture event details/filtering, and cached Google events after an offline browser restart. Live Google acceptance remains pending.

## Manual sync display correction · v0.3.1

The user reported a sync-completion notice while the popup still displayed samples. Explicit manual sync now persists Google as the shared data source before fetching; automatic refreshes preserve demo mode. Settings labels the action **Sync and show Google calendars**, explains its effect while samples are selected, and reports source selection rather than implying all calendars succeeded. Network/storage errors cannot silently substitute demo events.

Validation: **97 unit/adapter tests**, TypeScript, formatting, production build, and **five Chromium tests** pass. The synthetic Google flow now opens both calendar surfaces in demo mode, clicks the actual Settings sync action, verifies both switch to Google events, and retains the existing offline/restart checks. The production bundle is v0.3.1; live user-account event acceptance remains pending.

## Stage 3 · v0.3.0

Implemented: read-only Google event scope; identity-verified event operations; paginated unexpanded change feed and separate bounded expanded instances; independent calendar cursors and durable backoff; atomic cache/coverage/cursor replacement; 410 rebuild with stale-cache preservation; orphan/account/calendar cleanup; schema 1→2 migration; interrupted-worker recovery; and one-minute background scheduling of the configurable per-calendar cadence.

The UI now reads real cached Google events, distinguishes offline/stale/uncovered dates from successful empty results, selects the best cached copy of shared calendars, and exposes event/recurrence details and safe HTTPS links. Settings adds sync interval, refresh on open, cache months, and per-calendar checks/errors/retry/coverage information. Diagnostics include only aggregate sync counts and safe settings; no content, OAuth tokens, cursor values, or identifiers.

Verification:

- `npm run check`: TypeScript, **92 unit/adapter tests**, formatting, and the v0.3.0 production build pass.
- **Five isolated Chromium tests** cover the native popup and previous regressions, independent sync-setting restart persistence, and the production worker's complete synthetic Google flow: account connect, scoped reads, occurrence updates, unchanged-feed optimization, safe details, diagnostic redaction, cache display, offline preservation, and Google-cache survival through a full offline browser restart. Uncached future dates are explicitly labelled.
- Fixture Google/full-calendar/popup/offline screenshots were inspected. No personal Chrome profile or live Google credentials were used for stage 3 tests. The fixture uses a disposable copied extension with a synthetic public client; the final build preserves `.env.local`.
- Local application storage only; no backend, remote scripts, telemetry, new Chrome host permissions, or event-writing scope. The production bundle is `.output/chrome-mv3`.

The existing OAuth app's Data Access scopes were configured through Google Cloud Console and save-confirmed on 2026-11-01: OpenID, email, calendar-list read, and event read. Its scope list had been empty. The local gcloud SDK still fails with an OS-level “Operation not permitted”; no CLI configuration change or Cloud log read is claimed. Users must still reconnect to grant the additional event scope. Live event/multi-account/recurrence/lifecycle acceptance remains pending; saving the app's scope declarations does not prove those flows. See `STAGE-3.md` and ADR 0004.

The user subsequently requested future-stage permissions. `calendar.events` was added to the same Cloud Data Access list and save-confirmed, preparing stage 4 event creation/editing. The five Cloud declarations now include both event read and write scopes; v0.3.0 runtime authorization remains read-only. Stage 5's `notifications` and `offscreen` are Chrome manifest permissions to add with their features, not Cloud OAuth scopes. No application code or active grant was broadened by this Cloud declaration.

## Stage 2 · v0.2.2

Implemented: modern popup/full-tab month and week calendar, date navigation and sidebar, calendar visibility and text/type filters, event dialog and one-second hover previews, keyboard event access, reactive Dexie storage, isolated local sample data, and a shared appearance/settings page. Preferences include primary time zone, visible week hours, week start/weekends, clock format, theme, density, default view, and explicit demo/Google mode.

Existing accounts and OAuth configuration are preserved. New appearance defaults are compatible with stage 1 records. Settings updates are worker-serialized partial patches; individual visibility-key changes preserve other calendars. Diagnostic exports remain free of visibility identifiers. There are no new extension permissions or Google scopes.

Verified locally:

- `npm run check`: strict TypeScript, **67 unit/adapter tests**, formatting, and production build pass. New cases cover legacy preferences, independent patches, diagnostic privacy, database isolation/reset/reopening, valid event instants, exclusive all-day ends, DST, overnight date labels, and filters.
- **Four isolated Chromium extension tests pass**: actual toolbar-popup sizing/reopening; native transport and settings/alarm restart persistence; affected-account reconnect popup/badge behavior; calendar navigation, filters, click/keyboard details, shared theme changes, demo/Google separation, and offline browser-restart persistence. Popup page checks verify all six month rows fit and overflow controls do not overlap events.
- Month, week, compact popup, options, and dark-theme screenshots were inspected using fictional test data. The browser tests use disposable profiles, with no live Google authorization or personal Chrome profile.
- Stage 2 was verified with v0.2.2; the current bundle is stage 3 v0.3.2. Generated output and screenshots remain ignored.

Google event sync is **not implemented** in this release. Demo preview is explicitly labelled; My calendars explains that sync has not started. Sample-only cache reset cannot touch reserved Google rows. See `STAGE-2.md` and ADR 0003.

Popup layout refinement (v0.2.1): grid spans the available width, toolbar/context replace the taller header stack, and month overflow adapts to available height. Week view uses hourly slots with compact labels, fitting the selected hours without scrolling. Page-based browser coverage checked full width and absence of page/calendar scroll overflow at 800×600 and 760×600, all 24 hours with a 12-hour clock, and the month layout with a reconnect warning. Those page tests did not prove native toolbar-popup sizing.

Native sizing correction (v0.2.2): reproduced the user's failure with a real `chrome.action.openPopup()` window at 25×25. Viewport-relative component caps accepted that initial minimum size and prevented expansion. The popup now requests dimensions through a head-linked document stylesheet independently of React and fits its visible content to the granted viewport. The native regression checks opening/reopening at 800×600 on an explicitly configured 1440×1000 virtual display. A smaller native display may grant less height, which the content follows.
