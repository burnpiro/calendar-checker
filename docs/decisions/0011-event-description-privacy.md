# ADR 0011: Exclude imported event descriptions without losing queued changes

Date: 2026-11-04

Status: Implemented for local validation.

## Decision

Add **Exclude event descriptions** under event synchronization, default off. Use Google's documented `fields` projections for instance lists, individual event/master reads and mutation responses. Include ETags, recurrence and private operation markers needed for safe writes; omit descriptions. A second normalization/persistence guard discards unexpected description fields from adapters or old in-flight data. Optional `descriptionOmitted` metadata lets details, conflict review and the editor distinguish omitted and empty descriptions.

When enabled, persist the preference, then atomically clean imported descriptions from `events`, `editBases` and outbox `base`/`remote`/preview copies. Retain independent pending operations, changed-field patches, receipts, ETags, cursors, coverage and unrelated fields. Explicitly authored description patches stay queued until Google acknowledges them; deleting them silently would lose user work. Acknowledged rows remove the description patch and copies. Settings/editor text discloses this exception. A blank omitted-description editor does not clear Google's field during unrelated edits.

Chrome preferences and IndexedDB cannot share one transaction. A failed cleanup returns a storage error, keeps the preference enabled, and is retried on the next settings attempt, startup or sync/write entry. The completed-policy marker commits with cleanup, so a transaction failure cannot mark an incomplete purge complete. Startup applies it before reminder/cache work. Polling checks the marker without rewriting all cache rows. Both enabling and disabling invalidate snapshots without discarding cursors/coverage; re-enabling downloads therefore refreshes unchanged feeds too.

No permission, scope, server, dependency or database index change is needed. Removing record fields does not guarantee physical erasure from disk, profile backups or previously exported data.

## Cache range clarification

`cachePastMonths` and `cacheFutureMonths` are month offsets. At 0/0, `homeRange` still covers the current UTC month, with an exclusive next-month end. A requested view can also retain its three-month browsing slot and existing time-zone query padding. These controls do not implement a cache-off mode. Settings and README now state this explicitly.

## Verification

Tests cover projected paginated/list/get/write responses, unexpected fields, immediate offline cleanup, atomic failure/rollback/retry, restart persistence, unchanged-feed repopulation, preserving pending user text, conflict rebasing and title-only edits that preserve Google's description. The isolated browser fixture exercises the real worker/settings/IndexedDB in a disposable offline profile. It does not prove real Google-account acceptance.

## Sources

- [Google Calendar partial responses and fields selectors](https://developers.google.com/workspace/calendar/api/guides/performance#partial-response)
- [Events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Events get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get)
