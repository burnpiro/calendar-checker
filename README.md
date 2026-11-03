# Calendar Checker

A local-first Google Calendar Chrome extension built with React, strict TypeScript, and WXT (Manifest V3). It connects directly to Google. There is no application backend or cloud database.

## Current release: stage 5 · v0.5.5

Google event reading/synchronization, event creation/editing, local reminders and dual time zones are implemented. The toolbar popup opens a full-width month/week calendar with compact controls, with a larger calendar in its own tab. It includes:

- FullCalendar Standard month and week views, Today/previous/next navigation, and a mini date navigator.
- A collapsible calendar sidebar with calendars grouped under account email headings, independent calendar visibility, local text/type filters, and account reconnect warnings. In the popup and narrow windows, a clickable backdrop closes the slide-out sidebar when you click outside it.
- Event details on click and basic previews after one second of hover; keyboard focus also exposes a preview. Event lists and previews stay within the visible window, with long lists scrolling internally.
- Create/edit/delete ordinary events, choose writable account/calendar destinations, edit one recurring occurrence or its whole series, and preserve existing guests/meeting links.
- A durable offline outbox, retry-safe creation, conditional edits, explicit conflict resolution, and a shared pending-changes panel.
- Optional desktop/sound reminders, imported local sounds, snooze, missed-reminder recovery, per-calendar overrides, and manual/scheduled Do not disturb.
- Optional secondary time zone with aligned week labels and exact dual-zone event details/previews.
- Dexie-backed event storage with reactive cross-window queries, persistence across restarts, and offline access to cached Google events.
- Shared settings for the default view, week start/weekends, 12/24-hour clock, visible week hours, scrolling or fit-to-height week layout, minimum hour height, primary time zone, theme, and density.
- Light, dark, and follow-device themes; local Google cache counts.
- A borderless calendar icon with a next-event badge: today’s start time or +1d, +2d, and so on for later dates.
- Read-only “Busy” time blocks for shared calendars with free/busy-only access, cached locally without event details.
- Direct Google event reading for enabled accounts, with server-expanded recurring instances, cancellations, original zones, and event details.
- Independent change cursors and bounded caches, explicit offline/stale/uncached states, durable retry backoff, and manual/background sync.
- Settings for sync frequency, refresh on open, and past/future cache months; per-calendar success/error/coverage information.

The stage 1 account features remain available in Settings:

- Explicit Google account authorization and a locally saved list of connected accounts.
- Account-specific calendar-list requests with identity verification before calendar access.
- Independent enable/disable, reconnect, and local removal controls.
- Noninteractive background connection checks and a manual fresh-token check.
- Per-account cached calendar lists, successful-check timestamps, and distinct offline/reconnect/API failure states.
- An extension icon badge and popup warning when an enabled account needs reconnecting.
- A settings page with check interval and stale-data threshold controls.
- A local diagnostic report containing safe failure steps, timeout/offline categories, HTTP statuses, and native browser network codes, without tokens, email addresses, account IDs, or calendar names.

**Full live Google verification is pending.** Authorized token acquisition and account/calendar endpoint probes have succeeded in the running extension. A Chrome native-fetch receiver bug causing the initial account-connection failure has been reproduced and fixed; the user has confirmed successful account connection after reloading the rebuilt extension. Real secondary-account selection, renewal after a full Chrome restart, and revoked-consent recovery must also be exercised. See [the validation matrix](docs/STAGE-1-VALIDATION.md). A successful endpoint probe does not count as full account-flow acceptance.

**Upgrading existing accounts:** v0.5.2 adds `calendar.events.freebusy` to display busy-only shared calendars. Add `https://www.googleapis.com/auth/calendar.events.freebusy` in Google Cloud → Google Auth Platform → Data Access, reload the extension and use **Reconnect** to approve availability access. Existing `calendar.events` access remains for reading/editing full events; no new OAuth client or application server is needed. See [the stage 4 guide](docs/STAGE-4.md).

Google event reads/writes are covered by synthetic API/identity tests; live write-scope and multi-account acceptance remain pending. Stage 5 reminder/DND/dual-zone implementation is covered by local tests; real OS display/audio and sleep acceptance remain pending. See [stage 5](docs/STAGE-5.md).

## Requirements

- Node.js 22.12 or newer (`.nvmrc` selects Node 22).
- npm and Google Chrome 120 or newer.
- A Google OAuth client of type **Chrome Extension** to connect real accounts.

## Run locally

```sh
npm ci
npm run build
npm run extension:id
```

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3` from this project. Pin Calendar Checker to the toolbar. Its popup opens the calendar; the **Open full calendar** and **Settings** toolbar icons open the larger view and account/calendar preferences. After rebuilding an already loaded extension, click its Reload control in `chrome://extensions` to load v0.5.5. The native-popup sizing correction remains covered by an actual toolbar-popup test.

