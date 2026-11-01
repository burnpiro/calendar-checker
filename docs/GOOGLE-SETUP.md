# Obtain a Google OAuth client ID

Google Cloud is used to register the extension and authorize Calendar API access. It does not host this app or store the extension's local cache. You do not need to deploy a server or create a cloud database.

## 1. Create the project and enable Calendar API

1. Sign into [Google Cloud Console](https://console.cloud.google.com/).
2. Use the project selector at the top and choose **New project**.
3. Name it **Calendar Checker** and create it. Select this project.
4. Go to **APIs & Services → Library**.
5. Search for **Google Calendar API**, open it, and click **Enable**.

## 2. Configure Google Auth Platform

1. Open **Google Auth Platform → Overview** and choose **Get started** if prompted. Older console layouts may call this **OAuth consent screen** under APIs & Services.
2. Set the app name to **Calendar Checker**.
3. Choose your user-support email and enter a developer contact email.
4. For personal Gmail accounts choose an **External** audience. An Internal audience only works within the associated Workspace organization.
5. Finish the setup. For private testing, keep the app in **Testing** status.
6. Under **Audience → Test users**, add every Google/Gmail account you plan to connect, including yourself. Add both accounts for the stage 1 acceptance test.

Workspace organizations can restrict third-party OAuth access. An administrator may need to allow the app for a managed account. That is separate from connecting a personal Gmail account.

## 3. Add the read-only scopes

In **Data Access → Add or remove scopes**, add these exact scopes:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events.readonly
```

These identify the authorized account, list its calendars, and read their events. The event scope was added in stage 3; existing accounts may need **Reconnect** to approve it. Keep the same OAuth client and registered extension ID when upgrading. No event-writing permission or application server is needed. Broader write scopes belong to stage 4.

## 4. Create a Chrome Extension OAuth client

1. Open **Clients → Create client**.
2. Choose application type **Chrome Extension**.
3. Give it a name such as **Calendar Checker local development**.
4. Enter this **Item ID**:

   ```text
   jlaacmagfeedeplolgecnaafcidifkgk
   ```

5. Create the client.
6. Copy its **Client ID**. It will end in `.apps.googleusercontent.com`.

The client ID is a public application identifier. A client secret is neither needed nor safe to embed in this extension. Do not create a Web application or Desktop app client for the implemented native flow. Do not enter a redirect URL: Chrome's Identity API handles this flow.

The extension ID can be verified from the project with:

```sh
npm run extension:id
```

## 5. Configure, build, and load the extension

In the project directory:

```sh
cp .env.example .env.local
```

Set `WXT_GOOGLE_CLIENT_ID` to the complete identifier Google supplied. `.env.local` is Git-ignored; do not put a client secret in it.

```sh
npm run build
```

Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**. Select the project's `.output/chrome-mv3` directory. If it was already loaded, click its Reload button. Confirm that the displayed extension ID matches the Item ID registered above.

Open the popup, choose **Add Google account**, select a test account, and grant the requested access. Confirm that its email and calendars appear. Repeat for the second account, then follow [STAGE-1-VALIDATION.md](STAGE-1-VALIDATION.md).

## Common issues

For a connection failure after consent, generate a report in Settings → Connection diagnostics. The last failure identifies authorization, account details, or calendar list, and distinguishes timeouts from explicitly reported offline use. Share the safe report if troubleshooting is needed; do not share tokens or raw request headers.

| Symptom                                     | Check                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup card remains visible                  | `.env.local` has a real client ID, and the extension was rebuilt and reloaded.                                                                                                                          |
| Invalid client / OAuth error                | Client type is Chrome Extension, Item ID matches, and the correct project/client was selected.                                                                                                          |
| Google blocks a test user                   | Add that exact account in Audience → Test users; check Workspace restrictions if managed.                                                                                                               |
| Calendar API disabled                       | Enable Google Calendar API in the project that owns the OAuth client.                                                                                                                                   |
| Wrong account selected again                | The native chooser behavior needs real-browser investigation. Do not fake account IDs, scrape cookies, or claim multi-account feasibility without evidence. Record the result in the validation matrix. |
| “Reconnect needed” after consent is removed | Expected. Reconnect only the affected account and verify the other account still works.                                                                                                                 |

Testing status is intended for development and can have authorization lifetime limits. Before distribution, review Google's current publishing and OAuth verification requirements. App verification and Chrome Web Store publishing are separate processes.

## Official references

- [Chrome extension OAuth setup](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)
- [Google OAuth consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth)
