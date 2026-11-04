# Try Calendar Checker

**Privacy first. 100% free. No subscriptions. No hidden costs.**

Calendar Checker is in early access and isn't in the Chrome Web Store yet. This version needs manual installation and a one-time Google setup. You can use your existing Google calendars; there is no separate Calendar Checker account to create.

## What you'll need

- Google Chrome 120 or newer and a Google Calendar account.
- Node.js 22.12 or newer and npm on your computer.
- A Google application registration that lets the extension connect to your calendars. It does not host your calendar or the extension's saved data.

The steps below include terminal commands. If you're helping someone install the extension, complete the setup on their own computer and let them approve Google access themselves.

## 1. Get the project

Download the source from [the GitHub repository](https://github.com/burnpiro/calendar-checker) and extract it, or use Git:

```sh
git clone https://github.com/burnpiro/calendar-checker.git
cd calendar-checker
```

Open a terminal in the project folder and install what's needed:

```sh
npm ci
cp .env.example .env.local
npm run extension:id
```

If you're updating an existing installation, keep your existing `.env.local` instead of copying over it.

## 2. Allow Google access

Follow [the Google setup walkthrough](GOOGLE-SETUP.md). Put the public Chrome Extension client ID you receive into `.env.local` as `WXT_GOOGLE_CLIENT_ID`.

To connect multiple accounts through Google's account selection screen, also follow [the additional account setup](MULTI-ACCOUNT-SETUP.md) and set `WXT_GOOGLE_WEB_CLIENT_ID` in the same file. Keep both IDs. You do not need to enter a client secret.

## 3. Add it to Chrome

Build the extension:

```sh
npm run build
```

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select `.output/chrome-mv3` inside the project folder.
4. Pin **Calendar Checker** using Chrome's extensions menu.

Keep that folder in place. For later updates, rebuild and click **Reload** on the existing extension rather than removing it. Removing an installation clears its saved data, including changes not yet sent to Google.

## 4. Make it yours

Open Calendar Checker and its Settings page. Choose **Add Google account**, select an account and approve the requested access. Repeat for any other accounts you want to use. Choose your calendars, month or week view, and optional reminders.

Reminders start off. Turn on desktop and/or sound notifications if you'd like them, and allow Chrome notifications in your computer's settings. Chrome needs to be running for reminders to appear.

For fewer saved event details, turn on **Exclude event descriptions** under **Sync & offline storage**. It also removes descriptions already downloaded. Other details are still saved; notes you write yourself remain with unsent changes until Google saves them.

## Need help?

Check the troubleshooting section in [the Google setup guide](GOOGLE-SETUP.md), or [ask a question on GitHub](https://github.com/burnpiro/calendar-checker/issues). Please leave out private event details, passwords and sign-in information.

For development commands and detailed behavior, see [the technical reference](TECHNICAL-REFERENCE.md).
