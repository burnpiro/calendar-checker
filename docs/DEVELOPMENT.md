# Development workflow and best practices

## Working locally

Use Node 22.12+, `npm ci`, and the committed lockfile. Dependencies are pinned; update intentionally and rerun checks. `npm run dev` is for rapid UI work; `npm run build` produces the unpacked acceptance-test build. No remote Git repository or hosting is needed.

Use feature branches after the initial implementation. Keep changes focused and commit locally after appropriate verification. Never commit `.env.local`, tokens, downloaded diagnostics, private keys, browser profiles, generated builds, or test artifacts. The public extension manifest key is intentionally committed.

## Scope and architecture

- Consult `PLAN.md` and `STATUS.md` before starting. Preserve requirements across later stages, including the full settings/custom-sound scope.
- Define domain operations and validation before wiring browser APIs into UI.
- Keep browser-facing adapters injectable; avoid `chrome` access in pure domain logic.
- Add a dependency when its concrete feature is being implemented. Calendar libraries, Dexie, and sound packages are not needed merely to prove OAuth.
- Prefer explicit models, narrow interfaces, and helpful errors over generic frameworks.
- Validate untrusted API responses, runtime messages, stored schema versions, imported settings, and imported files.
- Never use a display filter to silently suppress reminders. Account enablement, calendar visibility, and notification preferences are separate concepts.
- Distinguish UTC instants, named-zone times, and date-only all-day values. Use named zones and test DST before shipping calendar scheduling.

## Chrome lifecycle

Register service-worker listeners synchronously. Persist durable state. Rebuild scheduling after worker/browser restarts, and never assume a timer or worker global will stay alive. Keep interactive sign-in behind an explicit user action. Treat alarms as approximate, and implement missed-reminder handling when reminders are introduced.

Use `chrome.storage.local` for settings and metadata. Stage 2 introduces Dexie/IndexedDB for event records and isolated samples; later stages extend it with sync and outbox data. Migrate schemas deliberately; reject unsupported versions without erasing data. Settings updates are partial patches merged by the worker. See `STAGE-2.md`.

## Tests and checks

`npm run check` runs TypeScript, domain/adapter tests, formatting, and a production build. `npm run test:extension` exercises the real bundled worker, options page, popup, and local state in an isolated Chromium profile. Install Playwright Chromium first. A Chromium process launch may need sandbox approval in restricted coding environments; it must never use the user's existing profile.

Run those commands sequentially: both build `.output/chrome-mv3`, so parallel builds can race a browser loading the unpacked extension.

Important test areas are account isolation, token retry limits, no credential leakage, offline state, durable writes, stale coverage, conflict handling, recurrence, DST, and scheduling recovery. Prefer observable outcomes and meaningful invariants over markup snapshots and tests that duplicate implementation.

For real OAuth checks, use a production build, two test accounts, and `STAGE-1-VALIDATION.md`. Do not save tokens, unredacted screenshots, or identifying diagnostic artifacts in Git. Record browser version, scenario, outcome, and sanitized failure codes. Tests that simulate Google responses do not count as successful real Google verification.

For every completed change, inspect `git diff --check`, update relevant docs, and report what actually passed and what still requires live input. Add durable findings to `agents/LEARNINGS.md` and nontrivial decisions to `decisions/`.
