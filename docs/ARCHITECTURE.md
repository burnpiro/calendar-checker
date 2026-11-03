# Architecture

## Boundaries

```text
React popup / full calendar / options
        |
validated, namespaced commands (no tokens)
        |
MV3 background worker -- native Chrome Identity / optional explicit Google chooser
        |             -- direct Google profile / calendars / event feed / bounded instances
        |             -- toolbar badge / connection alarm / per-calendar sync scheduler
        |
chrome.storage.local (metadata + preferences + safe diagnostics)
IndexedDB via Dexie (Google events, ranges, sync state, outbox, edit bases, reminders, sounds)

Offscreen document: local audio decode/playback through validated worker messages.
```

`entrypoints/background.ts` wires platform APIs, listeners, initialization, scheduling, and a serialized mutation queue. Listeners are registered synchronously at worker creation. Durable state does not depend on worker globals.

`src/background/auth-service.ts` owns account operations and safe failure transitions. Platform adapters are injected so domain tests can exercise real invariants without Google credentials.

`src/background/event-sync.ts` owns read-only event synchronization. It runs worker-serialized operations through `AuthService.withVerifiedToken`, verifies identity before event calls, persists independent calendar failure/backoff state, and keeps cursor advancement atomic with cache replacement. A one-minute scheduler evaluates the configured cadence; startup recovers interrupted jobs.

`src/background/event-writes.ts` owns validated event drafts, ACL checks, durable queue/recovery, stable creation IDs/private operation markers, ETag-conditional PATCH/DELETE, and explicit conflict resolution. Pending work overlays remote snapshots and is never deleted by cache cleanup. Successful writes stay acknowledged in the outbox until a fresh atomic snapshot commit. See `STAGE-4.md` and ADR 0006.

`src/background/chrome-adapters.ts` contains the native/web identity dispatcher, local persistence, and badge adapters. `web-identity.ts` owns validated chooser callbacks and transient per-account/client access. `google.ts` validates direct Google responses, handles pagination, and enforces request timeouts. Raw remote errors are never forwarded to UI or diagnostics.

`src/shared/model.ts` defines the versioned storage schema, runtime command schema, and UI-facing records. `src/shared/preferences.ts` defines validated settings, defaults, partial patches, and legacy preference compatibility. `message-router.ts` validates every command; only this extension's own pages are trusted senders.

`src/ui/use-extension-state.ts` shares worker commands and storage-change snapshot reads across the popup, calendar tab, and options page. FullCalendar v7 renders month/week views through its native React package. Radix supplies dialogs/tooltips; local design tokens and Tailwind provide styling. Theme changes propagate across surfaces, including changes to the device theme.

The options page uses a responsive anchor navigator and shared compact cards/field groups, ordered from everyday preferences to advanced connection/setup and diagnostics. Native details disclosures do not unmount their forms; anchor navigation opens advanced destinations. The form invalid-event handler opens ancestor disclosures before native validation focuses the field. These are UI-only choices, not persisted application settings; worker partial-patch ownership is unchanged. Storage information is rendered with synchronization rather than calendar appearance.

The event editor separates date-only controls from a nested Radix clock dialog. `editor-time.ts` initializes new one-hour timed ranges independently of FullCalendar's all-day cell classification, preserves existing all-day data/precise instants, and moves the end with the start. The time-zone selector uses the runtime's complete supported zone list plus UTC/current/default aliases; its selected value is separate from the initially empty search query. Its inline bounded list supports keyboard navigation. Delete confirmation scrolls/focuses within `.editor-scroll`, leaving the dialog header/actions fixed.

`src/calendar/` defines normalized records, Google response normalization, coverage/filter helpers, and the Dexie repositories. The UI reads the Google event table with `useLiveQuery`, plus cursor-free metadata queries. All writes go through worker commands and its existing queue. There is no preview mode or bundled sample generator. See `STAGE-3.md` and ADRs 0003/0004.

Week view defaults to readable hours (`weekLayout: scroll`, `weekHourHeight: 48`, validated to 32–120 pixels). FullCalendar's public `slotMinHeight` is proportional to slot duration, preserving the same minimum per hour for popup hourly slots and full-calendar half-hour slots. With `expandRows`, short hour ranges still fill available space; larger ranges scroll inside the calendar. The optional `fit` layout uses hourly slots and compact time labels on both surfaces, with a zero explicit minimum. Month layout and native popup document dimensions are unchanged. Old settings receive the new defaults without a storage reset.

