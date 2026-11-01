# Working on Calendar Checker

## Start here

Read `README.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, and `docs/DEVELOPMENT.md` before changing behavior. For authentication work also read `docs/AUTHENTICATION.md` and `docs/STAGE-1-VALIDATION.md`.

## Product contract

- React and strict TypeScript, Chrome Manifest V3, WXT.
- Local-only application storage. Network requests go directly to Google's documented OAuth/Calendar endpoints. No application backend, telemetry, remote executable code, or cloud preference synchronization.
- Multiple explicitly authorized Google accounts. Never infer that signed-in Gmail tabs grant API access, scrape account cookies, or use undocumented Google endpoints.
- Authentication belongs in the background worker. Tokens must never appear in React props, messages to UI, local persistence, console output, test artifacts, or diagnostics.
- Separate authentication failure, missing permission, offline/network failure, and API failure. A network outage must not turn into a reconnect prompt or erase cached data.
- Never silently change accounts, overwrite conflicting events, or lose unsynced edits.
- Settings are versioned, validated, stored locally, and shared across extension surfaces. Useful behavioral choices should be settings with safe defaults and limits.

## Development workflow

1. Confirm scope against the stage plan. Stage 1 is authentication and calendar-list access, not calendar event synchronization or editing.
2. Verify changing Chrome/Google API behavior against primary documentation. Record architecture decisions in `docs/decisions/`.
3. Keep browser adapters small and domain behavior independently testable. Validate external data and runtime messages.
4. Add tests for meaningful auth, sync, persistence, scheduling, or conflict behavior. Avoid tests that merely restate markup or constants.
5. Run `npm run check`. For extension/UI or manifest changes also run `npm run test:extension` when a Chromium runtime is available.
6. Update relevant documentation and the validation matrix with actual evidence. Mocked tests do not prove real Google account behavior. Never mark the live OAuth gate complete without a real two-account run.
7. Inspect `git diff --check` and `git status` before committing. Use small local commits; keep credentials and generated artifacts ignored. Do not push or publish unless asked.

## Implementation rules

- Use `chrome.storage.local`, and later Dexie/IndexedDB for event data. Do not use `chrome.storage.sync` or `window.localStorage`.
- Worker globals are temporary. Persist durable state and recreate scheduling from preferences when needed.
- Serialize state mutations; do not keep storage transactions open across network requests.
- Interactive sign-in requires an explicit UI action. Background/startup checks must stay noninteractive.
- Verify returned Google `sub` against the requested account on every account-specific check, before requesting its calendars.
- Keep all Google API requests bounded by timeouts. Retry authentication once after an HTTP 401, and never loop indefinitely.
- Request the narrowest scopes needed by the current stage. Add event write scopes with the event-writing feature.
- Treat Google event text and all API responses as untrusted. Do not render raw HTML.
- Keep production CSP restrictive and dependencies bundled. Prefer system fonts and local assets.
- Use ordinary CSS/design tokens in the stage 1 shell. Adopt planned UI libraries when the calendar UI needs them; do not add unused packages.
- Never rotate `config/extension-key.json` casually: it fixes the extension ID and OAuth registration. Its public key is safe to commit; no private signing key belongs in the repository.

## Handoff

Record what changed, tests actually run, remaining limitations, and the next concrete task. Maintain `docs/STATUS.md`; keep durable facts in documentation rather than relying on chat history.