Without connected accounts, the calendar shows an empty grid and a prompt to connect an account. Settings displays setup instructions and disables Google sign-in until a client ID is configured. Preserve any existing `.env.local` when updating.

For development, `npm run dev` starts WXT. Use the production build above for the live authentication acceptance run, so hot reload cannot be mistaken for a token lifecycle failure.

## Settings organization

Settings opens with connected accounts, followed by calendar display/time zones, notifications/sounds, event defaults, and sync/offline storage. A section navigator stays alongside the page on wide screens and moves above it in smaller windows. Common controls use compact cards and paired fields; technical connection checks, OAuth client setup and diagnostics start collapsed. Notification recovery/all-day rules, DND schedules, calendar overrides and detailed week-layout controls are grouped separately. Custom sounds remain with notifications; cache information stays with sync. Per-account token tests and removal are in **More options**. Each preferences group keeps its own Save button.

## Toolbar icon and next event

The calendar artwork fills the icon without a surrounding tile or border. The badge shows the next saved timed event or busy period from enabled accounts and visible calendars:

- **Today:** only its 24-hour start time, such as `14:30`.
- **Later:** calendar-day distance, such as `+1d` or `+3d`.
- **No upcoming timed event in the cache:** no event badge.

Busy-only calendars participate with a “Busy” tooltip. Contiguous day segments are joined for badge selection so an ongoing busy period does not restart at midnight.

The badge background matches the selected event's color, with black or white text chosen for readability. Dates and times use the calendar's primary time zone. All-day, declined, and already-started events are skipped. Shared calendars use the same preferred cached account as the calendar UI. Hover the icon for the saved event's name, date/time, and zone. Reconnect or storage warnings take priority.

**Settings → Calendar appearance → Show next event on toolbar** enables or disables the event badge (enabled by default). It refreshes on settings/account/cache updates and the existing one-minute scheduler, including offline use; Chrome can delay background alarms. It reflects the bounded local cache, so missing or stale Google data can affect which event is available. The toolbar badge itself does not send reminders.

## Calendar density

**Settings → Calendar appearance → Density** changes the calendar popup and full calendar. **Compact** uses shorter event rows, tighter header/footer and calendar-list spacing, and a narrower sidebar. It lets month cells fit as many events as available space permits; Comfortable retains the full calendar's three-event limit. Compact also applies inside the popup, whose smaller event text and header leave more room for dates and events. Details and editing dialogs retain their normal sizing. The week-hour height and scrolling/fit settings remain independent.

## Week view layout

In **Settings → Calendar appearance**, **Week view layout** defaults to **Readable hours · scroll when needed**. Each hour keeps a minimum height of 48 pixels, so long hour ranges scroll inside the calendar. **Minimum hour height** can be changed from 32 to 120 pixels.

Opening a calendar in Week view or switching to Week brings the current hour into view if it is offscreen. This uses the primary time zone and respects the configured hour range. If the current time is already visible, the position is left alone; normal clock updates do not override manual scrolling.

Choose **Fit all hours · no vertical scroll** to shrink the configured hour range to the available calendar height. Both popup and full calendar share the setting. The saved minimum height is retained when switching layouts. Month view keeps its existing layout.

## Create, edit and review pending changes

Click **Create event** (+) or an empty date/time to create a one-hour timed event in a writable calendar. All-day mode is an explicit choice. Choose hours/minutes on the clock face or type an exact time; the time-zone selector opens the full supported list and filters by region/city text, starting from your configured primary zone. Open an event's details to edit it; recurring events offer **Edit occurrence** and **Edit series**. The editor supports title, dates/time zone, all-day dates, location, description, basic repeating rules and confirmed deletion. Existing guests and meeting data are preserved; guest-update behavior is selectable. Specialized Google event types remain read-only here.

Changes are saved locally before sending. **Pending changes** in the calendar footer or **Settings → Event editing** shows offline/retrying work and conflicts. Choose the Google version or explicitly apply your changed fields; a newer remote edit conflicts again. Account removal is blocked until pending work is resolved/discarded. New creation IDs prevent duplicates after lost responses. Settings also chooses a default account/calendar. See [stage 4 behavior and limitations](docs/STAGE-4.md), including series master caching, unsupported this-and-following splits, and guest-list/calendar-move limitations.

## Reminders, sounds and Do not disturb

Automatic reminders start disabled. Enable desktop and/or sound alerts in **Settings → Notifications, sounds and Do not disturb**, choose reminder offsets and save. Import local audio, preview it, set volume, assign calendar-specific sounds, configure snooze presets and notification privacy, and choose missed-reminder recovery behavior. Manual or named-zone weekly DND can skip/defer due alerts, including overnight schedules.

