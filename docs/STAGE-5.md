# Stage 5: Reminders, sounds, Do not disturb and dual time zones

Release: v0.5.0. All settings, sounds, reminder history and snoozes stay in the local Chrome profile. No application server or additional Google OAuth scope is used.

## Upgrade and enable

Rebuild and reload at `chrome://extensions`. Chrome now needs the `notifications` and `offscreen` extension permissions; re-enable the extension if Chrome requests approval for the updated permissions. Existing OAuth client IDs, accounts, event cache, outbox and preferences are retained. Dexie schema 5 adds independent `reminders` and `sounds` tables.

In **Settings → Notifications, sounds and Do not disturb**, enable **Desktop notifications**, **Sound notifications**, or both. Both start disabled so an upgrade cannot unexpectedly send alerts. Save preferences. Use **Test desktop notification** and **Preview selected sound** to check your device; these explicit tests bypass automatic-reminder/DND switches. Chrome/OS notification permissions and volume can still prevent output. Sound previews use the selected, possibly unsaved, volume; automatic reminders use saved preferences.

## Reminder controls

- **Reminder minutes before event:** up to five distinct offsets, 0–40320 minutes; 0 means at the start. These are this extension's local reminder rules and do not edit Google Calendar's own reminders.
- **Snooze presets:** up to five values, 1–1440 minutes. The first is offered on desktop notifications alongside Dismiss. The calendar's **Reminders** panel and Settings offer every preset; this remains available on platforms that omit native notification buttons.
- **Privacy:** show title/time/calendar/location, title/time only, or a generic reminder. Existing desktop alerts are cleared when privacy changes. Event details remain available inside the extension.
- **Missed reminders:** deliver within the configured recovery window (1–1440 minutes, default 60), or skip alerts delayed more than a minute. Multiple missed offsets for the same occurrence combine into one alert. Ended events are never announced or snoozed beyond their end.
- **All-day reminders:** opt in separately. The first event day uses a configurable hour in the primary display zone; offsets apply before that instant. The original date-only event is unchanged.
- **Calendar overrides:** independently disable reminders, change offsets/sound, or suppress one channel. Global desktop/sound switches remain master switches. Shared calendar copies use one common policy and one delivery.

Display search, event-type filters and sidebar calendar visibility do not suppress reminders. Pausing/removing an account stops its reminders; shared copies in another enabled account can continue without duplicate delivery. Removing the last authorized account/calendar copy also purges its reminder contents. A locally queued deletion cancels the reminder before Google receives it; locally queued new/edited events participate through the pending overlay.

## Custom sounds

Import MP3, WAV, Ogg, M4A or WebM audio in Settings. Give it a name, preview it and choose it as the default or a calendar-specific sound. Up to ten files are allowed, each at most 5 MB and 60 seconds. File headers, decoded metadata and duration are checked. Unsupported files leave no saved provisional import; startup removes interrupted imports. Assigned sounds must be unassigned before deletion. Sounds persist through browser restarts and work offline. The original bundled chime can be regenerated with `node scripts/generate-chime.mjs`.

Audio plays in a bundled offscreen document, not the worker or popup. There is one player, so a new sound replaces the previous one. Automatic audio stops when sound is disabled or DND becomes active. Explicit previews can still run. Object URLs are revoked and idle audio documents are closed; no media is uploaded or fetched remotely.

## Do not disturb

Use manual DND indefinitely or until a device-local date/time. Weekly schedules have an explicit IANA zone or follow the device. Up to seven periods can select any weekdays. An overnight period belongs to its starting day (Monday 22:00–08:00 includes Tuesday morning). Equal start/end times cover the whole selected day. Named-zone matching handles skipped/repeated DST hours.

Choose **Skip due reminders** or **Defer within recovery window**. Deferred alerts are eligible after DND ends only while the recovery window and event lifetime still allow them. The footer shows current DND status and opens Settings. DND applies to both automatic channels.

## Delivery and recovery

A local indexed ledger records event/occurrence/start/offset identity and a random notification ID. Shared calendars are deduplicated without using display visibility. Chrome receives a one-shot alarm for the next due reminder plus a one-minute watchdog, recreated on worker/browser startup. This scheduler has its own serialized queue and does not wait for Google sync or an interactive sign-in prompt.

Desktop IDs remain stable across uncertain worker restarts, allowing replacement of the same notification rather than two concurrent copies. Sound attempts are persisted before playback, favoring no repeated sound after an uncertain crash; a crash in that narrow interval can miss sound. Notification display and database commit cannot be one atomic operation, so absolute exactly-once OS presentation is not claimed. Delivery errors appear in the reminder panel rather than exposing raw browser/provider errors.

Planning retains the nearest 5000 reminders due within 14 days, accounting for offsets up to 28 days before a later event. Event availability is still limited by the configured cache. History is retained for seven days after the event ends, with up to 50 recent rows displayed. Sleep/browser suspension/OS settings can delay alerts; Chrome must be running and alarms do not wake a sleeping device. Uninstalling the extension clears local history, sounds and snoozes.

## Dual time zones

In **Settings → Calendar appearance**, choose a primary zone and optional **Secondary time zone** (empty disables it; `device` follows the computer). Week view aligns two time-label columns. Secondary labels include `+1d`/`-1d` when dates differ. If offsets vary during the visible week, the shared axis shows each distinct conversion separated by `/`; hidden weekends are excluded. Hover previews and event details show exact dates/times in both zones. All-day events keep their date-only interpretation.

## Verification

Run `npm run check`, then `npm run test:extension` sequentially. Domain tests cover deduplication, filters/account isolation, snooze/restart recovery, missed/coalesced alerts, DND overnight/DST boundaries, pending overlays, cancellation/rescheduling, sound validation/recovery, migration preservation and dual-zone DST/date rollover. Browser tests capture desktop API requests with fictional data in disposable profiles, exercise the real offscreen audio decoder/player at zero volume, persist sounds/snoozes across Chrome restarts, check idle cleanup and validate both zone columns/hover/details.

Real OS presentation/audibility, sleep/wake behavior and native notification buttons must still be checked on the user's desktop. Existing live Google multi-account/read/write acceptance also remains pending. Stage 6 covers that broader acceptance, accessibility/performance review and local ZIP packaging; publishing requires a separate request.

## Primary references

- [Chrome notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications)
- [Chrome offscreen documents and audio](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Alarms, suspension and session behavior](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
