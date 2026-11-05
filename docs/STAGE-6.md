# Stage 6: Verification and local packaging

Release candidate: **v0.6.0**, 2026-11-03. Local verification and packaging are implemented. The user reported completing prepublication checks on 2026-11-05; see the acceptance note below. Google OAuth production configuration and Chrome Web Store submission are separate remaining steps.

## Build and install

For an existing unpacked installation, keep its original folder and extension key. Run `npm run build`, then reload Calendar Checker at `chrome://extensions`. Do not uninstall it to upgrade: uninstalling removes local accounts, cached events, sounds and unsynced work.

For a complete verified local package:

```sh
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/calendar-checker-browsers npm run release:local
```

This runs type checking, domain/adapter tests, formatting, the production build, release-auditor tests, manifest/bundle audit, the full isolated Chromium suite, WXT ZIP creation and archive verification **sequentially**. It uses Node 22.12+, installed npm dependencies, Playwright Chromium and Python 3 (the standard-library ZIP reader validates the archive without extracting it). It neither signs a CRX nor submits to any store.

Artifacts are generated in `.output/releases/0.6.0/`:

- `calendar-checker-0.6.0-chrome.zip`: the extension files, with `manifest.json` at the archive root.
- `calendar-checker-0.6.0-chrome.zip.sha256`: archive checksum.
- `release-report.json`: stable extension ID, version, sizes, permissions and individual file hashes; no account/cache contents or access tokens.

For a new local installation, extract the ZIP to a stable folder, open `chrome://extensions`, enable Developer mode and use **Load unpacked** on that folder. The ZIP is a transport package; do not treat it as a signed installer. The committed public key preserves extension ID `jlaacmagfeedeplolgecnaafcidifkgk`. Your configured public OAuth client IDs are part of the personal build; private credentials, `.env.local`, browser profiles, calendar cache and IndexedDB are excluded. Keep the existing installation at its original location when upgrading.

`npm run verify:build` audits an already-built directory without launching Chrome. `npm run test:release` checks that the auditor rejects added capabilities, relaxed CSP, changed identity, local files, symlinks, provider fixtures, remote scripts and missing popup-sizing CSS. ZIP verification compares every file/size/hash against the audited unpacked directory and rejects duplicate or unsafe archive paths. A static artifact check is not a proof that all possible sensitive strings or runtime bugs are absent.

## Local acceptance evidence

The final `release:local` pipeline passed: 239 unit/adapter tests, 3 release-auditor tests and 21 isolated Chromium tests, including 16 axe scans with no reported WCAG 2/2.1 A/AA violations. The 840-event sample rendered in 226 ms and filtered in 125 ms on Chromium 156.0.8078.4. ZIP size is 454,321 bytes; all 24 files match the audited unpacked build. Full evidence/checksum is recorded in `STATUS.md`. The automated checks use fictional accounts/events in disposable Chromium profiles, never the user's Chrome profile.

| Area                        | Coverage                                                                                                                                                           | Status                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Auth/read/write lifecycle   | Account pinning, bounded 401 recovery, offline persistence, cursors/410, durable writes, ambiguous retries, ETags/conflicts, recurrence, cache/outbox preservation | Existing automated suites; latest result in STATUS            |
| Reminders/audio/time zones  | Durable snooze/recovery, DND/DST, imported audio, offscreen cleanup and dual-zone conversions                                                                      | Existing automated suites; OS presentation is separate        |
| Native popup                | Real toolbar popup dimensions, close/reopen and popover boundaries                                                                                                 | Existing native-popup suite                                   |
| Accessibility               | axe WCAG 2/2.1 A/AA scans of populated month/week, settings/disclosures, event details/editor, clock and zone picker in light/dark themes                          | Automated; does not replace VoiceOver/manual review           |
| Keyboard                    | Enter opens editor, initial focus, PageDown scrolls week hours, nested Escape/focus return, zone search/selection and modal focus containment                      | Automated                                                     |
| Performance                 | Crowded offline month with 840 fictional cached events; reload/render and filtered search measured in a full-calendar tab                                          | Smoke budgets: <10s render, <5s search; not an all-device SLA |
| Package/privacy/permissions | Fixed extension identity, exact permissions/hosts/scopes, explicit CSP, local entry points, popup head CSS, file allowlist, size budgets and ZIP/build parity      | Build audit and negative tests                                |
| Dependency inventory        | Pinned development-only axe auditor; runtime license notices generated from installed production dependency tree                                                   | Notices shipped locally; npm audit evidence in STATUS         |