The calendar footer's **Reminders** panel provides snooze/dismiss controls independently of native OS buttons. Reminders work from the local cache and pending edits; display filters do not silence them. Account enablement and reminder-specific calendar overrides do. Chrome must be running, and sleep/OS notification settings can delay or suppress alerts. See [the stage 5 guide](docs/STAGE-5.md) for limits and verification.

For two time zones, set **Secondary time zone** in Calendar appearance. Week labels align both zones, show date shifts and distinguish weeks with changing DST offsets. Event details and hover previews show exact times in both zones.

## Connect Google

Follow [Google OAuth setup](docs/GOOGLE-SETUP.md). The stable unpacked extension ID is:

```text
jlaacmagfeedeplolgecnaafcidifkgk
```

The committed public key in `config/extension-key.json` keeps this ID stable across local builds. It is not a secret or a private signing key. Changing it invalidates the OAuth registration's extension-ID match.

After obtaining the public OAuth client ID:

```sh
cp .env.example .env.local
```

Edit `.env.local`:

```dotenv
WXT_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
```

Then run `npm run build` and reload the extension in `chrome://extensions`. Keep the actual value supplied by Google; the example above is descriptive and is deliberately rejected by build-time validation. Never paste a client secret into this project.

Use **Add Google account** once for each account. To force an explicit chooser for a second account, configure the optional Web application OAuth client in **Settings → Google account chooser**. See [multi-account setup](docs/MULTI-ACCOUNT-SETUP.md). Existing native connections remain usable; new chooser accounts use short-lived access with session-dependent silent renewal. A lost Google session requires Reconnect. The native chooser failed the user's second-account attempt; the alternative still needs live acceptance. Choosing an existing identity now reports it as already connected.

## Commands

| Command                  | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `npm run dev`            | WXT development session                               |
| `npm run build`          | Unpacked production extension in `.output/chrome-mv3` |
| `npm run zip`            | Local distribution ZIP; does not publish              |
| `npm run typecheck`      | Generate WXT types and check strict TypeScript        |
| `npm test`               | Domain and browser-adapter tests                      |
| `npm run test:extension` | Build and run isolated Chromium extension tests       |
| `npm run check`          | Typecheck, tests, formatting, and production build    |
| `npm run format`         | Apply repository formatting                           |
| `npm run extension:id`   | Print the registered local extension ID               |

Install Chromium once before running browser tests:

```sh
npx playwright install chromium
```

You can keep the test browser in a temporary location using `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/calendar-checker-browsers` for both the install and test commands. Browser tests use a temporary, unsigned-in profile and never use your personal Chrome profile.

## Storage and permissions

Account identifiers, emails, cached calendar names/permissions, preferences, and sanitized diagnostics are stored in `chrome.storage.local`. Event data uses local Dexie/IndexedDB (`calendar-checker-events`, schema 5): Google `events`, snapshot `ranges`, per-calendar `syncStates`, mutation-receipt `meta`, independent pending `outbox`, bounded series `editBases`, durable `reminders`, and local audio `sounds`. Upgrading removes the old preview-event table and its seed markers while preserving Google data. Native OAuth tokens are Chrome-managed; chooser tokens use worker memory only and session-dependent silent renewal. Provider sync cursors are durable local state and are excluded from UI metadata and diagnostics. There is no `chrome.storage.sync` usage.

Permissions are `identity`, `storage`, `alarms`, `notifications`, `offscreen`, and direct requests to `https://www.googleapis.com/*`. Google scopes cover OpenID identity, email, calendar-list read access, event read access, and event editing (`calendar.events`), plus calendar availability (`calendar.events.freebusy`).

After resolving/discarding any pending changes, removing an account deletes its local metadata, cached events/edit bases, reminder contents, coverage, and sync cursors. Pausing preserves that data while stopping sync and hiding events. Removal does not sign you out of Gmail or revoke Google's app consent. Local extension storage is cleared on uninstall; Chrome background work can be delayed by sleep or suspension.

## Development documentation

- [Agent instructions](AGENTS.md)
- [Development workflow and best practices](docs/DEVELOPMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Authentication design and limitations](docs/AUTHENTICATION.md)
- [Google Cloud walkthrough](docs/GOOGLE-SETUP.md)
- [Explicit account chooser setup](docs/MULTI-ACCOUNT-SETUP.md)
- [Stage 1 acceptance matrix](docs/STAGE-1-VALIDATION.md)
- [Full product plan](docs/PLAN.md)
- [Current implementation status](docs/STATUS.md)
- [Stage 2 interface and storage guide](docs/STAGE-2.md)
- [Stage 3 synchronization and upgrade guide](docs/STAGE-3.md)
- [Stage 4 event editing and offline queue](docs/STAGE-4.md)
- [Stage 5 reminders, audio, DND and dual zones](docs/STAGE-5.md)
- [Durable notes for future agents](docs/agents/LEARNINGS.md)

This repository is developed in local Git. No remote, publication, hosting, or deployment is required.
