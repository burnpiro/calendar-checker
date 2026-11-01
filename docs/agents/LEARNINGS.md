# Durable notes for future agents

Keep concise, verified implementation facts here. Include the date and supporting source/test when it helps. Store no credentials, personal account information, raw API responses, or speculative findings. Move major design choices into an ADR.

## 2026-11-01

- This project began as an empty folder. The user requested local Git and documentation; no remote or publishing is authorized by that request.
- The unpacked extension ID is fixed by `config/extension-key.json`. `npm run extension:id` prints it. The public key can be committed; a private signing key must not be.
- The user configured an OAuth client in the ignored local environment file. Never overwrite it or replace it with a synthetic test value in a final build. Full real OAuth validation remains pending until the validation matrix is exercised.
- Account identity is Google's verified `sub`. Pin known-account token requests to it and compare returned identity before calendar access.
- Native account chooser behavior remains unverified with actual accounts. Do not infer success from injected adapter tests.
- Stage 1's timing preference schedules authentication/calendar-list checks, not event synchronization. Full custom notification sounds and event-sync settings remain in the plan.
- In restricted coding environments, npm registry access and launching Chromium may need sandbox escalation. The successful browser tests used a temporary profile and `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/calendar-checker-browsers`; personal Chrome data was never used.
- Account toggle state is controlled by the persisted worker response. Browser tests should click and await the final checked state instead of assuming synchronous checkbox updates.
- WXT manifest environment values must be read in the manifest callback, after dotenv loading. See `wxt.config.ts` and WXT environment-variable documentation.
- Avoid shell variable names such as `path` in zsh: `path` is tied to `PATH` and can accidentally hide installed tooling. Use task-specific variable names.
- A generic connection error after consent was traced to calling stored native `fetch` as `this.fetcher(...)`. Chrome requires the Window/Worker global receiver and threw `Illegal invocation` before any request. Direct probes worked, while injected Node mocks missed this. The default transport now wraps `globalThis.fetch`; preserve this wrapper and its real-worker test.
- Transport diagnostics use fixed safe stages/categories plus HTTP status or a bounded native numeric code. Never retain full Chrome/provider error strings. GET retries are bounded to two attempts, and partial-body timeouts are transport failures rather than malformed JSON.
- After the native-fetch fix was rebuilt/reloaded, the user confirmed successful account connection on 2026-11-01. This verifies the first account flow; multi-account and lifecycle acceptance are still pending.
