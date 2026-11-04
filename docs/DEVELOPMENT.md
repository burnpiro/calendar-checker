# Development workflow and best practices

## Working locally

Use Node 22.12+, `npm ci`, and the committed lockfile. Dependencies are pinned; update intentionally and rerun checks. `npm run dev` is for rapid UI work; `npm run build` produces the unpacked acceptance-test build. The extension needs no application hosting. The public feature site is static GitHub Pages content in `site/`; see `PUBLICATION.md`.

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

Use `chrome.storage.local` for settings and metadata. Dexie schema 5 stores Google event records, bounded coverage/membership, per-calendar sync state, an independent outbox/conflicts detached series edit bases, durable reminders and local sound Blobs. It removes legacy preview events/seed markers while preserving Google tables and unrelated metadata. Fictional calendar fixtures belong in tests only. Never delete outbox work during remote snapshot replacement or calendar cleanup; block account removal until pending work is resolved/discarded. Migrate deliberately; reject unsupported versions without erasing data. Settings updates are worker-merged patches. Read `STAGE-3.md`, `STAGE-4.md` and ADRs 0004/0006 before changing sync or writes. Keep cursor queries separate from bounded range queries; only advance cursors with complete atomic cache replacement.

Event writes must commit locally before I/O. Use stable Google-compatible IDs and private operation markers for ambiguous creations, GET/version checks and If-Match for changed-field PATCH/DELETE, and explicit conflict rebasing. Fetch a recurring master before whole-series edits; preserve its first occurrence and existing complex recurrence by default. Never silently use instance data as a master or overwrite changed remote fields.

Reminder work uses its own serial queue, separate from network/interactive authorization. Read `STAGE-5.md` and ADR 0007 before changing reminder reconciliation, native delivery, offscreen audio or cleanup. Persist snoozes/delivery attempts; avoid replaying uncertain sound and retain the existing snapshot/outbox separation. OS presentation is not atomic with IndexedDB. Never claim audibility/live OS acceptance from captured notification APIs or zero-volume browser audio tests.

## Tests and checks

`npm run check` runs TypeScript, domain/adapter tests, formatting, and a production build. `npm run test:extension` exercises the real bundled worker, options page, popup, and local state in an isolated Chromium profile. Install Playwright Chromium first. A Chromium process launch may need sandbox approval in restricted coding environments; it must never use the user's existing profile.

Run those commands sequentially: both build `.output/chrome-mv3`, so parallel builds can race a browser loading the unpacked extension.

The stage 3 browser fixture copies the unpacked build to a disposable directory, installs a synthetic public OAuth client in that copy, and overrides worker identity/HTTP APIs with fictional data. It exercises the production transport/orchestrator/database/UI without live credentials. Never overwrite `.env.local` or the final loaded build to run fixtures. Native popup sizing tests use `chrome.action.openPopup`, not a page viewport; see the popup sizing notes in `STAGE-2.md`.

Important test areas are account isolation, token retry limits, no credential leakage, offline state, durable writes, stale coverage, conflict handling, recurrence, DST, and scheduling recovery. Prefer observable outcomes and meaningful invariants over markup snapshots and tests that duplicate implementation.

For real OAuth checks, use a production build, two test accounts, and `STAGE-1-VALIDATION.md`. Do not save tokens, unredacted screenshots, or identifying diagnostic artifacts in Git. Record browser version, scenario, outcome, and sanitized failure codes. Tests that simulate Google responses do not count as successful real Google verification.

For every completed change, inspect `git diff --check`, update relevant docs, and report what actually passed and what still requires live input. Add durable findings to `agents/LEARNINGS.md` and nontrivial decisions to `decisions/`.

## Local release checks

Read `STAGE-6.md` before packaging. `npm run release:local` runs the regular checks, isolated browser suite, WXT ZIP and archive audit sequentially; Python 3 is required for the standard-library ZIP reader. `npm run check` now also exercises the artifact auditor and audits the production build. Generated ZIPs/reports stay in ignored `.output/`; do not upload or publish them without a request. The personal build embeds public OAuth client IDs, never `.env.local` or local profile data.

`prebuild`/`prezip` copy the GPL application license and generate bundled third-party notices from the pinned installed production tree. The react-remove-scroll-bar license fallback is committed with upstream provenance. If a dependency lacks its license text, resolve that explicitly rather than silently omitting it. Axe is a development-only dependency: scan both themes/populated views and keep native keyboard/focus tests alongside it. Automated scans are not a VoiceOver or all-platform certification. Preserve semantic calendar roles when adding keyboard entry points; never make aria-hidden label copies focusable or target generated FullCalendar classes.

## Public documentation and screenshots

Keep environment files ignored; `.env.example` contains empty public-client configuration only. Screenshots are intentionally versioned public assets generated from fictional fixtures in `tests/marketing/`. Run `npm run screenshots` to refresh them and `npm run test:site` after changing the static Pages site. Never capture a personal account/profile for public assets. Only `site/` is deployed by the Pages workflow. Source publication is separate from Chrome Web Store submission and live Google acceptance.

The README and Pages site introduce the product to everyday users: explain benefits in plain language and keep **Privacy first. 100% free. No subscriptions. No hidden costs.** visible. Keep the original Google connection and manual early-access installation clear. Put commands, implementation details and validation history in `TECHNICAL-REFERENCE.md`, `INSTALLATION.md` or the stage guides; do not turn the product introduction into a development report.
