# ADR 0009: Validated automatic preference persistence

Date: 2026-11-03

Status: Implemented for local validation in v0.5.6.

## Decision

Automatically save all preference sections, while preserving explicit sign-in, import/delete, manual sync/test and event-write actions. Keep an editor's raw draft separate from the last valid persisted settings. Empty number fields remain empty strings and fail validation instead of silently becoming zero. Related controls validate as one group, including cross-field hour ranges and reminder schedules. Invalid drafts never reach the worker and remain visible after unrelated shared-state updates.

Use a small per-editor coordinator with a serial asynchronous save loop. Validate its typed patch and the complete merged settings, then send only fields changed from that editor's baseline through the existing namespaced UPDATE_SETTINGS command. The background worker remains the sole storage writer and final validator. Nested field rebasing preserves untouched shared values; arrays are atomic. A response to an earlier save cannot replace a newer draft. Failed saves retain the draft and show retry rather than success; errors do not automatically loop. No extra persistence mechanism, permission, schema version or server is added.

Keep preference components mounted while settings snapshots update. This preserves focus, invalid text, file selections and disclosure state. Provide local saving/saved/invalid/error feedback rather than global banners for every keystroke. A valid change can take effect immediately: notification privacy should be configured before enabling desktop alerts.

Track the active Settings destination from section bounds and the viewport. Schedule one measurement per animation frame after scrolling, viewport/content resize and disclosure toggles; select the section at the upper viewport and handle the final short sections at the bottom. Do not rewrite the URL/hash/history on scroll. Clicked anchors continue to navigate and reveal advanced destinations.

## Verification

Unit coverage exercises validation, incomplete inputs, cross-field constraints, serial writes, newer edits, nested/shared-state rebasing and explicit retry. Isolated Chromium flows cover all preference sections, persisted values/reload, invalid drafts and manual scroll highlighting without a URL change. Existing sync, account, reminder and native-popup regressions remain required. No live Google account acceptance is inferred from these local preference tests.

On 2026-11-03, `npm run check` passed with 226 unit/adapter tests; the subsequent full extension suite passed all 18 Chromium tests. The Settings screenshot was inspected, including the distinct active-section highlight and saved DND status. See `../STATUS.md` for the release evidence and remaining live acceptance work.
