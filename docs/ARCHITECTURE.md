# Architecture

## Boundaries

```text
React popup / full calendar / options
        |
validated, namespaced commands (no tokens)
        |
MV3 background worker -- native Chrome Identity
        |             -- direct Google profile / calendars / event feed / bounded instances
        |             -- toolbar badge / connection alarm / per-calendar sync scheduler
        |
chrome.storage.local (metadata + preferences + safe diagnostics)
IndexedDB via Dexie (Google events, ranges, sync state, isolated samples)

Later: event writing / durable outbox; offscreen audio / reminders.
```

`entrypoints/background.ts` wires platform APIs, listeners, initialization, scheduling, and a serialized mutation queue. Listeners are registered synchronously at worker creation. Durable state does not depend on worker globals.

`src/background/auth-service.ts` owns account operations and safe failure transitions. Platform adapters are injected so domain tests can exercise real invariants without Google credentials.

`src/background/event-sync.ts` owns read-only event synchronization. It runs worker-serialized operations through `AuthService.withVerifiedToken`, verifies identity before event calls, persists independent calendar failure/backoff state, and keeps cursor advancement atomic with cache replacement. A one-minute scheduler evaluates the configured cadence; startup recovers interrupted jobs.

`src/background/chrome-adapters.ts` contains native identity, local persistence, and badge adapters. `google.ts` validates direct Google responses, handles pagination, and enforces request timeouts. Raw remote errors are never forwarded to UI or diagnostics.

`src/shared/model.ts` defines the versioned storage schema, runtime command schema, and UI-facing records. `src/shared/preferences.ts` defines validated settings, defaults, partial patches, and legacy preference compatibility. `message-router.ts` validates every command; only this extension's own pages are trusted senders.

`src/ui/use-extension-state.ts` shares worker commands and storage-change snapshot reads across the popup, calendar tab, and options page. FullCalendar v7 renders month/week views through its native React package. Radix supplies dialogs/tooltips; local design tokens and Tailwind provide styling. Theme changes propagate across surfaces, including changes to the device theme.

`src/calendar/` defines normalized records, Google response normalization, sample generation, coverage/filter helpers, and the Dexie repositories. The UI reads the selected table with `useLiveQuery`, plus cursor-free metadata queries. All writes go through worker commands and its existing queue. Demo and Google records are never combined. See `STAGE-3.md` and ADRs 0003/0004.

## State and ownership

- Store key: `calendar-checker.state.v1`.
- Account key: verified Google `sub` (not email, which can change).
- Account record: email, enabled state, authorization/check status, calendar summaries/permissions/colors, event-read grant marker, timestamps, safe error code.
- Settings: connection interval, event sync interval (both 1–1440 minutes, default 5), stale threshold (1–10080 minutes, default 15), refresh on open, home cache months (0–12 past/future, default 2/6), appearance, primary zone, visibility, and explicit demo/Google source. Additive defaults preserve old records; worker patches merge individual visibility keys and validate the full result.
- Event database: `calendar-checker-events`, version 2, upgrading in place. `events` stores normalized Google instances, `ranges` records bounded snapshot membership/coverage, and `syncStates` stores per-calendar cursors/retries. `demoEvents`/`meta` remain isolated samples. All-day ends are exclusive; timed records store instants and an original zone. Removing account/calendar metadata reconciles its Google cache; pausing preserves it.
- Diagnostics: most recent 50 action/time/outcome/code entries, with optional fixed failure step/category, HTTP status, and bounded browser network code. No raw provider messages, tokens, account identifiers, email, or calendar contents.
- OAuth access tokens: Chrome-managed; transient worker operation variables only. Provider sync cursors are distinct local sync state and never enter UI metadata or diagnostics. Reports include aggregate sync counts and safe settings only.

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

Only enabled accounts that require reconnection contribute to the toolbar `!` badge. Startup reconstructs the badge and ensures the periodic alarm exists. Updating timing settings reschedules the alarm; normal worker wake-ups do not postpone it.

## Event synchronization and future writes

The unexpanded change feed requests only IDs/cursors; bounded expanded queries fetch display data. Google handles recurrence, moved/cancelled exceptions, and DST. No-change feeds validate coverage; changes refresh retained ranges. Coverage absence, invalidation, staleness, offline state, and a successful empty result remain distinct. Shared calendar display prefers the best-covered/freshest authorized copy while retaining account provenance.

Stage 4 must add write scopes, recurring master/edit models, outbox/conflict tables, retry-safe creation, and protection against clearing pending writes. Persist pending edits/conflicts independently of remote snapshots, and extend cleanup deliberately. No stage 3 operation creates or modifies events in Google.