The calendar sidebar groups calendars in account-order fieldsets labelled by email, with a paused-account indicator. Each checkbox retains its account/calendar visibility key, including shared calendar IDs; the account email is shown once per group.

Compact density uses explicit selectors after popup styles, so the popup no longer masks its event sizing. Public eventInnerClass/dayHeaderInnerClass hooks allow tighter event padding and heading spacing without hashed theme selectors. Compact full-calendar months use automatic dayMaxEvents; Comfortable keeps three. Density does not modify slotMinHeight or native popup document sizing.

The slide-out sidebar renders a viewport-sized button backdrop that consumes outside clicks and closes the drawer. It sits above the calendar and below the sidebar (z-index 29/30). CSS shows it only for the popup or full-calendar windows at most 700 pixels wide, matching the sidebar's overlay layout. The desktop sidebar stays in the page flow without an active backdrop. No global document click listener is needed.

Calendar event-list popovers use FullCalendar's public `popoverClass` and `dayCell*` hooks (`inPopover`) to cap panel size and scroll the list body independently of its header. `useViewportPopovers` measures the actual rendered popover/hover-card size and shifts it inside `window.innerWidth/innerHeight` with a 12-pixel gutter. It observes panel creation, sizing and repositioning, and viewport resize; observers/animation frames are cleaned up on unmount. Do not use the popup HTML element's requested 800×600 size as its available viewport, or target FullCalendar's hashed classes. The popover's public z-index variable keeps event details above the list.

`useCurrentHourScroll` runs when Week is entered or its visible range/layout/time zone changes. After slot measurements settle, it checks the current time's position against the scroll viewport and calls public `scrollToTime` only when needed, with a little context above the hour. It respects configured hours and fit mode, leaves already-visible current times in place, and does not run on periodic clock ticks or user scrolling.

`src/reminders/` owns pure DND/plan logic and an independently queued durable reminder service. Schema 5 adds `reminders` and `sounds`; the background platform adapter controls native notifications, one next-due alarm, a one-minute watchdog and validated offscreen audio. Snoozes and delivery state survive restarts. Shared calendar copies deduplicate without display filters. Audio imports/decode checks use worker-owned commands and local Blobs; the offscreen page accepts no arbitrary URL and closes when idle. See `STAGE-5.md` and ADR 0007.

Dual-zone week labels use public `slotHeaderContent` and named-zone conversions across the visible week. Distinct values/date shifts reveal DST differences; hover/details use exact event instants in both zones. Appearance settings exclude reminder/DND overrides when saving, and worker patches merge individual calendar override keys.

## State and ownership

- Store key: `calendar-checker.state.v1`.
- Account key: verified Google `sub` (not email, which can change).
- Account record: email, enabled state, authorization/check status, calendar summaries/permissions/colors, event-read grant marker, optional web auth method, timestamps, safe error code.
- Settings: connection interval, event sync interval (both 1–1440 minutes, default 5), stale threshold (1–10080 minutes, default 15), refresh on open, home cache months (0–12 past/future, default 2/6), appearance (including week layout and minimum hour height), primary zone, visibility, and optional public Web OAuth client ID. Retired data-source preferences are ignored on read. Additive defaults preserve old records; worker patches merge individual visibility keys and validate the full result.
- Event database: `calendar-checker-events`, version 5, upgrading in place. `events` stores normalized Google instances, `ranges` records bounded snapshot membership/coverage, and `syncStates` stores per-calendar cursors/retries. `outbox` stores independent pending writes/conflict versions; `editBases` retains at most 50 detached series masters. The migration drops the legacy `demoEvents` table and deletes `demo-v1:` seed markers; unrelated `meta` records survive. All-day ends are exclusive; timed records store instants and an original zone. Removing account/calendar metadata reconciles its Google cache/edit bases without dropping pending writes; account removal is blocked while pending rows exist. Pausing preserves work without sending it.
- Diagnostics: most recent 50 action/time/outcome/code entries, with optional fixed failure step/category, HTTP status, and bounded browser network code. No raw provider messages, tokens, account identifiers, email, or calendar contents.
- OAuth access tokens: Chrome-managed for existing native accounts; memory-only for web chooser accounts, with bounded silent authorization after expiry/worker restart. No refresh tokens or client secrets. Provider sync cursors are distinct local sync state and never enter UI metadata or diagnostics. Reports include aggregate sync counts and safe settings only.