Accessibility fixes include stronger light-theme accent text, readable adjacent-month dates, theme-appropriate button text, clock accessible names containing their displayed time and focus restoration for controlled dialogs. Week scrolling exposes semantic grid cells to the keyboard without changing FullCalendar's generated classes, hiding semantics or making aria-hidden label copies focusable. Reduced-motion mode is used during accessibility scans so transitional theme colors are not mistaken for steady-state contrast.

Production CSP permits only bundled scripts/fonts, local/data images, local/blob audio and local/Google API connections. Objects, frames, form navigation and base-URL changes are blocked. Inline styles remain allowed for React/FullCalendar layout; inline/remote scripts and eval are not enabled. Runtime notices cover the installed production dependency tree; the missing react-remove-scroll-bar notice is copied from its upstream repository and its provenance is documented in the generated notice.

## Latest user acceptance report

On 2026-11-05 the user reported completing all prepublication checks. This is accepted as a user-confirmed overall result. The earlier detailed matrix below retains the last individually recorded evidence; this report does not invent scenario-specific observations, browser versions or recordings. Continue production configuration rather than asking the user to repeat completed checks. Google OAuth verification and store submission remain separate external steps; see `PRODUCTION-GOOGLE-ACCESS.md`.

## Live acceptance matrix

| Scenario                                             | Current evidence / next procedure                                                                                                                         | Result                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Two real accounts                                    | User confirmed on 2026-11-03 that both accounts connect and synchronize their calendars                                                                   | **Passed, user-confirmed**                                          |
| First connection and real notification test          | Earlier user reports confirmed connection and desktop notification operation                                                                              | **User-confirmed basic operations**; not a full scheduler/sleep run |
| Independent renewal / browser restart / token expiry | Follow `STAGE-1-VALIDATION.md` for both accounts; retain correct identities and cache                                                                     | Pending                                                             |
| Revoke/reconnect one account                         | Revoke only a disposable test account, check badge and isolation, then reconnect it                                                                       | Pending; requires explicit user-controlled consent changes          |
| Real create/edit/delete                              | Use a disposable event without guests in each account; verify it in Google, change it, delete it, then exercise a conflicting Google edit                 | Pending                                                             |
| Real guests / Meet / Google reminders                | Use disposable calendars and explicitly chosen test recipients; verify invitations/RSVP preservation, Google notifications and async Meet success/failure | Pending; automated fixtures send no real invitations                |
| Offline/restart against real cache                   | Disconnect temporarily, reopen/restart, verify stale cache and a queued disposable edit, then restore connectivity                                        | Pending                                                             |
| Automatic desktop/audio / DND / snooze               | Schedule a disposable near-future event, close UI, verify both channels, snooze, scheduled DND and one sleep/wake cycle                                   | Pending                                                             |
| Assistive technology / older Chrome / platforms      | VoiceOver keyboard review, minimum-supported Chrome and Windows/Linux notification behavior                                                               | Pending                                                             |

Chrome internal extension pages could not be claimed by the browser automation tool in this session. No alternate inspection of private Chrome profile files or OAuth tokens was used. The user's two-account confirmation is recorded as such; it is not expanded into evidence for renewal, revocation, event writes or sleep behavior.

Record future live results with date, Chrome version, aliases A/B and a short sanitized observation. Keep identifying event/guest contents and auth callback URLs out of the repository. The next concrete task is the real-account lifecycle and disposable-event matrix above. A package can be reviewed and installed locally while these live acceptance items remain pending; broader distribution/publishing is a separate decision.

## Primary references

- [Chrome extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Chrome local development/load unpacked](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked)
- [WXT ZIP and publishing commands](https://wxt.dev/guide/essentials/publishing.html)
- [Playwright accessibility testing and its limits](https://playwright.dev/docs/accessibility-testing)
