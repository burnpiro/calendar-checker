# Calendar Checker

A local-first Google Calendar Chrome extension built with React, strict TypeScript, and WXT (Manifest V3). It connects directly to Google. There is no application backend or cloud database.

## Current release: stage 2 · v0.2.0

The calendar shell and local storage foundation are implemented. The toolbar popup now opens a month/week calendar, with a larger calendar in its own tab. It includes:

- FullCalendar Standard month and week views, Today/previous/next navigation, and a mini date navigator.
- A collapsible calendar sidebar, independent calendar visibility, local text/type filters, and account reconnect warnings.
- Event details on click and basic previews after one second of hover; keyboard focus also exposes a preview.
- A clearly labelled demo mode with local sample events, kept in a separate IndexedDB table from Google events.
- Dexie-backed event storage with reactive cross-window queries, persistence across restarts, and offline demo use.
- Shared settings for the default view, week start/weekends, 12/24-hour clock, visible week hours, primary time zone, theme, density, and data source.
- Light, dark, and follow-device themes; local cache counts and a sample-only cache clear action.

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

**Google event synchronization is stage 3 and is not implemented yet.** Connecting an account still loads its calendar list, not its events. Use “Demo preview” to explore the UI; “My calendars” explicitly identifies that syncing is not started. Event editing, notifications, custom sounds, snooze, DND, and dual time zones remain in [the full plan](docs/PLAN.md).

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

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3` from this project. Pin Calendar Checker to the toolbar. Its popup opens the calendar; **Open full calendar** opens the larger view and **Settings** opens account and calendar preferences. After rebuilding an already loaded extension, click its Reload control in `chrome://extensions` to load v0.2.0.

The demo calendar works without OAuth credentials. Settings displays setup instructions and disables Google sign-in until a client ID is configured. Preserve any existing `.env.local` when updating.

For development, `npm run dev` starts WXT. Use the production build above for the live authentication acceptance run, so hot reload cannot be mistaken for a token lifecycle failure.

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

Use **Add Google account** once for each account. Google account selection uses Chrome's native authorization flow. Adding an account explicitly resets this extension's remembered token selection; existing account records remain saved. Whether the native chooser supports all desired secondary accounts is a live stage 1 acceptance gate.

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

Account identifiers, emails, cached calendar names/permissions, preferences, and sanitized diagnostics are stored in `chrome.storage.local`. Event data uses a local Dexie/IndexedDB database named `calendar-checker-events`, with separate `events`, `demoEvents`, and `meta` tables. Sample generation and reset never write or clear the Google event table. OAuth tokens are managed by Chrome and used transiently in the service worker. They are never sent to the UI or saved to application storage. There is no `chrome.storage.sync` usage.

Permissions are limited to `identity`, `storage`, `alarms`, and direct requests to `https://www.googleapis.com/*`. Stage 1 requests OpenID identity, email, and calendar-list read access. Event read/write scopes will be added with their corresponding features.

Removing an account deletes its local record and calendar list. It does not sign you out of Gmail or revoke Google's app consent. You can separately revoke access in your Google Account's third-party connections settings. Local extension storage is cleared when the extension is uninstalled; Chrome alarm delivery can be delayed by sleep or browser suspension.

## Development documentation

- [Agent instructions](AGENTS.md)
- [Development workflow and best practices](docs/DEVELOPMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Authentication design and limitations](docs/AUTHENTICATION.md)
- [Google Cloud walkthrough](docs/GOOGLE-SETUP.md)
- [Stage 1 acceptance matrix](docs/STAGE-1-VALIDATION.md)
- [Full product plan](docs/PLAN.md)
- [Current implementation status](docs/STATUS.md)
- [Stage 2 interface and storage guide](docs/STAGE-2.md)
- [Durable notes for future agents](docs/agents/LEARNINGS.md)

This repository is developed in local Git. No remote, publication, hosting, or deployment is required.