All app state writes go through the worker's serial queue. UI reads can run while an authorization prompt is pending. Do not introduce a second writer without accounting for read/modify/write races. No IndexedDB transaction should ever remain open while waiting for network calls in later stages.

## Failure behavior

| Failure                                   | Behavior                                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP 401                                  | Evict that cached token, retry silently once for the same known account. Continued failure requires reconnect.                                                                                                                  |
| Partial consent / insufficient permission | Require reconnect; preserve calendar cache.                                                                                                                                                                                     |
| Wrong Google identity                     | Abort before calendar request; require reconnect without replacing the intended account.                                                                                                                                        |
| Network / timeout                         | Retry an idempotent GET once after 500 ms unless Chrome reports offline; preserve cache and last success if both attempts fail. Show the failed step and distinguish timeout from reported offline use. Do not request sign-in. |
| Rate limit / API service error            | Preserve cache; persist per-calendar exponential backoff with jitter and bounded Retry-After support. Manual sync respects backoff.                                                                                             |
| Event cursor HTTP 410                     | Invalidate only the affected calendar's cursor/coverage; retain stale occurrences until a new baseline and all retained ranges commit.                                                                                          |
| Calendar-specific 403/404                 | Show a calendar-access error; preserve stale data and continue other calendars/accounts. OAuth insufficient-permission errors still require reconnect.                                                                          |
| User cancels reconnect                    | Preserve previous account state and cache.                                                                                                                                                                                      |
| Unknown or corrupt storage schema         | Report storage failure; never reset the store automatically.                                                                                                                                                                    |

Enabled accounts requiring reconnection take priority on the toolbar `!` badge. Otherwise `ChromeBadge` reads the store and an indexed upcoming-event/cache-metadata snapshot through `EventRepository.toolbarData`, then uses the pure `nextEventBadge` selector. It shows today’s next timed start as `HH:mm` or later calendar dates as `+Nd`, using the primary time zone and coverage-preferred shared-calendar copy. All-day/declined/past events and hidden or paused calendars do not contribute. The event badge is enabled by default and can be disabled in appearance settings. Cache failures use the existing storage-warning badge. The event badge uses the selected normalized event's color, matching the calendar UI; `badgeTextColor` chooses black or white using relative luminance and the higher contrast ratio. Warning badges retain their red background. No badge text contains event titles; the action tooltip can show saved event details.

Startup reconstructs the badge and ensures the periodic alarm exists. The one-minute sync tick refreshes the badge before and after any due network work; toolbar rendering failures cannot block event sync. Account/settings saves also refresh it, so visibility/zone changes apply immediately. The badge uses cached data offline and does not imply fresh coverage or introduce a notification scheduler. Updating timing settings reschedules the alarm; normal worker wake-ups do not postpone it.

## Busy-only calendars

`freeBusyReader` calendars use bounded `POST /calendar/v3/freeBusy` queries with `calendar.events.freebusy`, independently of event cursors. Schema 5 accepts additive optional `availabilityOnly` event and `dataKind` sync fields without an index migration. Local availability keys represent UTC-day segments of Google busy intervals, never Google event IDs; they have no details, edit actions or event reminders. V0.5.3 includes them in the next-event badge as saved busy periods. The badge joins adjacent/overlapping UTC-day segments per account/calendar and reads ongoing availability by the end index to avoid announcing midnight continuations as new starts. All windows succeed before atomic replacement. Nested calendar errors are failures, not empty results. Access-mode changes rebuild coverage; a busy commit cannot acknowledge real event outbox work. At equal coverage, shared-calendar selection prefers event details over availability.

## Event synchronization and writes

The unexpanded change feed requests only IDs/cursors; bounded expanded queries fetch display data. Google handles recurrence, moved/cancelled exceptions, and DST. No-change feeds validate coverage; changes refresh retained ranges. Coverage absence, invalidation, staleness, offline state, and a successful empty result remain distinct. Shared calendar display prefers the best-covered/freshest authorized copy while retaining account provenance.

Stage 4 adds the runtime event-write scope, original recurring master/edit models, independent outbox/conflicts, stable creation IDs/private markers and conditional mutations. Remote read sync does not create changes; draining explicitly saved operations precedes remote synchronization. No application server or additional Chrome permission is used.
