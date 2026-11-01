# Product and implementation plan

## Product requirements

- Chrome extension using React and strict TypeScript, Manifest V3, local application storage, and direct Google API access. No application servers.
- Multiple explicitly connected Google accounts, independently enabled or disabled; multiple calendars per account.
- Modern month and week calendars inspired by the user's reference: readable typography, restrained grid lines, calendar colors, compact toolbar, and collapsible account/calendar sidebar.
- Account/calendar/search filters and Google's event types: default, birthday, fromGmail, focusTime, outOfOffice, workingLocation. Holidays are generally a calendar filter.
- Event details on click, basic hover details after one second, and equivalent keyboard access.
- Create and modify events with account and writable-calendar selection; respect specialized event restrictions and recurring-series semantics.
- Offline caching with cache coverage and last-success timestamps; explicit stale/offline states.
- Offline mutations in a durable outbox, retry-safe creation, and version-aware conflict handling.
- Desktop and sound reminders, custom imported sounds, volume/preview, configurable reminder offsets and snooze.
- Manual and scheduled Do not disturb, including overnight schedules and an explicit schedule time zone.
- Primary and optional secondary time zones. Week view has aligned time columns; month hover/details show both zones. Handle DST and all-day dates correctly.
- Reconnect badge on the toolbar icon and clear account-specific popup warnings.
- Popup calendar plus full calendar in a tab or detached window; shared preferences and data.

## Settings page

Provide a dedicated page accessible from the popup and full calendar. Settings are validated, versioned, locally persisted, and reflected across all open surfaces.

| Area               | Planned controls                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Accounts/calendars | Connect/reconnect/remove, enable/disable, visibility, default account/calendar, colors.                                         |
| Synchronization    | Background interval (initial target 5 minutes), refresh on open, stale threshold (15 minutes), manual sync, per-account status. |
| Notifications      | Sound and desktop switches, privacy, multiple reminder offsets, calendar overrides, snooze presets, missed-reminder policy.     |
| Custom sounds      | Import multiple local audio files, name/preview/delete, volume, default and per-calendar assignments.                           |
| DND                | Manual, until-time, weekly/overnight schedules, schedule time zone.                                                             |
| Appearance         | Default view, week start, weekends, 12/24-hour clock, visible week hours, theme, density, default filters.                      |
| Time zones         | Primary, optional secondary, follow device.                                                                                     |
| Offline storage    | Cache window/retention, storage usage, clear cache with unsynced-write protection.                                              |

Preview sound, test notification, and reset controls belong in the appropriate settings sections. Useful user-facing behavior should be configurable; limits and security invariants remain enforced. Do not expose settings for unimplemented functionality as if they work.

## Stages

1. **Authentication feasibility:** Native OAuth adapter, multiple account metadata, account-specific identity checks and calendar-list access, enable/disable, token renewal/reconnect checks, restart persistence, reconnect badge/popup, and a reproducible real-account acceptance matrix. Technical prototype implemented; live validation pending.
2. **Extension foundation/calendar shell:** Implemented in v0.2.0: shared UI system, popup/full-tab month/week navigation, FullCalendar Standard, Dexie event foundation with isolated samples, details/previews/filters, and broader shared settings. See `STAGE-2.md`.
3. **Calendar reading and synchronization:** Implemented in v0.3.0: read-only event scope, separate change feed/bounded expanded occurrences, independent cursors/backoff, local filters and shared-calendar selection, bounded coverage, offline/stale/uncached states, manual/background sync, and configurable timing/cache windows. Automated provider fixtures pass; live new-scope/two-account acceptance is pending. See `STAGE-3.md`.
4. **Event writing:** Forms, writable account/calendar selection, recurrence edits, offline outbox, retry-safe writes, and conflict resolution. Add event write scopes at this stage.
5. **Reminders and time zones:** Notification scheduling, offscreen audio, imported sounds, snooze, DND schedules, dual-zone presentation, restart/sleep recovery, and related settings.
6. **Verification and packaging:** API lifecycle, offline/conflict/DST cases, permissions, accessibility, performance, and unpacked/ZIP distribution. Publishing is separate and requires a user request.

## Proposed stack

Implemented: WXT + React + TypeScript, FullCalendar Standard v7 (MIT), Tailwind v4, Radix Dialog/Tooltip primitives, Lucide icons, Dexie/IndexedDB for event data, `chrome.storage.local` for preferences, Temporal for dates/zones, Zod validation, native fetch/Chrome Identity for Google, and Vitest/Playwright for verification. Radix supplies the needed primitives directly without adding a separate shadcn component layer. Recurrence/form libraries will be selected when their concrete features require them; dependencies are installed only when used.

## Known constraints

- Stable Chrome's account enumeration method is Dev-channel-only; explicit authorization replaces silent enumeration of Gmail sessions.
- Native account chooser and account-specific renewal need proof with actual accounts. If this flow fails the live gate, investigate a supported alternative and document an ADR before changing credential types or OAuth flows.
- Google Calendar push updates require an HTTPS webhook. With no app server, sync uses polling, backoff, and jitter.
- Reminders require Chrome running and can be delayed by sleep or OS notification settings. Durable schedules and missed-reminder recovery are required.
- Uncached offline periods must be identified, not rendered as falsely empty calendars.
- Month/week use one primary display zone. A second time-label column is custom presentation work.
