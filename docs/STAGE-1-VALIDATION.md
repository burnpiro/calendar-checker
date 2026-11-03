# Stage 1 validation matrix

## Acceptance status

**Full live OAuth feasibility: pending.** An OAuth client is configured locally. Native token acquisition and direct authorized userinfo/Calendar API requests succeeded (HTTP 200). The initial CONNECT failure was traced to an invalid native-fetch receiver in the gateway, reproduced in Chrome, and fixed. The user confirmed the first-account connection succeeded after reloading the corrected bundle on 2026-11-01; broader account lifecycle flows remain unaccepted. On 2026-11-02 the user reported native Add returning the existing account with a misleading success notice. V0.3.3 adds duplicate rejection and the optional Web-client chooser; the user confirmed that both accounts connect and sync on 2026-11-03. Full lifecycle validation is still pending. Automated checks are recorded separately in `STATUS.md`.

Do not mark stage 1 fully accepted until every required live scenario below has evidence. A locally built extension and mocked tests are not proof of Google multi-account support.

## Prepare

1. Complete `GOOGLE-SETUP.md`; add two distinct accounts to the test-user audience.
2. Build with `npm run build` and load `.output/chrome-mv3` in stable Chrome.
3. Confirm the extension ID matches the OAuth client's Item ID.
4. Record the Chrome version locally. Keep credentials and identifying screenshots out of this repository.

## Required real-account scenarios

| Scenario                | Procedure and required result                                                                                                                                                                     | Result                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| First authorization     | Add account A; verify the displayed email and calendars belong to A.                                                                                                                              | Passed (user-confirmed, 2026-11-01)                                                          |
| Second authorization    | Add account B through the chooser; A remains listed and B has its own verified calendar list.                                                                                                     | Passed basic connection/sync (user-confirmed, 2026-11-03); native chooser remains unsuitable |
| Independent checks      | Check A, then B, and check all. Neither silently switches identities.                                                                                                                             | Pending                                                                                      |
| Fresh-token acquisition | Use Test token renewal for each account; both still load the correct calendars without an interactive prompt.                                                                                     | Pending                                                                                      |
| Worker suspension       | Close extension UI and allow the worker to suspend; reopen and check both accounts. Metadata and alarms survive/recover. Do not leave worker DevTools open during this test.                      | Pending                                                                                      |
| Full browser restart    | Quit all Chrome processes, reopen Chrome, then check A and B. Saved records remain and silent access recovers where consent is valid.                                                             | Pending                                                                                      |
| Natural token expiry    | Leave the extension installed beyond the issued access token's lifetime, then check both accounts. Recover silently or record the exact safe failure. Do not extract tokens into logs to do this. | Pending                                                                                      |
| Revoke one account      | Remove this app's Google Account consent for A, then check all. A requires reconnect; B continues working. Toolbar shows `!`, popup identifies A.                                                 | Pending                                                                                      |
| Targeted reconnect      | Reconnect A from its card. A recovers, B remains usable, and the badge clears when all enabled accounts are healthy.                                                                              | Pending                                                                                      |
| Cancel sign-in          | Cancel an Add or Reconnect flow. Existing account data remains unchanged.                                                                                                                         | Pending                                                                                      |
| Offline use             | Disconnect networking and check. Saved calendar lists remain visible; a network failure is not misreported as revoked consent.                                                                    | Pending                                                                                      |
| Paused account          | Pause A. Background checks skip A and an existing reconnect requirement for A does not contribute to the badge.                                                                                   | Pending                                                                                      |
| Configurable timing     | Save a new check interval; verify the alarm period changes and survives a restart.                                                                                                                | Pending                                                                                      |

## Latest live evidence

On 2026-11-03 the user answered “Both accounts connect and sync” after reloading. This passes basic second-account connection and synchronization; it does not establish fresh-token/restart/expiry/revocation behavior. Chrome internal extension tabs were unavailable to this session’s browser automation, so this result is explicitly user-confirmed rather than an agent-observed run. See `STAGE-6.md`.

## Automated coverage

Domain/adapter tests verify identity pinning, mismatch protection, 401 retry limits, partial consent, cancellation, offline preservation, disabled-account isolation, storage safety, diagnostics privacy, serialized mutations, message validation, and alarm reconstruction. Chromium tests exercise setup, settings, popup, and a real browser restart with a temporary profile.

## Recording results

For each live scenario record date, browser version, pass/fail, and a short sanitized observation. Do not record tokens, auth callback URLs, email addresses, calendar contents, or account IDs. Use aliases A and B. Any failure of chooser selection, account pinning, restart renewal, or isolation blocks the authentication feasibility gate and requires investigation before proceeding with the provider design.
