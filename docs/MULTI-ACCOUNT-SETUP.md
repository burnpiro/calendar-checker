# Add another Google account

The native Chrome token API can return the same remembered account even after its local cache is cleared. V0.3.3 adds a separate explicit chooser. Keep the existing Chrome Extension OAuth client; existing connections keep using it.

## Configure Google once

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients) in your Google Cloud project.
2. Choose **Create client → Web application**. Name it **Calendar Checker account chooser**.
3. Add this exact **Authorized redirect URI**, including the final slash:

   ```text
   https://jlaacmagfeedeplolgecnaafcidifkgk.chromiumapp.org/
   ```

4. Create the client. Copy only its **Client ID**. The extension never needs the client secret. No JavaScript origin or hosted redirect page is needed for the Chrome-intercepted flow.
5. Keep Calendar API enabled and the project's current identity/calendar-list/event-read scopes. If the OAuth app is in Testing, add both Google accounts under **Audience → Test users**.
6. Set `WXT_GOOGLE_WEB_CLIENT_ID` to the public client ID in the existing `.env.local`, rebuild, and reload. Preserve `WXT_GOOGLE_CLIENT_ID` and the extension key.

The public Web client ID comes from the ignored `.env.local` build default. Previously saved client IDs remain in use and take precedence over build defaults. The Settings page no longer exposes a client-ID editor.

Chrome intercepts the redirect. It is not an application server and no calendar information is hosted there.

## Add and verify

Click **+ Add Google account**, select the second account, and approve the current identity/calendar permissions, including event editing in stage 4. Both accounts should remain listed with their own calendars. Choosing an existing account reports **already connected**; it does not claim another account was added or replace its data. Use its **Reconnect** control for renewal.

Check each account separately, then check all. Open the calendar and sync. Confirm both identities remain correct. Continue the restart, token expiry, offline, and revoked-consent scenarios in `STAGE-1-VALIDATION.md`. No successful live result is inferred from synthetic tests.

## Renewal and troubleshooting

Web chooser access uses short-lived tokens in worker memory. There is no stored refresh token. Silent renewal relies on Google's signed-in session and previously granted consent. A lost session requires **Reconnect**, while saved calendar data remains available. Background work never opens sign-in windows. See ADR 0005 for the legacy token-flow tradeoff and acceptance gate.

- `redirect_uri_mismatch`: check the exact URI on the **Web application** client, extension ID, and trailing slash.
- Access denied/test-user restriction: confirm the second account is in the project's testing audience.
- Already connected: select a different account in Google's chooser. Confirm the configured Web application client ID is distinct from the native Chrome Extension client ID.
- Wrong account on reconnect: the identity check rejects it before calendar access; reconnect and select the intended account.
- Generate diagnostics for fixed failure codes; never share tokens, callback URLs, client secrets, or unredacted account data.
