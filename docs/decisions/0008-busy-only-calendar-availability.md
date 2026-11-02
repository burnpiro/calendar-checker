# ADR 0008: Bounded availability for busy-only shared calendars

Date: 2026-11-02

Status: Implemented for local validation; live availability consent/data acceptance remains pending.

## Decision

Support `freeBusyReader` calendars through Google's documented `POST /calendar/v3/freeBusy` endpoint. Request `calendar.events.freebusy`, the narrow read-only availability scope covering accessible calendars. Existing event access does not authorize this endpoint. Existing accounts need explicit Reconnect; token handling, account pinning and complete scope validation remain unchanged. No backend or additional Chrome permission is introduced.

Poll bounded home/browse windows at the configured sync cadence, with 31-day requests and existing timeout/backoff/401 recovery. Free/busy responses have no change cursor. Validate every interval and calendar-specific nested error; a missing/error response is never successful empty coverage. Commit all windows together and preserve the old snapshot after failure. Successful empty availability clears old busy blocks.

Reuse the local event/range store with optional `availabilityOnly` and sync `dataKind` fields; no index migration is needed. These are actual Google availability ranges, not fictional events. Merge overlapping/adjacent intervals and split at UTC midnight for stable local keys across padded, overlapping query windows. Google may merge overlapping meetings; availability cannot recover individual titles, all-day intent, participants or original event starts.

Display **Busy**, time range, calendar/account and color, with an availability explanation. Prevent editing even if calendar ACLs later become writable. Do not create event reminders or event-countdown badges from availability. Keep pending event writes independent; free/busy snapshot commits cannot acknowledge them. Hide previously cached event details after an access downgrade and rebuild event snapshots/cursors after an upgrade. At equal coverage, prefer a detailed shared-calendar copy over a newer availability copy.

## Evidence and limits

The user reported that a missing shared calendar is labelled busy-only/unreadable. The existing implementation deliberately skipped `freeBusyReader` calendars. Synthetic API, persistence, failure and UI tests establish the new implementation; they do not prove live Google sharing, grant acceptance, organizational policy or multi-account lifecycle behavior. Availability uses the same bounded offline cache as full events.

## References

- [Freebusy query, request/response errors and accepted scopes](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Calendar access roles](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList)
