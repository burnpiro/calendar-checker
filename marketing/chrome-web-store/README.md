# Chrome Web Store screenshots

These five PNGs are 1280 × 800 pixels, captured directly from the production React interface in a disposable Chromium profile. They are intended for the Chrome Web Store screenshot slots; no listing has been submitted.

| File            | Screen                                                     |
| --------------- | ---------------------------------------------------------- |
| `month.png`     | Month overview with calendars grouped by two accounts      |
| `week.png`      | Week schedule with two time zones and a shared Busy block  |
| `editor.png`    | Event editor with calendar, color, Meet and guest controls |
| `reminders.png` | Notification, sound and quiet-hours preferences            |
| `dark.png`      | Dark month calendar                                        |

All accounts, calendar names, guests and events are fictional. Addresses use the reserved `example.com` domain. No personal Chrome profile, Google token, real event, imported sound or user diagnostic is used. Fixtures live only in `tests/marketing/`, outside the extension bundle. The generator blocks network traffic and substitutes local Google responses.

Regenerate after installing the pinned dependencies and Playwright Chromium:

```sh
npm run screenshots
```

If Chromium was installed in a custom location, set `PLAYWRIGHT_BROWSERS_PATH` to that location when running the command. The same images are copied into `site/assets/screens/`; an extra 800 × 600 popup capture is generated only for the website.

Chrome's [image requirements](https://developer.chrome.com/docs/webstore/images) permit one to five 1280 × 800 or 640 × 400 screenshots. Upload the five PNGs, not the smaller popup capture. The root GPL-3.0 license applies to these project assets.
