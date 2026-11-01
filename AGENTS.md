# Working on Calendar Checker

## Start here

Read `README.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, and `docs/DEVELOPMENT.md` before changing behavior. For authentication work also read `docs/AUTHENTICATION.md` and `docs/STAGE-1-VALIDATION.md`.

## Product contract

- React and strict TypeScript, Chrome Manifest V3, WXT.
- Local-only application storage. Network requests go directly to Google's documented OAuth/Calendar endpoints. No application backend, telemetry, remote executable code, or cloud preference synchronization.
- Multiple explicitly authorized Google accounts. Never infer that signed-in Gmail tabs grant API access, scrape account cookies, or use undocumented Google endpoints.
- Authentication belongs in the background worker. OAuth access tokens must never appear in React props, messages to UI, local persistence, console output, test artifacts, or diagnostics. Provider sync cursors are distinct persistent local state and stay out of UI metadata and diagnostics.
- Separate authentication failure, missing permission, offline/network failure, and API failure. A network outage must not turn into a reconnect prompt or erase cached data.
- Never silently change accounts, overwrite conflicting events, or lose unsynced edits.
- Settings are versioned, validated, stored locally, and shared across extension surfaces. Useful behavioral choices should be settings with safe defaults and limits.

## Development workflow

1. Confirm scope against the stage plan. Stage 3 reads and syncs Google events with bounded local caches. Writes/outbox and reminders remain stages 4–5. Read `docs/STAGE-3.md` and ADR 0004 before modifying sync or cleanup.
2. Verify changing Chrome/Google API behavior against primary documentation. Record architecture decisions in `docs/decisions/`.
3. Keep browser adapters small and domain behavior independently testable. Validate external data and runtime messages.
4. Add tests for meaningful auth, sync, persistence, scheduling, or conflict behavior. Avoid tests that merely restate markup or constants.
5. Run `npm run check`. For extension/UI or manifest changes also run `npm run test:extension` when a Chromium runtime is available.
6. Update relevant documentation and the validation matrix with actual evidence. Mocked tests do not prove real Google account behavior. Never mark the live OAuth gate complete without a real two-account run.
7. Inspect `git diff --check` and `git status` before committing. Use small local commits; keep credentials and generated artifacts ignored. Do not push or publish unless asked.

## Implementation rules

- Use `chrome.storage.local` for preferences/metadata and Dexie/IndexedDB for event data. Do not use `chrome.storage.sync` or `window.localStorage`.
- Worker globals are temporary. Persist durable state and recreate scheduling from preferences when needed.
- Serialize state mutations; do not keep storage transactions open across network requests.
- Interactive sign-in requires an explicit UI action. Background/startup checks must stay noninteractive.
- Verify returned Google `sub` against the requested account on every account-specific check, before requesting its calendars.
- Keep all Google API requests bounded by timeouts. Retry authentication once after an HTTP 401, and never loop indefinitely.
- Preserve browser API receivers when wrapping native functions: use the global-context fetch wrapper, not a native `fetch` stored and invoked as an object method. Keep real-worker coverage; Node mocks do not enforce Chrome's receiver rules.
- Request the narrowest scopes needed by the current stage. Add event write scopes with the event-writing feature.
- Treat Google event text and all API responses as untrusted. Do not render raw HTML.
- The application displays Google data only. Keep fictional provider fixtures in test code, outside the extension bundle. Never substitute samples for unsynced Google calendars. Schema 3 removes the legacy preview table/seed markers; migrations must preserve Google rows, coverage, cursors, and future pending writes.
- Change-feed cursors and bounded expanded occurrence queries are separate. Never add timeMin/timeMax/orderBy/q to cursor requests. Do not advance cursors or mark coverage fresh until all required pages/ranges commit atomically. Preserve stale snapshots on errors/410; clean only the affected calendar/account.
- Settings commands are partial patches. Merge and validate in the worker; never reset unrelated preferences. Diagnostic exports must not include account/calendar visibility keys.
- FullCalendar v7 differs from v6: use installed package types and documented render hooks/theme variables. Do not depend on hashed internal CSS class names.
- Preserve the popup's head-linked document sizing stylesheet. For sizing changes run native toolbar-popup coverage; a normal browser page with a fixed test viewport cannot verify Chrome popup auto-sizing.
- Keep production CSP restrictive and dependencies bundled. Prefer system fonts and local assets.
- Reuse local design tokens, Tailwind, Radix primitives, and Lucide icons. Do not add unused packages or duplicate the existing component system.
- Never rotate `config/extension-key.json` casually: it fixes the extension ID and OAuth registration. Its public key is safe to commit; no private signing key belongs in the repository.

## Handoff

Record what changed, tests actually run, remaining limitations, and the next concrete task. Maintain `docs/STATUS.md`; keep durable facts in documentation rather than relying on chat history.
