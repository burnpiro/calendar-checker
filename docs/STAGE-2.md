# Stage 2: calendar shell and local storage

Historical release: 0.2.2. Scope: calendar UI, local event storage, and shared preferences. The current release implements synchronization in [stage 3](STAGE-3.md); this page records the stage 2 boundaries and the native-popup sizing correction.

Current behavior changed in v0.3.4: week view now preserves a configurable minimum hour height and scrolls by default. **Settings → Calendar appearance → Week view layout → Fit all hours** restores the no-scroll layout described below. This page otherwise records historical stage 2 behavior.

## Open the calendar

Build with `npm run build`, then reload Calendar Checker at `chrome://extensions`. The toolbar popup now opens an 800×600 calendar. **Open full calendar** opens `calendar.html` in a tab; **Settings** opens account and calendar preferences. Existing Google OAuth configuration and connected accounts are preserved.

The popup uses [Chrome's maximum toolbar-popup size, 800×600 pixels](https://developer.chrome.com/docs/extensions/reference/api/action#popup), and adapts to a narrower available viewport. The grid spans the full popup width. A compact toolbar holds navigation, search, view switches, and labelled full-calendar/settings icons; a short second row identifies the data source and time zone. Month rows fit automatically, with overflow events accessible through “more” controls. Week view uses hourly slots and compact time labels to fit the configured hours, including 00:00–24:00, without scrolling the calendar. Event start/end times retain their original precision.

The popup document links `entrypoints/popup/popup.css` in its head. That stylesheet requests 800×600 on the HTML element before React mounts; its body and React root fit the viewport Chrome actually grants. Do not rely only on viewport-relative component limits to request the initial size: the native popup starts at 25×25, and those limits can prevent it from growing. The fixed HTML sizing box is a request to Chrome, while the visible content is sized to the body. Layout checks measure body overflow rather than treating the requested HTML size as visible content on a smaller viewport.

The calendar supports:

- Month/week views, previous/next/Today controls, and a mini date navigator.
- A collapsible calendar sidebar with independently persisted visibility settings.
- Local text search and event-type filters using Google's event-type names.
- Event details on click, one-second hover previews, and keyboard focus previews.
- Light/dark/follow-device themes, configurable clock format, week start/weekends, week hours, density, and primary time zone.
- Reconnect warnings in the popup and full calendar, with account controls in Settings.

The view selected in the toolbar becomes the default view and is shared across open calendar surfaces. Search and event-type filters are temporary per-window filters. Calendar visibility is persistent and does not disable account checks or change future notification preferences.

## Demo and Google modes

The initial mode is **Demo preview**, clearly labelled in the calendar header and explanatory banner. It displays fictional sample events generated locally. Sample calendars have reserved demo account/calendar identifiers and are separate from real connected accounts.

**Show my calendars** switches to the Google data context and displays the connected calendar list. Google event syncing is not implemented yet, so this context explicitly explains that syncing has not started. It never substitutes demo records for Google events or presents an empty cache as a successful Google sync.

No event creation, drag editing, reminder delivery, audio upload, DND scheduling, or secondary-zone controls are presented as working features in this stage. These remain in their planned stages.

## Storage

Dexie opens a local IndexedDB database, `calendar-checker-events`, with schema version 1:

| Table        | Contents                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `events`     | Reserved normalized Google event/occurrence cache. No Google writer is implemented in stage 2. |
| `demoEvents` | Local sample events only.                                                                      |
| `meta`       | Demo seed markers; future sync metadata must use separate keys.                                |

Event records preserve account/calendar/event provenance, original time zone, date-only or instant start/end, event type, optional ETag, and update time. All-day ends are exclusive; instants are UTC ISO values. Records are validated at generation/write boundaries. Google recurrence masters, sync coverage/cursors, and pending writes require deliberate schema extensions in later stages.

The service worker owns all demo writes through validated `PREPARE_DEMO`/`RESET_DEMO` commands and its existing serial queue. `PREPARE_DEMO` seeds the displayed month and one month on either side, transactionally marking each month. Repeated requests do not duplicate records. A seed retains the original event time zone; changing the display zone moves timed events as expected, while all-day dates stay fixed.

React reads the chosen event table with Dexie's `useLiveQuery`; cross-context mutation notifications refresh open calendars. Sample cache clearing only touches `demoEvents` and demo marker keys, and never clears `events` or connected accounts. Samples are generated again on the next demo-calendar visit/navigation.

## Preference compatibility

The existing `calendar-checker.state.v1` account/settings record remains compatible. New appearance values are added as validated defaults when an older record is read. The original required authentication timing values stay required; unknown/corrupt stores are not silently replaced.

`UPDATE_SETTINGS` now accepts a strict partial patch. The worker merges it into the current settings and validates the complete result, including start/end hour relationships. Visibility patches merge individual calendar keys as well. This prevents a timing-only update from resetting theme or visibility, and preserves the single-writer queue across windows.

Calendar visibility keys include account and calendar IDs, so diagnostic exports deliberately include only the two safe timing preferences rather than the full preference object.

## Development entry points

- `src/calendar/`: event schema, demo generation, database/repository, presentation/filter helpers.
- `src/shared/preferences.ts`: defaults, patch validation, compatible reads, time-zone validation, visibility keys.
- `src/ui/calendar/`: FullCalendar integration, toolbar/sidebar/mini calendar, event details, and calendar styling.
- `src/ui/use-extension-state.ts`: common worker-command and storage-change hook.
- `src/ui/use-theme.ts`: resolved theme and system-theme changes across surfaces.
- `src/ui/AppearanceSettings.tsx`: implemented appearance/storage preferences.

FullCalendar v7 uses its native React package, standard daygrid/timegrid/interaction plugins, Temporal, and the bundled Forma theme. Customize through documented options/render hooks and local classes; avoid internal hashed theme class names. Tailwind is integrated through Vite; Radix Dialog/Tooltip and Lucide provide accessible shared primitives and local icons. All runtime assets are bundled.

## Validation

Unit tests cover legacy preference compatibility, partial patches, diagnostic privacy, visible-hour/time-zone validation, sample/Google isolation, reset safety, database reopening, all-day end semantics, DST/date conversion, and filters. Chromium tests exercise the bundled worker/UI and remain independent of personal Chrome profiles or Google credentials. Native-popup regression coverage calls `chrome.action.openPopup()` and measures its actual extension Window through `chrome.extension.getViews`, including closing/reopening. Opening `popup.html` in a normal page with a preset viewport cannot verify native auto-sizing. The native headless display is configured explicitly with `--screen-info={1440x1000}`; a page viewport alone does not change native screen space.

Run checks sequentially because both commands build the same output directory:

```sh
npm run check
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/calendar-checker-browsers npm run test:extension
```

Review month/week/popup and both-theme screenshots in the ignored `test-results` directory after a successful browser run. Never place real account/calendar screenshots in Git.
