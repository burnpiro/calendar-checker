# Stage 4: Event creation, editing and offline changes

Release: v0.4.1. No application server is used. All event traffic goes directly to Google; preferences, cache and the pending queue stay in the local Chrome profile.

## Upgrade

1. Build and reload Calendar Checker at `chrome://extensions`. Preserve `.env.local` and the extension key.
2. Use **Reconnect** for existing accounts to approve **View and edit events on all your calendars** (`https://www.googleapis.com/auth/calendar.events`). The existing Google project's Data Access declaration already includes this scope; this release now requests it at runtime. No new OAuth client or Chrome permission is needed.
3. Existing metadata, Google events, cursors and ranges are retained. Dexie upgrades to schema 4 with independent `outbox` and `editBases` tables.

## Create and modify

Click **Create event** (+) or an empty day/time. New events default to one timed hour, including month cells; choose All day explicitly when needed. Moving the start preserves the chosen duration and handles crossing midnight. Start/end dates and clock buttons are separate. The clock offers a 24-hour dial, five-minute labels, pointer selection for any minute, and numeric entry for an exact time. New events start in the configured primary time zone; existing events retain their zone. Opening the time-zone selector shows all supported zones with an empty search, with case-insensitive region/city filtering and keyboard selection. Choose an enabled account and writable calendar, then enter the title, date/time, event time zone, location and description. All-day forms use an inclusive last day; Google receives an exclusive end. New events can repeat daily, weekly, monthly or yearly for 1–1000 occurrences.

**Settings → Event editing** sets the default account/calendar combination for new events. An unavailable default falls back to a primary writable calendar. Reader/busy-only calendars never appear as destinations. Editing keeps the original account/calendar; moving an existing event is not implemented.

Open event details, then **Edit event**. Recurring instances offer **Edit occurrence** or **Edit series**. The latter loads the original master, including its first occurrence and recurrence rule; the form does not shift the series to the selected instance. Existing complex rules are preserved unless deliberately replaced. A previously loaded series can be edited offline; a master not yet cached needs connectivity first. Series timing/recurrence changes appear after Google expands and syncs the instances. This-and-following splits are not available.

**Delete** inside the editor scrolls to its confirmation and focuses Confirm delete so the action stays visible in the popup. It follows the chosen occurrence/series scope. Existing guests and meeting data are preserved on edits. Choose whether Google should notify existing guests; Google can still send some service emails. Guest-list editing and creation of conference links are not included. Specialized Google event types and locked/non-writable events remain read-only here; use their Google Calendar link.

Ambiguous or nonexistent daylight-saving times are rejected when entering a new wall-clock time; use an unambiguous time or zone. Unchanged existing instants retain their original offset and seconds. No reminder delivery is introduced in this stage.

## Pending changes and conflicts

**Save event** commits to the local queue first. The calendar overlays pending events on its remote snapshot. Pending changes are shared across popup/full calendar/Settings and survive Chrome restarts. The footer's **Pending changes** button and Settings show queued, sending, retrying, conflicting, failed and saved-to-Google/refreshing states.

Enabled accounts send automatically on the existing one-minute scheduler, calendar sync/open or immediately after a save. Chrome can delay background work. Offline/network/rate-limit failures retain work and persist retry delays. Accounts requiring consent pause until Reconnect; **Retry now** explicitly retries after the issue is resolved. Paused accounts retain work without sending it. Permanent permission/calendar failures remain available for review.

A changed ETag or a deleted remote event causes a conflict instead of an overwrite. Review the local/Google versions and choose:

- **Use Google version:** drop the local operation and refresh from Google.
- **Apply my changes:** explicitly apply only your changed fields over the displayed Google version, still checking for newer changes.
- **Discard local change:** remove pending local work. This does not undo a request Google may already have received. Missing remote events and unrelated ID collisions cannot be overwritten/recreated through conflict resolution.

A successful write remains visible as **Saved to Google · refreshing calendar** until a successful atomic snapshot refresh. Repeated sends use stable creation IDs/private operation markers and conditional ETags to prevent duplicates/lost updates. Another pending edit on the same event/series must be resolved first. The queue holds at most 200 operations.

Account removal is blocked while pending work exists. Resolve/discard it first; calendar disappearance and cache cleanup never silently erase it. Uninstalling the extension clears its local storage, including unsynced work.

## Validation

Run `npm run check`, then `npm run test:extension` sequentially. Browser tests use fictional accounts/events in disposable profiles, never the personal Chrome profile. Tests cover offline all-day creation into a second account, restart recovery, writable destinations, no click-through/popup regressions, conflict comparison/explicit rebase, series/instance targets, conditional deletion and earlier read-sync behavior.

Before claiming live acceptance, use disposable real Google events to verify creation/edit/delete across two accounts, write-scope consent, server-side recurring exceptions, concurrent Google edits, network interruption/restart recovery, guest notifications and permission revocation. Automated fixture success is not live Google acceptance. Stage 5 remains reminders/custom sounds/snooze/DND and dual-zone display.
