# Calendar Checker

A local-first Google Calendar Chrome extension built with React, strict TypeScript, and WXT (Manifest V3). It connects directly to Google. There is no application backend or cloud database.

## Current release: stage 3 · v0.3.4

Google event reading and local synchronization are implemented. The toolbar popup opens a full-width month/week calendar with compact controls, with a larger calendar in its own tab. It includes:

- FullCalendar Standard month and week views, Today/previous/next navigation, and a mini date navigator.
- A collapsible calendar sidebar, independent calendar visibility, local text/type filters, and account reconnect warnings.
- Event details on click and basic previews after one second of hover; keyboard focus also exposes a preview.
- Dexie-backed event storage with reactive cross-window queries, persistence across restarts, and offline access to cached Google events.
- Shared settings for the default view, week start/weekends, 12/24-hour clock, visible week hours, scrolling or fit-to-height week layout, minimum hour height, primary time zone, theme, and density.
- Light, dark, and follow-device themes; local Google cache counts.
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

**Upgrading existing accounts:** stage 3 adds `calendar.events.readonly`. Include it in the Google project's OAuth Data Access settings, reload the extension, and use **Reconnect** where required to approve read-only event access. The popup and full calendar always display Google data. Settings → **Sync Google calendars** starts a manual sync. No new OAuth client or application server is needed. See [the stage 3 guide](docs/STAGE-3.md).

Google event access is covered by synthetic API/identity tests; live event-scope and multi-account acceptance remain pending. Event editing, notifications, custom sounds, snooze, DND, and dual time zones remain in [the full plan](docs/PLAN.md).

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

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3` from this project. Pin Calendar Checker to the toolbar. Its popup opens the calendar; the **Open full calendar** and **Settings** toolbar icons open the larger view and account/calendar preferences. After rebuilding an already loaded extension, click its Reload control in `chrome://extensions` to load v0.3.4. The native-popup sizing correction remains covered by an actual toolbar-popup test.

Without connected accounts, the calendar shows an empty grid and a prompt to connect an account. Settings displays setup instructions and disables Google sign-in until a client ID is configured. Preserve any existing `.env.local` when updating.

For development, `npm run dev` starts WXT. Use the production build above for the live authentication acceptance run, so hot reload cannot be mistaken for a token lifecycle failure.

## Week view layout

In **Settings → Calendar appearance**, **Week view layout** defaults to **Readable hours · scroll when needed**. Each hour keeps a minimum height of 48 pixels, so long hour ranges scroll inside the calendar. **Minimum hour height** can be changed from 32 to 120 pixels.

Choose **Fit all hours · no vertical scroll** to shrink the configured hour range to the available calendar height. Both popup and full calendar share the setting. The saved minimum height is retained when switching layouts. Month view keeps its existing layout.

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

Account identifiers, emails, cached calendar names/permissions, preferences, and sanitized diagnostics are stored in `chrome.storage.local`. Event data uses local Dexie/IndexedDB (`calendar-checker-events`, schema 3): Google `events`, snapshot `ranges`, per-calendar `syncStates`, and reserved `meta`. Upgrading removes the old preview-event table and its seed markers while preserving Google data. Native OAuth tokens are Chrome-managed; chooser tokens use worker memory only and session-dependent silent renewal. Provider sync cursors are durable local state and are excluded from UI metadata and diagnostics. There is no `chrome.storage.sync` usage.

Permissions remain `identity`, `storage`, `alarms`, and direct requests to `https://www.googleapis.com/*`. Google scopes cover OpenID identity, email, calendar-list read access, and event read access. No event write permission is requested.

Removing an account deletes its local metadata, cached events, coverage, and sync cursors. Pausing preserves that data while stopping sync and hiding events. Removal does not sign you out of Gmail or revoke Google's app consent. Local extension storage is cleared on uninstall; Chrome background work can be delayed by sleep or suspension.

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
- [Durable notes for future agents](docs/agents/LEARNINGS.md)

This repository is developed in local Git. No remote, publication, hosting, or deployment is required.
