# Stage 4: Event creation, editing and offline changes

Historical stage 4 release: v0.4.1. Current v0.5.7 also includes [stage 5 reminders and time zones](STAGE-5.md). No application server is used. All event traffic goes directly to Google; preferences, cache and the pending queue stay in the local Chrome profile.

## Upgrade

1. Build and reload Calendar Checker at `chrome://extensions`. Preserve `.env.local` and the extension key.
2. Use **Reconnect** for existing accounts to approve **View and edit events on all your calendars** (`https://www.googleapis.com/auth/calendar.events`). The existing Google project's Data Access declaration already includes this scope; this release now requests it at runtime. No new OAuth client or Chrome permission is needed.
3. Existing metadata, Google events, cursors and ranges are retained. Dexie upgrades to schema 4 with independent `outbox` and `editBases` tables.

## Create and modify

Click **Create event** (+) or an empty day/time. New events default to one timed hour, including month cells; choose All day explicitly when needed. Moving the start preserves the chosen duration and handles crossing midnight. Start/end dates and clock buttons are separate. The clock offers a 24-hour dial, five-minute labels, pointer selection for any minute, and numeric entry for an exact time. New events start in the configured primary time zone; existing events retain their zone. Opening the time-zone selector shows all supported zones with an empty search, with case-insensitive region/city filtering and keyboard selection. Choose an enabled account and writable calendar, then enter the title, date/time, event time zone, location and description. All-day forms use an inclusive last day; Google receives an exclusive end. New events can repeat daily, weekly, monthly or yearly at intervals of 1–99, with optional weekly weekdays. End after 1–1000 occurrences, on an inclusive date, or never. Timed repeat end dates are converted to the event zone’s final second and sent as UTC UNTIL; all-day rules use a date-only UNTIL. Cached display remains bounded even for endless repeats.

**Settings → Event editing** sets the default account/calendar combination for new events. An unavailable default falls back to a primary writable calendar. Reader/busy-only calendars never appear as destinations. Editing keeps the original account/calendar; moving an existing event is not implemented.

Open event details, then **Edit event**. Recurring instances offer **Edit occurrence** or **Edit series**. The latter loads the original master, including its first occurrence and recurrence rule; the form does not shift the series to the selected instance. Existing complex rules are preserved unless deliberately replaced. A previously loaded series can be edited offline; a master not yet cached needs connectivity first. Series timing/recurrence changes appear after Google expands and syncs the instances. This-and-following splits are not available.

**Delete** inside the editor scrolls to its confirmation and focuses Confirm delete so the action stays visible in the popup. It follows the chosen occurrence/series scope. Existing guests and meeting data are preserved on edits. Choose whether Google should notify existing guests; Google can still send some service emails. V0.5.7 adds the event options below. Unchanged guests/conferences are preserved; changed fields alone enter the PATCH. Specialized Google event types and locked/non-writable events remain read-only here; use their Google Calendar link.

Ambiguous or nonexistent daylight-saving times are rejected when entering a new wall-clock time; use an unambiguous time or zone. Unchanged existing instants retain their original offset and seconds. No reminder delivery is introduced in this stage.

## Extended event options · v0.5.7

- **Event color:** calendar default or one of the eleven Google event color IDs, rendered with bundled swatches while offline. Colors now survive normalization, cached-calendar label refresh and toolbar-badge selection.
- **Show as / visibility:** Busy or Free, with default/public/private visibility. Existing confidential values are preserved. Google’s calendar sharing rules still apply. Google can propagate a more restrictive single-occurrence visibility to its whole series; edit the master to make visibility less restrictive.
- **Video conferencing:** keep, add/replace with a unique Google Meet, or remove. Calendar conference capabilities are cached from calendarList and checked again before a write. A stable conference request ID and `conferenceDataVersion=1` make ambiguous retries reuse the same request. Links are created asynchronously; details/editor show pending/failure status, and later sync obtains the link. Unsupported conference providers remain unchanged. No Meet/Drive scope is added.
- **Google Calendar notifications:** use calendar defaults, no notifications, or up to five popup/email offsets, each 0–40320 minutes. These edit Google’s per-account event reminders. Extension sound/desktop/DND reminders continue to follow Settings and are intentionally separate.
- **Guests:** add/remove email addresses, mark attendance optional, and configure modify/invite/view-guest-list permissions. Up to 200 guests can be edited. Existing RSVP/comments/resource metadata are retained for unchanged addresses. Organizer/self rows cannot be removed here. Duplicate/incomplete addresses are rejected. A partial, unavailable or oversized guest list and an attendee’s copy cannot be replaced here; guests remain intact. This editor does not provide contact autocomplete or room availability search.
- **Guest updates:** explicitly send invitations/updates or request no updates. Google may still send some service emails; suppressing updates can affect invitation delivery. Test invitation behavior with disposable real accounts before relying on it.
- **Save & open in Google:** queue the same durable creation, then open only the returned HTTPS Google Calendar event URL after successful delivery. Offline saves open later when delivered. The open intent is claimed before opening, so an interrupted browser action cannot repeatedly open tabs; a crash in that narrow interval can miss the tab, and the event can still be opened from its details. No guessed account/index/template URL is used. Normal **Save event** does not open a tab. Existing events also expose their Google link.

All fields use the existing validated local queue, ETags, identity verification and conflict controls. New optional record fields preserve existing schema-5 cache/outbox rows without replacing data or adding a new store. Guest emails and provider metadata stay out of diagnostics. Existing events from older caches may need one successful sync before guest editing is available.

## Description privacy

With **Exclude event descriptions** enabled, existing imported descriptions are removed from cached events, recurring master bases and pending/conflict snapshots. Missing descriptions are labelled as omitted, not empty Google fields. Blank description drafts for these events leave the Google field unchanged when editing other details. GETs, master retrievals and write responses exclude descriptions, including conflict and uncertain-write recovery reads; operation markers and ETags remain available.

Explicit local description changes are preserved in the durable queue until acknowledgement, including failed/conflicting work. They are the intentional exception to description-free local snapshots. Acknowledged write rows drop their description patch and copies. A stale editor opened before the preference changed cannot reintroduce an unchanged provider description through its base or preview. No operation or receipt is discarded by the privacy cleanup. Cleanup removes fields from application records; it is not a forensic disk-erasure guarantee.

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

V0.5.7 local results (2026-11-03): `npm run check` passes with 239 unit/adapter tests; the subsequent full Chromium suite passes all 19 tests. Complete event options persist offline, survive reload/sync and retain guest/conference/reminder metadata during a title-only edit. The save/open flow uses intercepted fictional Google pages; no real invitation or Meet request was sent. Editor screenshots were inspected at 800×600.

Run `npm run check`, then `npm run test:extension` sequentially. Browser tests use fictional accounts/events in disposable profiles, never the personal Chrome profile. Tests cover offline all-day creation into a second account, restart recovery, writable destinations, no click-through/popup regressions, conflict comparison/explicit rebase, series/instance targets, conditional deletion and earlier read-sync behavior.

Before claiming live acceptance, use disposable real Google events to verify creation/edit/delete across two accounts, write-scope consent, server-side recurring exceptions, concurrent Google edits, network interruption/restart recovery, guest invitation/removal/RSVP preservation, per-account popup/email notifications, colors/availability/visibility, asynchronous Meet creation/removal and permission revocation. Automated fixture success is not live Google acceptance. Stage 5 remains reminders/custom sounds/snooze/DND and dual-zone display.
