# ADR 0003: Isolate calendar samples and merge preference patches

Date: 2026-11-01

Status: Implemented for stage 2; verification is recorded in STATUS.md.

## Context

The calendar UI needs real navigation and offline rendering before Google event synchronization is implemented. Existing users already have authorized accounts and version 1 settings. A demo must not appear to be synced Google data, and adding appearance preferences must not reset account state or existing user choices.

## Decision

Use FullCalendar Standard v7 with the native React integration and bundled styles. Keep fictional sample events in their own Dexie table, with explicit demo mode and worker-owned transactional seeding. Reserve a separate table for future Google event cache records. Read both through a common validated event model, but never combine the sources implicitly.

Retain the version 1 metadata store with additive preference defaults. Change settings commands to strict partial patches merged and validated in the worker's mutation queue. Keep visibility separate from account enablement. Export only timing settings in diagnostics to avoid leaking visibility keys containing account/calendar IDs.

Use Temporal for instant/date/zone distinctions and preserve all-day date-only ends as exclusive. Extend the event database schema deliberately when sync masters, coverage, and outbox data arrive.

## Consequences

- The UI is reviewable and works offline without additional Google scopes or server infrastructure.
- Existing accounts, credentials, and timing choices survive the update.
- Demo reset cannot delete Google data.
- Partial preference changes from different surfaces do not replace unrelated settings.
- Complete live multi-account authentication validation remains tracked separately; stage 2 does not claim it passed.
