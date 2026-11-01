# Stage 3: Google event reading and offline synchronization

Release: v0.3.0. This stage reads events; event creation/editing and reminder delivery remain stages 4 and 5. There is no application server, telemetry, or cloud preference store.

## Use the release

1. Build and reload the unpacked extension at `chrome://extensions`. Preserve `.env.local` and the registered extension key/client ID.
2. In the existing Google Cloud project's **Google Auth Platform → Data Access**, include `https://www.googleapis.com/auth/calendar.events.readonly` alongside the existing identity and calendar-list scopes. See `GOOGLE-SETUP.md`.
3. Open Settings. Existing accounts may require **Reconnect** to approve event reading. Background work never opens consent prompts. Accounts and saved data survive a permission failure.
4. Choose **Show my calendars** if the preserved preference is Demo preview. Newly authorized/enabled accounts start a background sync; the calendar also requests its visible dates.
5. Use the circular-arrow **Sync events** control or Settings → **Sync all enabled accounts**. Settings shows each calendar's last successful check, errors, retry time, and cache coverage.

The additional scope is read-only. No event-writing scope or application backend is introduced. Google Cloud identifies the OAuth client and grants direct access to Google; it does not host the extension's local data.

## Sync design

Each readable calendar of each enabled account has an independent change cursor. The worker verifies the pinned Google `sub` before event access and keeps the OAuth access token on its own operation stack. HTTP 401 evicts that token and allows one silent, account-pinned retry. Missing consent requires an explicit reconnect and contributes to the existing toolbar/popup warning. Calendar-specific 403/404 failures remain calendar failures rather than forcing unrelated accounts to reconnect. Busy-only calendars cannot provide event details and are explicitly identified in Settings.

Two request streams deliberately stay separate:

- A collection change feed uses `singleEvents=false`, `showDeleted=true`, and the same parameters across initial/delta pagination. Its response projection contains only changed IDs and page/sync cursors. The initial scan establishes a cursor; historical event bodies are not downloaded by this stream. Deleted events and recurring-series changes invalidate the retained snapshots for that calendar.
- Bounded queries use `singleEvents=true` with `timeMin`/`timeMax`. Google expands recurring series, exceptions, moved occurrences, and DST transitions. These queries do not use a sync token; any cursor in a bounded response is ignored.

Google forbids date filters, sorting, and text queries with incremental cursors. No local RRULE engine is needed for this reading stage. See [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync), and ADR 0004.

No-change deltas advance the cursor and validate existing coverage without re-downloading occurrences. Any change conservatively refreshes the retained occurrence windows. This uses more bandwidth on changed calendars than applying individual instance deltas, while keeping recurrence and deletion behavior on Google's authoritative expansion path.

On HTTP 410, clear the affected cursor, mark its snapshots invalidated, and establish a new baseline. Old events remain explicitly stale while rebuilding. Advance the cursor and replace all retained snapshots only after all required pages/ranges have succeeded. A failed page, invalid event, or storage transaction cannot commit a partial fresh range or advance its cursor. Other calendars/accounts and samples remain untouched.

## Local cache and settings

The Dexie database upgrades in place from version 1 to version 2, retaining stage 2 rows:

| Table                | Purpose                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `events`             | Normalized Google one-off events and expanded recurring instances, keyed by account/calendar/Google event ID.             |
| `ranges`             | Home/browse snapshot membership and nominal date coverage, with fetched/validated timestamps.                             |
| `syncStates`         | Per-account/calendar cursor, running/invalidated flags, successful check time, safe error, retry time, and failure count. |
| `demoEvents`, `meta` | Existing isolated sample data and seed markers.                                                                           |

The default home window spans two months before the current UTC month, the current month, and six months after it. Past/future counts are separately configurable from 0 to 12. When a requested month needs coverage outside that window, retain one separate three-month browsing window around it. Browsing another outside period replaces that slot; orphaned events are removed transactionally, while home events and events referenced by both slots survive. Two days of query padding on either side cover civil-zone and all-day boundaries; coverage labels use nominal exclusive-end dates.

This is a bounded cache, not an archive of every month ever visited. An uncached offline period is labelled as missing coverage, never as a successfully synced empty calendar. A successful empty Google result does establish coverage. The configured stale threshold applies to the oldest successful validation of the visible calendars. Offline, invalidated, and failed-sync states keep existing events visible.

Display filters stay local: account enablement, individual calendar visibility, text, and Google's event types. Visibility does not stop background sync. Shared calendar copies retain their account provenance in storage; display selects the copy with the best visible coverage/freshness instead of duplicating the same shared calendar. Distinct calendars containing the same meeting remain independently visible.

Settings add event sync interval (1–1440 minutes, default 5), refresh on open (default enabled), and the home cache window. A durable one-minute alarm checks each calendar's due time; Chrome can delay delivery. Repeated opens within a minute reuse a recent check. Manual sync bypasses normal cadence but respects persisted failure backoff. Backoff uses exponential delay with jitter, starting around 30 seconds for transport failures and 60 seconds for other failures, capped around 30 minutes unless Google's `Retry-After` requires longer. Startup clears interrupted running flags and invalidates their coverage for retry.

Removing an account or a calendar from a successfully refreshed calendar list removes its event snapshots and cursors. Pausing an account preserves them while stopping sync and hiding its events. Sample reset remains sample-only. Stage 4 must extend cleanup deliberately to protect pending writes before introducing an outbox.

Event details preserve original zone, recurring-instance provenance, ETag, location, organizer, participant count/own response when available, and HTTPS links. Descriptions render as plain text, including any markup supplied by Google. Diagnostics contain safe timing settings, fixed failure categories, and aggregate sync counts; they exclude event bodies, emails, account/calendar IDs, visibility keys, OAuth tokens, and sync cursors. UI metadata queries omit cursors.

## Verification and remaining live acceptance

`npm run check` covers strict TypeScript, domain/adapter tests, formatting, and a production build. Run `npm run test:extension` sequentially afterward. Browser tests use disposable profiles and fictional data. A copied temporary build receives a synthetic public OAuth client and worker-level identity/HTTP fixtures; the final build and `.env.local` are never rewritten for that test.

Automated coverage includes pagination and forbidden parameter combinations, no-change updates, cancellations, 410 recovery, failed-refresh preservation, atomic rollback, persisted backoff, 401 retry limits, identity mismatch, independent accounts, bounded browsing cache, interrupted work, schema migration, shared-calendar selection, offline/stale/uncovered UI states, native popup sizing, and fixture Google-cache survival through an offline browser restart.

Live Google event access has not yet been exercised for this release. Complete these with real accounts after approving the new scope:

- Two independently authorized accounts and their calendars sync without swapping identities.
- A Google-side event update, deletion, recurring exception, and all-day event appear correctly after manual sync.
- Cached events remain after disconnecting the network and restarting Chrome; uncached dates are identified.
- Revoking only one account's event consent produces its reconnect badge without clearing either cache or blocking the other account.
- Natural token renewal and long-running polling behave correctly in stable Chrome.

The earlier first-account connection success remains valid; it does not prove the new event scope or the full multi-account lifecycle matrix. No real-account test result is inferred from fixtures.
