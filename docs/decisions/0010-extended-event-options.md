# ADR 0010: Extended event options through the durable outbox

Date: 2026-11-03

Status: Implemented for local validation in v0.5.7; live Google acceptance pending.

## Decision

Extend the existing event draft, normalized snapshot and durable outbox to support the controls in the supplied event-creation reference: guests, optional attendance and permissions, Google Meet, event color, availability, visibility and per-event Google notifications. Existing date/time/account/calendar/text controls remain; recurrence adds intervals, weekdays and date/never endings. No new dependency, server, permission or OAuth scope is necessary.

New record fields are optional. Existing schema-5 event/outbox data and accepted operation fingerprints remain readable. Native Google reminders are explicitly separate from local Settings reminder policies, so neither system silently replaces the other. Colors use Google IDs with a bundled local swatch palette; normalization and snapshot-label updates preserve event-level colors.

Continue writing only changed fields with If-Match and durable operation markers. Full guest-list replacement is allowed only for the organizer with a complete list of at most 200 addresses; keep response/comment/resource data for unchanged guests. Incomplete/hidden/large guest lists remain untouched. Existing guest/conference data is absent from unrelated patches. Google’s recurring-visibility behavior is disclosed in the editor.

Conference intent is keep/create/remove. Create requests use the immutable mutation UUID for the conference request ID, with conferenceDataVersion=1 for explicit conference changes. Calendar capabilities are checked from the cached list and again before delivery. Each operation creates a unique meeting rather than copying someone else’s conference. Pending/failure state and HTTPS video entry points are normalized; future sync obtains asynchronous results. Unsupported providers and attendee-owned copies cannot modify conference data here.

Save & open is an explicit creation action using the same durable queue. Persist its intent, then claim it on acknowledgment before opening only the returned HTTPS Google Calendar URL through an injected browser callback. This favors avoiding repeated tabs after uncertain crashes; a crash between claim/open can miss opening, but does not lose the saved event. Offline requests open when delivered, as shown in Pending changes. No provider template URL or cookie/account enumeration is used.

## Verification

Domain tests cover persistence/reopen, option validation, guest/RSVP preservation, partial-list restrictions, color retention, changed-field patches, stable Meet retry and one-shot opening. Transport tests cover projected metadata and conditional conference requests. Isolated Chromium exercises complete offline creation, successful delivery/opening, returned meeting links and round-trip edits without resending unchanged metadata. Live Google invitation/email/Meet outcomes remain a separate acceptance gate.

On 2026-11-03, `npm run check` passed all 239 unit/adapter tests and the subsequent full extension suite passed all 19 Chromium tests. Editor screenshots were inspected at 800×600. Provider behavior was fictional and Google event-page navigation was intercepted; no live invitation/Meet acceptance is claimed.

## Primary references

- [Google event fields, attendees, reminders, visibility and conference data](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Insert, sendUpdates and conferenceDataVersion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [PATCH and array replacement semantics](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
- [Calendar conferencing capabilities](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList)
- [Event color definitions](https://developers.google.com/workspace/calendar/api/v3/reference/colors/get)
- [Recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents)
- [Chrome tabs.create](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-create)
