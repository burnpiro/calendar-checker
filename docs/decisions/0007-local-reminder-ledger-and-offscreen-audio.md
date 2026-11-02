# ADR 0007: Durable reminder ledger with isolated offscreen audio

Date: 2026-11-02

Status: Implemented in stage 5; real desktop OS/sleep acceptance remains pending.

## Decision

Use independent Dexie schema 5 `reminders` and `sounds` tables, preserving event snapshots/cursors, mutation receipts, outbox and edit bases. Reminder identity combines Google calendar/event/start/offset, without account ID, to deduplicate shared calendar copies. Select enabled/readable account copies independently of display visibility. Use the pending-write overlay so local additions/edits/deletions affect reminders offline. Reconcile rescheduling/cancellations and account removal without deleting pending writes.

Reminder settings are validated, versioned additive defaults inside the existing local store. Desktop and sound start disabled. Global channels are master switches; calendar overrides inherit defaults and cannot enable a globally disabled channel. DND uses a separate named-zone weekly wall-clock policy, including overnight starting weekdays and DST repeats. Snoozes and due/delivery state are durable. Late offsets for one occurrence coalesce; expiry/recovery windows prevent obsolete alerts after sleep.

Give the reminder service its own SerialQueue. Main worker mutation serialization is unchanged, while notification deadlines never wait behind a Google fetch/chooser. Register alarm/notification listeners synchronously. Recreate a one-minute watchdog and one next-due alarm on startup; do not use a worker timer or create one alarm per event. Plan the nearest 5000 jobs due within 14 days, including offsets for later cached events; retain event-ended history seven days and display the latest 50 rows.

Persist delivering state before calling the desktop API. A deterministic Chrome notification ID based on the job's random UUID replaces uncertain deliveries. Persist a sound attempt before playback, which avoids duplicate audio after a crash at the cost of possible missed sound in the commit/play interval. Exact atomic once-only OS presentation is impossible across IndexedDB and notifications; do not claim it. Existing desktop content is cleared when privacy changes. Desktop API failure does not block an allowed sound channel; safe channel errors remain in local history.

Use a dedicated, bundled offscreen HTML page with AUDIO_PLAYBACK and BLOBS reasons. It accepts only validated messages from the extension's background worker, reads a bundled WAV or an imported IndexedDB Blob, and supports no external media URLs. The main UI cannot send arbitrary audio messages to it. A platform audio queue serializes creation, validation, playback and idle shutdown. Audio completion notifies the worker to check idle status and close the document. DND/sound-off can stop automatic playback while explicit previews remain available. Object URLs are revoked and playback is capped.

Custom sound import is worker-owned, limited to ten files, 5 MB/60 seconds each. Validate allowed MIME/header combinations before saving a provisional Blob, decode metadata in the offscreen document with an eight-second timeout, then commit valid duration. Reject/delete failed provisional data and recover interrupted imports on startup. Keep selected sound IDs in preferences and audio in IndexedDB; never persist upload base64 or expose Blob contents in diagnostics. Prevent removal of assigned sounds.

Dual-zone week presentation uses FullCalendar's public slotHeaderContent hook. Resolve each visible primary wall-clock hour across the actual week and show distinct secondary conversions when offsets differ, including both instances of a repeated hour and date shifts. Exact event times use the event's instants in both zones; all-day dates are never shifted.

## Permissions and validation

Add only Chrome notifications/offscreen permissions. Google scopes and extension identity stay unchanged; all data/audio remains local. Synthetic tests establish scheduling/adapter behavior and real offscreen decoding, not live OS notification display, audibility, waking a sleeping computer or live Google acceptance.

See [stage 5](../STAGE-5.md) for controls, recovery limits and primary Chrome API references.
