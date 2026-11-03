# ADR 0011: Local release audit and explicit extension policy

Date: 2026-11-03

Status: Implemented for v0.6.0; live acceptance remains separate.

## Decision

Stage 6 produces a local unpacked build and ZIP without publishing. Run the normal checks, isolated Chromium suite and WXT ZIP sequentially; both test/build commands share the output directory. Compare archive entry names, sizes and hashes with the audited build before writing a checksum and release report. Python's standard-library ZIP reader inspects in memory, with duplicate/path validation; no archive extraction or private Chrome profile access is needed. Artifacts remain under ignored `.output/releases/`.

The build auditor checks stable public-key identity, exact extension/host/OAuth capabilities, explicit CSP, local entry points, popup head CSS, a file allowlist, suspicious content patterns and reviewed size budgets. Negative tests exercise dangerous changes. This is a bounded release check, not a complete security proof. Production runtime license notices are generated before build/ZIP; missing license text fails generation unless a reviewed upstream fallback exists. The release report never exports account state or calendar data.

Make CSP explicit: bundled scripts/fonts, self/Google API connections, self/data images and self/blob audio. Disable object/frame embedding, form navigation and base-URL changes. Inline style support remains necessary for React and FullCalendar; inline/remote scripts and eval remain disabled. No new permissions or OAuth scopes are added.

Use pinned development-only axe checks with WCAG 2/2.1 A/AA tags in populated light/dark views. Pair them with real keyboard checks for nested dialogs, time-zone selection, focus return and week PageDown scrolling. Use reduced motion during scans to avoid sampling temporary theme-transition colors. Scan findings led to paired accent/on-accent colors, readable adjacent-month dates and accessible names that include visible clock/event text. Semantic day cells/row headers supply a scrolling entry point; do not change provider grid roles or focus aria-hidden label duplicates.

Native event names follow their rendered contents; `aria-describedby` references React-rendered hidden date/calendar context so name text cannot drift as event layout changes. The native Worker fetch regression uses the bundled manifest rather than a data URL, which the explicit connect-src deliberately disallows.

The full release pipeline passed 239 unit/adapter tests, 3 artifact-auditor tests and 21 Chromium tests on 2026-11-03; ZIP parity and checksum generation completed. Sixteen populated/theme axe scans reported no tagged A/AA violations. See `STAGE-6.md` and `STATUS.md` for actual evidence and limitations.

Basic two-account connection/sync is user-confirmed on 2026-11-03. Explicitly retain live renewal/revocation/write/Meet/notification/sleep/VoiceOver gates. Automated fixture success and package checks cannot close those gates.

## References

- [Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [WXT packaging](https://wxt.dev/guide/essentials/publishing.html)
- [Playwright accessibility testing and limitations](https://playwright.dev/docs/accessibility-testing)
- [Stage 6 matrix](../STAGE-6.md)
