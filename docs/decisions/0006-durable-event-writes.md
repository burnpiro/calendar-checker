# ADR 0006: Independent outbox and conditional Google event writes

Date: 2026-11-02

Status: Implemented in stage 4; live Google write acceptance remains pending.

## Decision

Dexie schema 4 adds `outbox` and bounded `editBases` tables without altering existing events, ranges, cursors or preferences. Worker commands validate drafts and persist pending work before any Google request. Pending rows contain immutable original versions, requested changes, local preview, account/calendar provenance, explicit guest-update policy, retry state and optional conflict versions. Remote cache replacement never deletes unsent work. Account removal is rejected while any pending row remains; pausing retains work without sending it. Calendar-list reconciliation retains the outbox even when a calendar disappears, while removing obsolete remote snapshots and detached edit bases.

All operations run through the worker's existing serial queue. The one-minute scheduler and explicit sync drain due writes before fetching remote snapshots. Startup recovers interrupted sending rows; foreground saves return after local persistence and schedule the drain separately. Processing verifies the pinned Google identity and reloads writable calendar ACLs. Disabled/reconnect accounts stay paused. Retries persist exponential delays and Google's Retry-After. Conflicts and permanent failures require an explicit user action. No credentials enter the outbox or UI.

A bounded set of 1000 content-free SHA-256 request receipts lives in `meta` (pending operations are protected from receipt pruning). This makes repeated save messages idempotent even after successful snapshot cleanup and rejects reusing an accepted request ID with a different body. Receipts commit atomically with queue insertion.

Creation uses a preallocated UUID with hyphens removed as its Google event ID, plus a private `calendarCheckerMutation` operation marker. IDs use Google's allowed base32hex character subset. A retried ambiguous creation GETs that ID before inserting again. A collision belonging to another operation is a conflict, never an overwrite. Edits GET the target and compare its original ETag, then PATCH only changed fields with If-Match. Both time endpoints are patched together, explicitly clearing the opposite date/dateTime representation when changing all-day mode. Conditional DELETE uses the same original ETag.

An operation marker on a later GET acknowledges an edit/create whose response was lost; an absent/cancelled event acknowledges deletion. A 409/412 schedules a GET to distinguish an acknowledged operation from a genuine collision/version conflict. Raw transport errors never automatically repeat POST/PATCH/DELETE inside the HTTP adapter; the durable processor decides what is safe. One account-pinned 401 renewal remains bounded by AuthService.

A successful Google write remains `awaiting-sync` until the next successful atomic calendar snapshot commit. This keeps a local overlay visible while refreshing or offline, and avoids claiming that a received write is already reflected in every cached occurrence. Cache metadata is invalidated in the same local transaction as acknowledgment. A failed refresh retains the acknowledged overlay. Series overlays update common text on cached instances; their timing/recurrence refresh is left to Google's expansion.

Conflicts show the local and fetched Google versions. **Use Google version** discards the local operation and requests a fresh snapshot. **Apply my changes** explicitly rebases only the changed fields on the displayed remote ETag; another intervening change conflicts again. Missing events and colliding creations cannot be silently recreated/overwritten. Discarding uncertain local work explicitly warns that it does not undo changes Google may already have received.

## Recurrence and restrictions

An occurrence edit uses its instance ID/ETag and never changes recurrence. Whole-series editing first retrieves the original master, including its first start/end, recurrence and ETag; the selected occurrence's time is never used as the master's initial time. Up to 50 detached master bases are cached for subsequent offline editing; queued operations retain their own bases independently. A master that has never been loaded cannot be edited offline.

New repeat rules offer daily/weekly/monthly/yearly with 1–1000 occurrences. Existing complex rules and exceptions are preserved by default and sent unchanged only if the user explicitly replaces the rule. Whole-series edits and one-occurrence edits are supported. This-and-following splitting, moving events between calendars, guest-list editing, and specialized Google event editing are outside this release. Existing guests, conference data, attachments and unrelated fields are left out of PATCH bodies and preserved by Google. Guest updates are explicit in the editor, defaulting to notifying existing guests.

Only ordinary, unlocked events in owner/writer calendars are editable. Guest copies require Google's guestsCanModify permission when organizer.self is false. Specialized birthday/Gmail/focus/out-of-office/working-location events remain viewable with an Open in Google Calendar link. Pending edits for the same event/series are serialized by refusing another overlapping queued edit until the first is settled/discarded.

## Permissions and consequences

Replace the runtime read-only event scope with `calendar.events` in native/Web scopes and the manifest; this scope covers both reading and writing. Keep identity/calendar-list scopes and do not revoke existing Google consent. Existing accounts may need explicit Reconnect. The previously configured Cloud Data Access declaration alone does not grant runtime consent. No new Chrome permission, server, client secret, telemetry or token persistence is introduced.

The outbox is limited to 200 operations, and local storage still belongs to one Chrome profile. Uninstalling the extension clears local pending work. Writes and polling require Chrome to run and can be interrupted by sleep; durability makes later recovery possible. Automated synthetic tests verify implementation paths, not live Google account acceptance.

## Sources

- [Calendar scope definitions](https://developers.google.com/workspace/calendar/api/auth)
- [Insert events and client-generated IDs](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [PATCH semantics and guest updates](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
- [Conditional modification and ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources)
- [Recurring event instances and masters](https://developers.google.com/workspace/calendar/api/guides/recurringevents)
- [Private extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties)
- [Conditional event deletion](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete)
