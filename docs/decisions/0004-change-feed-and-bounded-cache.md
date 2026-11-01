# ADR 0004: Separate change cursors from bounded expanded snapshots

Date: 2026-11-01

Status: Implemented in stage 3.

## Context

Google incremental tokens cannot be combined with `timeMin`, `timeMax`, `orderBy`, or text search. Expanding every future instance in an unbounded recurring calendar is unsuitable for a local bounded cache. Applying raw recurring masters/exceptions locally would require another recurrence engine and extensive provider-specific date semantics.

## Decision

Use a projected unexpanded collection feed for change detection and a separate bounded `singleEvents=true` stream for display snapshots. Preserve query parameters throughout feed pagination; only change page/cursor tokens. The initial feed scans IDs to establish a cursor without retaining historical event contents. A changed calendar invalidates and refreshes its retained expanded snapshots; unchanged calendars only advance their cursor and validation timestamps.

Keep a configurable home window and one three-month browsing slot per account/calendar. Membership lists reference canonical account/calendar/event records, so overlapping snapshots do not duplicate records. Atomically replace snapshots, remove orphaned events, and advance the cursor after all pages and required ranges have succeeded. Persist retry/running state outside network transactions.

A 410 discards only that calendar's cursor and invalidates its authoritative coverage. Retain old occurrences as visibly stale read-only data until a fresh baseline and expanded snapshots can be committed. This separates offline fallback data from current authoritative sync state.

Let Google expand recurrence and apply cancelled/moved exceptions. Store instance/master identifiers, original start, zones, and ETags for provenance; defer event-writing/master models to stage 4.

## Consequences

- Recurrence and DST expansion follow Google without a new runtime library or server.
- Empty, stale, and uncovered intervals have distinct meanings.
- The initial ID scan may be large; paginated requests are bounded to 100 continuation pages and each request has a 15-second deadline.
- A change anywhere in the calendar refreshes the bounded cache, trading extra changed-calendar bandwidth for simpler correctness.
- Cache size is bounded by configured home months plus one browsing slot. It is not unlimited offline history.
- Cursor invalidation, request failures, and storage rollback cannot erase the last usable snapshot or mark a partial result fresh.
- OAuth credentials stay transient; persistent sync cursors are local provider state and never enter UI messages/diagnostic exports.

## Sources

- [Google events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync)
- [Recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents)
- [API errors and backoff](https://developers.google.com/workspace/calendar/api/guides/errors)
