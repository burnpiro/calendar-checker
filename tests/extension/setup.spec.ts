import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test";
import {
  emptyStore,
  STORAGE_KEY,
  storeSchema,
  SCOPES,
  type Store,
} from "../../src/shared/model";
import { browserFetch } from "../../src/background/google";
import { eventSchema, eventKey } from "../../src/calendar/model";

async function openWeekLayout(page: import("@playwright/test").Page) {
  const details = page.locator("#appearance .settings-disclosure");
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").click();
}

const extensionPath = resolve(".output/chrome-mv3");
interface GoogleFixture {
  version: number;
  offline: boolean;
  requests: Array<{ kind: string; hasCursor: boolean; hasBounds: boolean }>;
}

async function launch(
  profile: string,
  extension = extensionPath,
): Promise<{ context: BrowserContext; id: string }> {
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      // Configure the native virtual display as well as Playwright's page viewport.
      // Chromium's default 800x600 display leaves only 498px below its toolbar.
      "--screen-info={1440x1000}",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  return { context, id };
}

async function expectCalendarFits(page: Page) {
  await expect
    .poll(() =>
      page.getByTestId("calendar-grid").evaluate((root) => {
        const { left, right } = root.getBoundingClientRect();
        const scrollAreas = [...root.querySelectorAll<HTMLElement>("*")].filter(
          (el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              ((/auto|scroll/.test(style.overflowY) &&
                el.scrollHeight > el.clientHeight + 1) ||
                (/auto|scroll/.test(style.overflowX) &&
                  el.scrollWidth > el.clientWidth + 1))
            );
          },
        );
        return {
          fullWidth: left === 0 && right === window.innerWidth,
          scrollAreas: scrollAreas.length,
          pageOverflow:
            document.body.scrollHeight > window.innerHeight ||
            document.body.scrollWidth > window.innerWidth,
        };
      }),
    )
    .toEqual({ fullWidth: true, scrollAreas: 0, pageOverflow: false });
}

test("native toolbar popup expands to 800 by 600 and survives reopening", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-native-popup-test-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const controller = await context.newPage();
    await controller.goto(`chrome-extension://${id}/options.html`);
    const worker = context.serviceWorkers()[0]!;
    // Native popup targets are not exposed as ordinary Playwright pages.
    // The controller can inspect the same-extension Window without forcing a viewport.
    for (let attempt = 0; attempt < 2; attempt++) {
      await worker.evaluate(() => chrome.action.openPopup());
      await expect
        .poll(() =>
          controller.evaluate(() => {
            const popup = chrome.extension.getViews({ type: "popup" })[0];
            const grid = popup?.document.querySelector(".calendar-viewport");
            const rect = grid?.getBoundingClientRect();
            return popup
              ? {
                  width: popup.innerWidth,
                  height: popup.innerHeight,
                  gridWidth: rect?.width,
                  rows: popup.document.querySelectorAll(".calendar-day-row")
                    .length,
                }
              : null;
          }),
        )
        .toEqual({ width: 800, height: 600, gridWidth: 800, rows: 6 });
      await controller.evaluate(() => {
        chrome.extension.getViews({ type: "popup" })[0]?.close();
      });
      await expect
        .poll(() =>
          controller.evaluate(
            () => chrome.extension.getViews({ type: "popup" }).length,
          ),
        )
        .toBe(0);
    }
    await controller.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: {
          type: "UPDATE_SETTINGS",
          settings: { defaultView: "week", weekStartHour: 0, weekEndHour: 24 },
        },
      }),
    );
    await worker.evaluate(() => chrome.action.openPopup());
    const nativeWeek = () =>
      controller.evaluate(() => {
        const popup = chrome.extension.getViews({ type: "popup" })[0];
        const grid = popup?.document.querySelector(".calendar-viewport");
        return popup && grid
          ? {
              width: popup.innerWidth,
              height: popup.innerHeight,
              scrollable: [...grid.querySelectorAll<HTMLElement>("*")].some(
                (el) => {
                  const rect = el.getBoundingClientRect();
                  return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    /auto|scroll/.test(popup.getComputedStyle(el).overflowY) &&
                    el.scrollHeight > el.clientHeight + 1
                  );
                },
              ),
            }
          : null;
      });
    await expect
      .poll(nativeWeek)
      .toEqual({ width: 800, height: 600, scrollable: true });
    await controller.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: { type: "UPDATE_SETTINGS", settings: { weekLayout: "fit" } },
      }),
    );
    await expect
      .poll(nativeWeek)
      .toEqual({ width: 800, height: 600, scrollable: false });
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("setup, local settings and background alarms survive a browser restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-checker-test-"));
  let active: BrowserContext | undefined;
  try {
    const first = await launch(profile);
    active = first.context;
    // Exercise the production transport against Chrome's real native WorkerGlobalScope
    // binding rules. Node's fetch and injected mocks do not enforce the same receiver.
    const worker = first.context.serviceWorkers()[0]!;
    const response = await worker.evaluateHandle(
      browserFetch,
      `chrome-extension://${first.id}/manifest.json`,
    );
    expect(
      await response.evaluate(async (value) => ({
        status: value.status,
        manifestVersion: (await value.json()).manifest_version,
      })),
    ).toEqual({ status: 200, manifestVersion: 3 });
    await response.dispose();
    const page = await first.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${first.id}/options.html`);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.locator("footer code")).toHaveText(first.id);
    // Setup-free checks are meaningful even if a developer has configured their own OAuth client.
    const configured = await page.evaluate(() =>
      Boolean(chrome.runtime.getManifest().oauth2?.client_id),
    );
    if (!configured) {
      await expect(page.locator(".extension-id")).toHaveText(first.id);
      await expect(
        page.getByRole("button", { name: "+ Add Google account" }),
      ).toBeDisabled();
    }
    await page
      .getByRole("link", { name: "Connection & setup", exact: true })
      .click();
    await page
      .getByRole("spinbutton", { name: "Connection check interval" })
      .fill("9");
    await page
      .getByRole("spinbutton", { name: "Warn when data is older than" })
      .fill("27");
    await expect(
      page.locator("#connection-settings .autosave-status").first(),
    ).toHaveAttribute("data-save-state", "saved");
    const alarm = await page.evaluate(() =>
      chrome.alarms.get("calendar-checker.auth-check"),
    );
    expect(alarm?.periodInMinutes).toBe(9);
    await page
      .getByRole("spinbutton", { name: "Event sync interval", exact: true })
      .fill("7");
    await expect(page.locator("#sync .autosave-status")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    expect(
      (
        await page.evaluate(() =>
          chrome.alarms.get("calendar-checker.event-sync"),
        )
      )?.periodInMinutes,
    ).toBe(1);
    await page.getByRole("link", { name: "Diagnostics", exact: true }).click();
    await page.getByRole("button", { name: "Generate report" }).click();
    await expect(page.locator("pre")).toContainText(
      '"connectionCheckMinutes": 9',
    );
    expect(errors).toEqual([]);
    await first.context.close();
    active = undefined;

    const second = await launch(profile);
    active = second.context;
    expect(second.id).toBe(first.id);
    const reopened = await second.context.newPage();
    await reopened.goto(`chrome-extension://${second.id}/options.html`);
    await reopened
      .getByRole("link", { name: "Connection & setup", exact: true })
      .click();
    await expect(
      reopened.getByRole("spinbutton", { name: "Connection check interval" }),
    ).toHaveValue("9");
    await expect(
      reopened.getByRole("spinbutton", {
        name: "Warn when data is older than",
      }),
    ).toHaveValue("27");
    await expect(
      reopened.getByRole("spinbutton", {
        name: "Event sync interval",
        exact: true,
      }),
    ).toHaveValue("7");
    // Keep the current-time marker near the end of the day, where it must not
    // create a scrollbar when the entire 24-hour week is visible.
    await reopened.clock.setFixedTime(new Date("2026-11-01T23:59:00Z"));
    await reopened.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: {
          type: "UPDATE_SETTINGS",
          settings: { primaryTimeZone: "UTC", weekLayout: "fit" },
        },
      }),
    );
    await reopened.setViewportSize({ width: 800, height: 600 });
    await reopened.goto(`chrome-extension://${second.id}/popup.html`);
    await expect(reopened.getByTestId("calendar-grid")).toBeVisible();
    await expect(
      reopened.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(reopened.locator(".calendar-day-row")).toHaveCount(6);
    const lastRow = reopened.locator(".calendar-day-row").last();
    await expect(lastRow).toBeInViewport({ ratio: 1 });
    await expectCalendarFits(reopened);
    await expect(reopened.locator(".calendar-event")).toHaveCount(0);
    await expect(
      reopened.getByRole("button", { name: "Try demo preview" }),
    ).toHaveCount(0);
    await reopened.getByRole("heading", { level: 1 }).click();
    await reopened
      .locator(".calendar-app")
      .screenshot({ path: "test-results/popup.png" });
    await reopened.getByRole("button", { name: "Week", exact: true }).click();
    await expect(
      reopened.locator(".calendar-slot-header").first(),
    ).toBeVisible();
    await expectCalendarFits(reopened);
    await reopened.screenshot({ path: "test-results/popup-week.png" });
    // Even the widest allowed hour range must remain visible inside Chrome's cap.
    await reopened.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: {
          type: "UPDATE_SETTINGS",
          settings: { weekStartHour: 0, weekEndHour: 24, timeFormat: "12h" },
        },
      }),
    );
    await expect(reopened.locator(".calendar-slot-header")).toHaveCount(24);
    await expectCalendarFits(reopened);
    await expect(
      reopened.locator(".calendar-slot-header").last(),
    ).toBeInViewport({ ratio: 1 });
    await reopened.setViewportSize({ width: 760, height: 600 });
    await expectCalendarFits(reopened);
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("popup identifies only the affected account and pausing it clears the real toolbar badge", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-checker-test-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const page = await context.newPage();
    await context.serviceWorkers()[0]!.evaluate(() => {
      chrome.identity.getAuthToken = (async (
        details: chrome.identity.TokenDetails,
      ) => ({
        token: "badge-fixture-token",
        grantedScopes: details.scopes,
      })) as typeof chrome.identity.getAuthToken;
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        const data =
          url.pathname === "/oauth2/v3/userinfo"
            ? {
                sub: "fixture-b",
                email: "account-b@example.test",
                email_verified: true,
              }
            : {
                items: [],
                nextSyncToken: "badge-fixture-cursor",
                timeZone: "UTC",
              };
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        });
      };
    });
    await page.goto(`chrome-extension://${id}/options.html`);
    const store = emptyStore();
    const at = new Date().toISOString();
    store.accounts = [
      {
        id: "fixture-a",
        email: "account-a@example.test",
        enabled: true,
        status: "reconnect",
        errorCode: "reconnect-required",
        calendars: [],
        connectedAt: at,
        lastCheckedAt: at,
        lastSuccessfulAt: at,
      },
      {
        id: "fixture-b",
        email: "account-b@example.test",
        enabled: true,
        status: "connected",
        calendars: [
          {
            id: "fixture-calendar",
            summary: "Fixture calendar",
            accessRole: "owner",
            primary: true,
          },
        ],
        connectedAt: at,
        lastCheckedAt: at,
        lastSuccessfulAt: at,
      },
    ];
    await page.evaluate(
      async ({ key, value }) => {
        await chrome.storage.local.set({ [key]: value });
        await chrome.runtime.sendMessage({
          namespace: "calendar-checker",
          command: {
            type: "SET_ENABLED",
            accountId: "fixture-a",
            enabled: true,
          },
        });
      },
      { key: STORAGE_KEY, value: store },
    );
    await expect
      .poll(() => page.evaluate(() => chrome.action.getBadgeText({})))
      .toBe("!");
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByRole("alert")).toContainText(
      "1 account needs reconnecting",
    );
    await expect(page.getByRole("alert")).toContainText(
      "account-a@example.test",
    );
    await expect(page.getByRole("alert")).not.toContainText(
      "account-b@example.test",
    );
    await expect(page.locator(".calendar-day-row")).toHaveCount(6);
    await expectCalendarFits(page);
    await expect(page.locator(".calendar-day-row").last()).toBeInViewport({
      ratio: 1,
    });
    await page.goto(`chrome-extension://${id}/options.html`);
    const affected = page
      .locator("article")
      .filter({ hasText: "account-a@example.test" });
    await expect(
      affected.getByRole("button", { name: "Reconnect", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator("article")
        .filter({ hasText: "account-b@example.test" })
        .getByRole("button", { name: "Check connection", exact: true }),
    ).toBeVisible();
    // Controlled checkboxes reflect the worker's persisted response asynchronously.
    await affected.getByRole("checkbox").click();
    await expect(affected.getByRole("checkbox")).not.toBeChecked();
    await expect
      .poll(() => page.evaluate(() => chrome.action.getBadgeText({})))
      .toBe("");
    const saved = await page.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key],
      STORAGE_KEY,
    );
    expect(storeSchema.parse(saved).accounts[1]?.calendars[0]?.summary).toBe(
      "Fixture calendar",
    );
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.screenshot({ path: "test-results/options.png", fullPage: true });
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("fresh calendar has no preview mode and shares preferences across an offline restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-empty-test-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/calendar.html`);
    await expect(page.locator(".data-mode")).toHaveText("My calendars");
    await expect(page.locator(".calendar-event")).toHaveCount(0);
    await expect(
      page.getByText("Connect or enable a Google account in Settings", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /demo preview|Show my calendars/i }),
    ).toHaveCount(0);
    const previousTitle = await page
      .getByRole("heading", { level: 1 })
      .textContent();
    await page
      .getByRole("button", { name: "Next period", exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      previousTitle!,
    );
    await page.getByRole("button", { name: "Today", exact: true }).click();
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/options.html`);
    await expect(
      settings.getByRole("combobox", { name: "Calendar data", exact: true }),
    ).toHaveCount(0);
    await expect(
      settings.getByRole("button", { name: "Clear sample cache" }),
    ).toHaveCount(0);
    await settings
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("dark");
    await expect(
      settings.locator("#appearance .autosave-status"),
    ).toHaveAttribute("data-save-state", "saved");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await context.close();
    active = undefined;
    const reopened = await launch(profile);
    active = reopened.context;
    await active.setOffline(true);
    const offline = await active.newPage();
    await offline.goto(`chrome-extension://${id}/calendar.html`);
    await expect(offline.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(offline.locator(".data-mode")).toHaveText("My calendars");
    await expect(offline.locator(".calendar-event")).toHaveCount(0);
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("bundled worker syncs Google fixtures, updates instances and retains them across an offline browser restart", async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), "calendar-google-fixture-"));
  const fixtureExtension = join(root, "extension");
  const profile = join(root, "profile");
  let active: BrowserContext | undefined;
  try {
    // Only this disposable copy gets a synthetic public client ID. Never rewrite the
    // developer's .env.local or the final extension they load into their own Chrome.
    await cp(extensionPath, fixtureExtension, { recursive: true });
    const manifest = JSON.parse(
      await readFile(join(fixtureExtension, "manifest.json"), "utf8"),
    );
    manifest.oauth2 = {
      client_id: "123456789-fixture.apps.googleusercontent.com",
      scopes: [...SCOPES],
    };
    await writeFile(
      join(fixtureExtension, "manifest.json"),
      JSON.stringify(manifest),
    );
    const { context, id } = await launch(profile, fixtureExtension);
    active = context;
    const worker = context.serviceWorkers()[0]!;
    const date = new Date().toISOString().slice(0, 7) + "-05";
    await worker.evaluate(
      ({ date }) => {
        const fixture: GoogleFixture = {
          version: 0,
          offline: false,
          requests: [],
        };
        (
          globalThis as unknown as { calendarFixture: GoogleFixture }
        ).calendarFixture = fixture;
        chrome.identity.getAuthToken = (async (
          details: chrome.identity.TokenDetails,
        ) => ({
          token: "fixture-token-only",
          grantedScopes: details.scopes,
        })) as typeof chrome.identity.getAuthToken;
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input));
          if (url.hostname !== "www.googleapis.com")
            return nativeFetch(input, init);
          if (fixture.offline)
            throw new TypeError("Fixture connection unavailable");
          if (
            (init?.headers as Record<string, string>)?.Authorization !==
            "Bearer fixture-token-only"
          )
            throw new Error("Missing fixture authorization");
          const respond = (data: unknown, status = 200) =>
            new Response(JSON.stringify(data), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          if (url.pathname === "/oauth2/v3/userinfo")
            return respond({
              sub: "fixture-account",
              email: "fixture@example.test",
              email_verified: true,
            });
          if (url.pathname.endsWith("/calendarList"))
            return respond({
              items: [
                {
                  id: "fixture-calendar",
                  summary: "Fixture work",
                  accessRole: "owner",
                  primary: true,
                  timeZone: "UTC",
                  backgroundColor: "#348e81",
                },
              ],
            });
          if (url.pathname.endsWith("/events")) {
            const bounded = url.searchParams.has("timeMin");
            fixture.requests.push({
              kind: bounded ? "range" : "feed",
              hasCursor: url.searchParams.has("syncToken"),
              hasBounds: bounded || url.searchParams.has("timeMax"),
            });
            if (!bounded)
              return respond({
                items:
                  url.searchParams.get("syncToken") ===
                  `fixture-cursor-${fixture.version}`
                    ? []
                    : [{ id: "series" }],
                nextSyncToken: `fixture-cursor-${fixture.version}`,
              });
            return respond({
              timeZone: "UTC",
              items:
                fixture.version === 2
                  ? []
                  : [
                      {
                        id: "series-instance",
                        recurringEventId: "series",
                        originalStartTime: { dateTime: `${date}T09:00:00Z` },
                        summary: fixture.version
                          ? "Rescheduled fixture standup"
                          : "Fixture standup",
                        start: {
                          dateTime: `${date}T${fixture.version ? "11" : "09"}:00:00Z`,
                          timeZone: "UTC",
                        },
                        end: { dateTime: `${date}T12:00:00Z` },
                        eventType: "focusTime",
                        description: "<img src=x onerror=alert(1)>",
                        htmlLink:
                          "https://calendar.google.com/calendar/event?eid=fixture",
                        etag: `etag-${fixture.version}`,
                      },
                      {
                        id: "holiday",
                        summary: "Fixture day off",
                        start: { date },
                        end: { date: date.slice(0, 8) + "06" },
                        eventType: "outOfOffice",
                      },
                    ],
            });
          }
          throw new Error("Unexpected fixture endpoint");
        };
      },
      { date },
    );
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/options.html`);
    // This scenario deliberately exercises the legacy native account path.
    await settings.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: {
          type: "UPDATE_SETTINGS",
          settings: { webOAuthClientId: "" },
        },
      }),
    );
    await settings
      .getByRole("button", { name: "+ Add Google account", exact: true })
      .click();
    await expect(
      settings.locator("article").filter({ hasText: "fixture@example.test" }),
    ).toBeVisible();
    await expect(settings.getByText(/2 cached Google events/)).toBeVisible();
    await settings
      .getByRole("link", { name: "Diagnostics", exact: true })
      .click();
    await settings
      .getByRole("button", { name: "Generate report", exact: true })
      .click();
    await expect(settings.locator("pre")).toContainText('"cachedRanges": 1');
    await expect(settings.locator("pre")).not.toContainText(
      "fixture-token-only",
    );
    await expect(settings.locator("pre")).not.toContainText("fixture-cursor-");
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`chrome-extension://${id}/calendar.html`);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 800, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(
      page.getByRole("button", { name: "Try demo preview" }),
    ).toHaveCount(0);
    await settings
      .getByRole("button", { name: "Sync Google calendars", exact: true })
      .click();
    await expect(settings.getByRole("status")).toContainText(
      "See each calendar for its status",
    );
    await expect(page.locator(".data-mode")).toHaveText("My calendars");
    await expect(popup.locator(".data-mode")).toHaveText("My calendars");
    await expect(
      popup.locator(".calendar-event").filter({ hasText: "Fixture standup" }),
    ).toBeVisible();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Weekly planning" }),
    ).toHaveCount(0);
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Fixture standup" }),
    ).toBeVisible();
    await expect(page.locator(".calendar-footer")).toContainText("Last synced");
    const standup = page
      .locator(".calendar-event")
      .filter({ hasText: "Fixture standup" });
    await standup.hover();
    await expect(page.locator(".event-hover-card")).not.toBeVisible();
    await expect(page.locator(".event-hover-card")).toBeVisible({
      timeout: 2500,
    });
    await standup.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("searchbox", { name: "Search events" })
      .fill("no matching event");
    await expect(page.locator(".calendar-event")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await expect(standup).toBeVisible();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Fixture standup" })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Recurring event instance",
    );
    await expect(
      page
        .getByRole("dialog")
        .getByRole("link", { name: /Open in Google Calendar/ }),
    ).toHaveAttribute(
      "href",
      "https://calendar.google.com/calendar/event?eid=fixture",
    );
    await expect(page.getByRole("dialog").locator("img")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await worker.evaluate(() => {
      (
        globalThis as unknown as { calendarFixture: GoogleFixture }
      ).calendarFixture.version = 1;
    });
    await page
      .getByRole("button", { name: "Sync events", exact: true })
      .click();
    const updated = page
      .locator(".calendar-event")
      .filter({ hasText: "Rescheduled fixture standup" });
    await expect(updated).toBeVisible();
    await expect(updated).toHaveAccessibleName(/Rescheduled fixture standup/);
    await expect(updated).toHaveAccessibleDescription(
      /Rescheduled fixture standup/,
    );
    await expect(
      page.getByRole("button", { name: "Sync events", exact: true }),
    ).toBeEnabled();
    const rangesBefore = await worker.evaluate(
      () =>
        (
          globalThis as unknown as { calendarFixture: GoogleFixture }
        ).calendarFixture.requests.filter((r) => r.kind === "range").length,
    );
    await page
      .getByRole("button", { name: "Sync events", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Sync events", exact: true }),
    ).toBeEnabled();
    expect(
      await worker.evaluate(
        () =>
          (
            globalThis as unknown as { calendarFixture: GoogleFixture }
          ).calendarFixture.requests.filter((r) => r.kind === "range").length,
      ),
    ).toBe(rangesBefore);
    const requests = await worker.evaluate(
      () =>
        (globalThis as unknown as { calendarFixture: GoogleFixture })
          .calendarFixture.requests,
    );
    expect(
      requests.some((request) => request.kind === "feed" && request.hasCursor),
    ).toBe(true);
    expect(
      requests.some((request) => request.kind === "feed" && request.hasBounds),
    ).toBe(false);
    await page.screenshot({ path: "test-results/google-calendar.png" });
    await expect(
      popup
        .locator(".calendar-event")
        .filter({ hasText: "Rescheduled fixture standup" }),
    ).toBeVisible();
    await expectCalendarFits(popup);
    await popup.screenshot({ path: "test-results/popup-google.png" });
    await worker.evaluate(() => {
      (
        globalThis as unknown as { calendarFixture: GoogleFixture }
      ).calendarFixture.offline = true;
    });
    await context.setOffline(true);
    await settings.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: { type: "SYNC_EVENTS", reason: "manual" },
      }),
    );
    await expect(page.locator(".calendar-sync-notice")).toContainText(
      "Offline",
    );
    await expect(updated).toBeVisible();
    await page.screenshot({ path: "test-results/google-calendar-offline.png" });
    expect(errors).toEqual([]);
    await context.close();
    active = undefined;
    const reopened = await launch(profile, fixtureExtension);
    active = reopened.context;
    await reopened.context.setOffline(true);
    const offline = await reopened.context.newPage();
    await offline.goto(`chrome-extension://${id}/calendar.html`);
    await expect(
      offline
        .locator(".calendar-event")
        .filter({ hasText: "Rescheduled fixture standup" }),
    ).toBeVisible();
    await expect(offline.locator(".calendar-sync-notice")).toContainText(
      "Offline",
    );
    for (let index = 0; index < 10; index++)
      await offline
        .getByRole("button", { name: "Next period", exact: true })
        .click();
    await expect(offline.locator(".calendar-sync-notice")).toContainText(
      "not been cached",
    );
  } finally {
    await active?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit Google chooser adds a second account without replacing the native account or reporting duplicates as success", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-account-chooser-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const worker = context.serviceWorkers()[0]!;
    await worker.evaluate(() => {
      const calls: Array<{
        interactive: boolean;
        prompt: string | null;
        hint: string | null;
      }> = [];
      (globalThis as unknown as { chooserCalls: typeof calls }).chooserCalls =
        calls;
      chrome.identity.getAuthToken = (async (
        request: chrome.identity.TokenDetails,
      ) => {
        if (request.account?.id !== "fixture-native")
          throw new Error("Unexpected native identity");
        return { token: "native-fixture-token", grantedScopes: request.scopes };
      }) as typeof chrome.identity.getAuthToken;
      chrome.identity.launchWebAuthFlow = (async (
        request: chrome.identity.WebAuthFlowDetails,
      ) => {
        const url = new URL(request.url);
        calls.push({
          interactive: request.interactive === true,
          prompt: url.searchParams.get("prompt"),
          hint: url.searchParams.get("login_hint"),
        });
        return `${chrome.identity.getRedirectURL()}#${new URLSearchParams({ state: url.searchParams.get("state")!, access_token: "web-fixture-token", token_type: "Bearer", expires_in: "3600", scope: url.searchParams.get("scope")! })}`;
      }) as typeof chrome.identity.launchWebAuthFlow;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        const header = (init?.headers as Record<string, string>)?.Authorization;
        const who =
          header === "Bearer native-fixture-token"
            ? "native"
            : header === "Bearer web-fixture-token"
              ? "web"
              : undefined;
        if (!who || url.hostname !== "www.googleapis.com")
          throw new Error("Unexpected fixture request");
        const body =
          url.pathname === "/oauth2/v3/userinfo"
            ? {
                sub: `fixture-${who}`,
                email: `${who}@example.test`,
                email_verified: true,
              }
            : url.pathname.endsWith("/calendarList")
              ? {
                  items: [
                    {
                      id: `calendar-${who}`,
                      summary: `Calendar ${who}`,
                      accessRole: "owner",
                      primary: true,
                      timeZone: "UTC",
                    },
                  ],
                }
              : { items: [], nextSyncToken: "fixture-cursor", timeZone: "UTC" };
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      };
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    const store = emptyStore();
    store.settings.webOAuthClientId = "";
    const at = new Date().toISOString();
    store.accounts = [
      {
        id: "fixture-native",
        email: "native@example.test",
        enabled: true,
        status: "connected",
        calendars: [
          {
            id: "calendar-native",
            summary: "Calendar native",
            primary: true,
            accessRole: "owner",
          },
        ],
        connectedAt: at,
        lastCheckedAt: at,
        lastSuccessfulAt: at,
      },
    ];
    await page.evaluate(
      async ({ key, store }) => chrome.storage.local.set({ [key]: store }),
      { key: STORAGE_KEY, store },
    );
    await expect(
      page.locator("article").filter({ hasText: "native@example.test" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Connection & setup", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Web application client ID", exact: true })
      .fill("123456789-fixture.apps.googleusercontent.com");
    await expect(
      page.locator(
        "#connection-settings .account-chooser-form .autosave-status",
      ),
    ).toHaveAttribute("data-save-state", "saved");
    await page
      .getByRole("button", { name: "+ Add Google account", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Account connected");
    await expect(page.locator("article")).toHaveCount(2);
    await expect(
      page.locator("article").filter({ hasText: "web@example.test" }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        worker.evaluate(() =>
          (
            globalThis as unknown as { chooserCalls: Array<{ prompt: string }> }
          ).chooserCalls.map((call) => call.prompt),
        ),
      )
      .toContain("none");
    await page
      .getByRole("button", { name: "Check all enabled accounts", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Enabled accounts checked",
    );
    await expect(
      page.locator("article").filter({ hasText: "native@example.test" }),
    ).toContainText("Connected");
    await expect(
      page.locator("article").filter({ hasText: "web@example.test" }),
    ).toContainText("Connected");
    const read = () =>
      page.evaluate(
        async (key) => (await chrome.storage.local.get(key))[key],
        STORAGE_KEY,
      );
    const before = storeSchema.parse(await read()).accounts;
    await page
      .getByRole("button", { name: "+ Add Google account", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("already connected");
    await expect(page.locator(".banner.success")).toHaveCount(0);
    expect(storeSchema.parse(await read()).accounts).toEqual(before);
    const calls = await worker.evaluate(
      () =>
        (
          globalThis as unknown as {
            chooserCalls: Array<{
              interactive: boolean;
              prompt: string;
              hint: string | null;
            }>;
          }
        ).chooserCalls,
    );
    expect(
      calls
        .filter((call) => call.interactive)
        .every((call) => call.prompt === "select_account"),
    ).toBe(true);
    expect(
      calls
        .filter((call) => !call.interactive)
        .every((call) => call.prompt === "none" && call.hint === "fixture-web"),
    ).toBe(true);
    const saved = JSON.stringify(await read());
    expect(saved).not.toContain("web-fixture-token");
    expect(saved).not.toContain("native-fixture-token");
    await page.screenshot({
      path: "test-results/account-chooser.png",
      fullPage: true,
    });
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("week view scrolls at a readable hour height by default and shares the optional fit layout across restarts", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-week-layout-"));
  let active: BrowserContext | undefined;
  const metrics = (page: Page) =>
    page.getByTestId("calendar-grid").evaluate((root) => {
      const slots = [
        ...root.querySelectorAll<HTMLElement>(".calendar-slot-header"),
      ];
      const scrollers = [...root.querySelectorAll<HTMLElement>("*")].filter(
        (el) => {
          const rect = el.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            /auto|scroll/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 1
          );
        },
      );
      return {
        scrollable: scrollers.length > 0,
        slotHeight:
          slots.length > 1
            ? slots[1]!.getBoundingClientRect().top -
              slots[0]!.getBoundingClientRect().top
            : 0,
      };
    });
  try {
    const first = await launch(profile);
    active = first.context;
    const settings = await active.newPage();
    await settings.goto(`chrome-extension://${first.id}/options.html`);
    await openWeekLayout(settings);
    await expect(
      settings.getByRole("combobox", { name: "Week view layout", exact: true }),
    ).toHaveValue("scroll");
    await expect(
      settings.getByRole("spinbutton", {
        name: "Minimum hour height",
        exact: true,
      }),
    ).toHaveValue("48");
    await settings
      .getByRole("combobox", { name: /^Primary time zone/ })
      .fill("UTC");
    await settings
      .getByRole("combobox", { name: "Default view", exact: true })
      .selectOption("week");
    await settings
      .getByRole("spinbutton", { name: "Week view starts at" })
      .fill("0");
    await settings
      .getByRole("spinbutton", { name: "Week view ends at" })
      .fill("24");
    await expect(
      settings.locator("#appearance .autosave-status"),
    ).toHaveAttribute("data-save-state", "saved");
    const popup = await active.newPage();
    await popup.clock.setFixedTime(new Date("2026-11-02T23:59:00Z"));
    await popup.setViewportSize({ width: 800, height: 600 });
    await popup.goto(`chrome-extension://${first.id}/popup.html`);
    await expect(popup.locator(".calendar-slot-header")).toHaveCount(24);
    await expect.poll(async () => (await metrics(popup)).scrollable).toBe(true);
    expect((await metrics(popup)).slotHeight).toBeGreaterThanOrEqual(47);
    await popup
      .locator(".calendar-slot-header")
      .last()
      .scrollIntoViewIfNeeded();
    await expect(popup.locator(".calendar-slot-header").last()).toBeInViewport({
      ratio: 1,
    });
    await popup.screenshot({ path: "test-results/week-scroll-popup.png" });
    const full = await active.newPage();
    await full.clock.setFixedTime(new Date("2026-11-02T23:59:00Z"));
    await full.setViewportSize({ width: 1440, height: 900 });
    await full.goto(`chrome-extension://${first.id}/calendar.html`);
    await expect(full.locator(".calendar-slot-header")).toHaveCount(48);
    await expect.poll(async () => (await metrics(full)).scrollable).toBe(true);
    // Full calendar uses half-hour slots, maintaining the same minimum per hour.
    expect((await metrics(full)).slotHeight * 2).toBeGreaterThanOrEqual(47);
    await openWeekLayout(settings);
    await settings
      .getByRole("spinbutton", { name: "Minimum hour height", exact: true })
      .fill("72");
    await expect(
      settings.locator("#appearance .autosave-status"),
    ).toHaveAttribute("data-save-state", "saved");
    await expect
      .poll(async () => (await metrics(popup)).slotHeight)
      .toBeGreaterThanOrEqual(71);
    await openWeekLayout(settings);
    await settings
      .getByRole("combobox", { name: "Week view layout", exact: true })
      .selectOption("fit");
    await expect(
      settings.getByRole("spinbutton", {
        name: "Minimum hour height",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      settings.locator("#appearance .autosave-status"),
    ).toHaveAttribute("data-save-state", "saved");
    await expectCalendarFits(popup);
    await expect(popup.locator(".calendar-slot-header").first()).toBeInViewport(
      { ratio: 1 },
    );
    await expect(popup.locator(".calendar-slot-header").last()).toBeInViewport({
      ratio: 1,
    });
    await expect(full.locator(".calendar-slot-header")).toHaveCount(24);
    await expect.poll(async () => (await metrics(full)).scrollable).toBe(false);
    await popup.screenshot({ path: "test-results/week-fit-popup.png" });
    await full.screenshot({ path: "test-results/week-fit-calendar.png" });
    await active.close();
    active = undefined;
    const reopened = await launch(profile);
    active = reopened.context;
    const savedSettings = await active.newPage();
    await savedSettings.goto(`chrome-extension://${reopened.id}/options.html`);
    await openWeekLayout(savedSettings);
    await expect(
      savedSettings.getByRole("combobox", {
        name: "Week view layout",
        exact: true,
      }),
    ).toHaveValue("fit");
    await expect(
      savedSettings.getByRole("spinbutton", {
        name: "Minimum hour height",
        exact: true,
      }),
    ).toHaveValue("72");
    const savedPopup = await active.newPage();
    await savedPopup.setViewportSize({ width: 800, height: 600 });
    await savedPopup.goto(`chrome-extension://${reopened.id}/popup.html`);
    await expect(savedPopup.locator(".calendar-slot-header")).toHaveCount(24);
    await expectCalendarFits(savedPopup);
    await savedSettings
      .getByRole("combobox", { name: "Week view layout", exact: true })
      .selectOption("scroll");
    await expect(
      savedSettings.locator("#appearance .autosave-status"),
    ).toHaveAttribute("data-save-state", "saved");
    await expect
      .poll(async () => (await metrics(savedPopup)).scrollable)
      .toBe(true);
    await expect
      .poll(async () => (await metrics(savedPopup)).slotHeight)
      .toBeGreaterThanOrEqual(71);
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("toolbar badge shows today's next time, later-day distance, visibility and reconnect priority from cached events", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-toolbar-badge-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const worker = context.serviceWorkers()[0]!;
    await worker.evaluate(() => {
      Date.now = () => Date.parse("2026-11-02T10:00:00Z");
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    // Wait for worker initialization before creating the fictional local cache.
    await page.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: {
          type: "UPDATE_SETTINGS",
          settings: { primaryTimeZone: "UTC" },
        },
      }),
    );
    const store = emptyStore();
    store.settings.primaryTimeZone = "UTC";
    store.accounts = [
      {
        id: "badge-account",
        email: "badge@example.test",
        enabled: true,
        status: "connected",
        eventsReadGranted: true,
        calendars: [
          {
            id: "badge-calendar",
            summary: "Badge fixture",
            accessRole: "owner",
            primary: true,
          },
        ],
        connectedAt: "2026-11-02T10:00:00Z",
        lastCheckedAt: "2026-11-02T10:00:00Z",
        lastSuccessfulAt: "2026-11-02T10:00:00Z",
      },
    ];
    const events = ["2026-11-02T14:30:00Z", "2026-11-03T09:00:00Z"].map(
      (start, index) =>
        eventSchema.parse({
          key: eventKey("badge-account", "badge-calendar", start),
          source: "google",
          accountId: "badge-account",
          calendarId: "badge-calendar",
          eventId: start,
          title: "Badge fixture meeting",
          calendarName: "Badge fixture",
          accountName: "badge@example.test",
          color: index === 0 ? "#1a237e" : "#f6bf26",
          eventType: "default",
          allDay: false,
          start,
          end: new Date(Date.parse(start) + 3600_000).toISOString(),
          timeZone: "UTC",
          updatedAt: "2026-11-02T10:00:00Z",
        }),
    );
    await page.evaluate(
      async ({ store, events, key }) => {
        await chrome.storage.local.set({ [key]: store });
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("calendar-checker-events");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error("Fixture database failed"));
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["events", "syncStates"], "readwrite");
          for (const event of events) tx.objectStore("events").put(event);
          // Defer network sync in this cache-only fixture; no Google requests are made.
          tx.objectStore("syncStates").put({
            key: JSON.stringify(["badge-account", "badge-calendar"]),
            accountId: "badge-account",
            calendarId: "badge-calendar",
            running: false,
            invalidated: false,
            failures: 0,
            retryAt: "2050-01-01T00:00:00Z",
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(new Error("Fixture cache failed"));
        });
        db.close();
        await chrome.runtime.sendMessage({
          namespace: "calendar-checker",
          command: {
            type: "UPDATE_SETTINGS",
            settings: { showEventBadge: true },
          },
        });
      },
      { store, events, key: STORAGE_KEY },
    );
    const badge = () => page.evaluate(() => chrome.action.getBadgeText({}));
    await expect.poll(badge).toBe("14:30");
    expect(
      await page.evaluate(() => chrome.action.getBadgeBackgroundColor({})),
    ).toEqual([26, 35, 126, 255]);
    expect(
      await page.evaluate(() => chrome.action.getBadgeTextColor({})),
    ).toEqual([255, 255, 255, 255]);
    expect(await page.evaluate(() => chrome.action.getTitle({}))).toContain(
      "Badge fixture meeting",
    );
    await page
      .getByRole("checkbox", {
        name: "Show next event on toolbar",
        exact: true,
      })
      .uncheck();
    await expect(page.locator("#appearance .autosave-status")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    await expect.poll(badge).toBe("");
    await page
      .getByRole("checkbox", {
        name: "Show next event on toolbar",
        exact: true,
      })
      .check();
    await expect(page.locator("#appearance .autosave-status")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    await expect.poll(badge).toBe("14:30");
    const visible = async (show: boolean) =>
      page.evaluate(
        ({ show }) =>
          chrome.runtime.sendMessage({
            namespace: "calendar-checker",
            command: {
              type: "UPDATE_SETTINGS",
              settings: {
                calendarVisibility: {
                  [JSON.stringify(["badge-account", "badge-calendar"])]: show,
                },
              },
            },
          }),
        { show },
      );
    await visible(false);
    await expect.poll(badge).toBe("");
    await visible(true);
    await expect.poll(badge).toBe("14:30");
    await context.setOffline(true);
    // Fire the actual scheduler alarm after advancing only the worker's badge clock.
    const tick = async (at: string) =>
      worker.evaluate(async (at) => {
        Date.now = () => Date.parse(at);
        await chrome.alarms.create("calendar-checker.event-sync", {
          when: new Date().getTime() - 1000,
          periodInMinutes: 1,
        });
      }, at);
    await tick("2026-11-02T15:00:00Z");
    await expect.poll(badge).toBe("+1d");
    expect(
      await page.evaluate(() => chrome.action.getBadgeBackgroundColor({})),
    ).toEqual([246, 191, 38, 255]);
    expect(
      await page.evaluate(() => chrome.action.getBadgeTextColor({})),
    ).toEqual([0, 0, 0, 255]);
    await tick("2026-11-03T08:00:00Z");
    await expect.poll(badge).toBe("09:00");
    await page.evaluate(async (key) => {
      const value = (await chrome.storage.local.get(key))[key] as Store;
      value.accounts[0]!.status = "reconnect";
      await chrome.storage.local.set({ [key]: value });
      await chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: {
          type: "UPDATE_SETTINGS",
          settings: { showEventBadge: true },
        },
      });
    }, STORAGE_KEY);
    await expect.poll(badge).toBe("!");
    expect(
      await page.evaluate(() => chrome.action.getBadgeBackgroundColor({})),
    ).toEqual([180, 35, 53, 255]);
    await page.evaluate(async (key) => {
      const value = (await chrome.storage.local.get(key))[key] as Store;
      value.accounts[0]!.status = "connected";
      await chrome.storage.local.set({ [key]: value });
      await chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: {
          type: "UPDATE_SETTINGS",
          settings: { showEventBadge: true },
        },
      });
    }, STORAGE_KEY);
    await expect.poll(badge).toBe("09:00");
    await tick("2026-11-03T10:00:00Z");
    await expect.poll(badge).toBe("");
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

async function expectInsideWindow(panel: Locator) {
  await expect
    .poll(() =>
      panel.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 11 &&
          rect.top >= 11 &&
          rect.right <= window.innerWidth - 11 &&
          rect.bottom <= window.innerHeight - 11
        );
      }),
    )
    .toBe(true);
}

test("event lists and hover previews stay inside every popup corner and a smaller viewport", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-popover-bounds-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-11-02T11:45:00Z"));
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: {
          type: "UPDATE_SETTINGS",
          settings: { primaryTimeZone: "UTC" },
        },
      }),
    );
    const store = emptyStore();
    Object.assign(store.settings, { primaryTimeZone: "UTC", theme: "dark" });
    store.accounts = [
      {
        id: "viewport-account",
        email: "viewport@example.test",
        enabled: true,
        status: "connected",
        calendars: [
          {
            id: "viewport-calendar",
            summary: "Viewport fixture",
            accessRole: "owner",
            primary: true,
          },
        ],
        connectedAt: "2026-11-02T10:00:00Z",
        lastCheckedAt: null,
        lastSuccessfulAt: null,
      },
    ];
    const dates = ["2026-10-26", "2026-11-01", "2026-11-30", "2026-12-06"];
    const events = dates.flatMap((date, corner) =>
      Array.from({ length: corner === 3 ? 30 : 6 }, (_, index) =>
        eventSchema.parse({
          key: eventKey(
            "viewport-account",
            "viewport-calendar",
            `${date}-${index}`,
          ),
          source: "google",
          accountId: "viewport-account",
          calendarId: "viewport-calendar",
          eventId: `${date}-${index}`,
          title: `Corner ${corner} event ${String(index).padStart(2, "0")} ${"long-title-".repeat(12)}`,
          calendarName: "Viewport fixture",
          accountName: "viewport@example.test",
          color: "#7765d8",
          eventType: "default",
          allDay: true,
          start: date,
          end: new Date(Date.parse(date) + 86400_000)
            .toISOString()
            .slice(0, 10),
          timeZone: "UTC",
          updatedAt: "2026-11-02T10:00:00Z",
          description: "Long detail text. ".repeat(300),
          location: "Meeting location ".repeat(20),
        }),
      ),
    );
    await page.evaluate(
      async ({ key, store, events }) => {
        await chrome.storage.local.set({ [key]: store });
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("calendar-checker-events");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(new Error("Fixture database unavailable"));
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["events", "syncStates"], "readwrite");
          for (const event of events) tx.objectStore("events").put(event);
          tx.objectStore("syncStates").put({
            key: JSON.stringify(["viewport-account", "viewport-calendar"]),
            accountId: "viewport-account",
            calendarId: "viewport-calendar",
            running: false,
            invalidated: false,
            failures: 0,
            retryAt: "2050-01-01T00:00:00Z",
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(new Error("Fixture cache failed"));
        });
        db.close();
      },
      { key: STORAGE_KEY, store, events },
    );
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    const popup = page.locator(".calendar-event-popover");
    for (const date of dates) {
      await page
        .locator(`.calendar-day-cell[data-date="${date}"] .calendar-more-link`)
        .click();
      await expectInsideWindow(popup);
      await expect(popup.locator(".calendar-popover-close")).toBeInViewport({
        ratio: 1,
      });
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
    }
    await page
      .locator('.calendar-day-cell[data-date="2026-12-06"] .calendar-more-link')
      .click();
    const body = popup.locator(".calendar-popover-body");
    await expect
      .poll(() => body.evaluate((el) => el.scrollHeight > el.clientHeight))
      .toBe(true);
    const last = popup.locator(".calendar-event").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(popup.locator(".calendar-popover-close")).toBeInViewport({
      ratio: 1,
    });
    await last.hover();
    const preview = page.locator(".event-hover-card");
    await expect(preview).toBeVisible({ timeout: 2500 });
    await expectInsideWindow(preview);
    await page.screenshot({ path: "test-results/popover-bottom-right.png" });
    await page.setViewportSize({ width: 760, height: 500 });
    await expectInsideWindow(popup);
    await last.scrollIntoViewIfNeeded();
    await last.hover();
    await expect(preview).toBeVisible({ timeout: 2500 });
    await expectInsideWindow(preview);
    await last.click();
    const details = page.locator(".event-dialog");
    await expectInsideWindow(details);
    await expect(
      details.getByRole("button", { name: "Close event details" }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: "test-results/popover-event-details.png" });
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("week entry reveals the current hour only when needed and follows the selected zone", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-current-hour-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/options.html`);
    const patch = (value: Record<string, unknown>) =>
      settings.evaluate(
        (settings) =>
          chrome.runtime.sendMessage({
            namespace: "calendar-checker",
            command: { type: "UPDATE_SETTINGS", settings },
          }),
        value,
      );
    await patch({
      defaultView: "week",
      weekStartHour: 0,
      weekEndHour: 24,
      primaryTimeZone: "UTC",
    });
    const popup = await context.newPage();
    await popup.clock.setFixedTime(new Date("2026-11-02T11:45:00Z"));
    await popup.setViewportSize({ width: 800, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const current = popup.locator(
      '.calendar-slot-header[data-time="11:00:00"]',
    );
    await expect(current).toBeInViewport({ ratio: 1 });
    const first = popup.locator(".calendar-slot-header").first();
    await expect(first).not.toBeInViewport();
    // A taller calendar already includes 11:45, so it must retain its starting position.
    const full = await context.newPage();
    await full.clock.setFixedTime(new Date("2026-11-02T11:45:00Z"));
    await full.setViewportSize({ width: 1440, height: 1200 });
    await full.goto(`chrome-extension://${id}/calendar.html`);
    await expect(
      full.locator('.calendar-slot-header[data-time="11:00:00"]'),
    ).toBeInViewport({ ratio: 1 });
    await expect(full.locator(".calendar-slot-header").first()).toBeInViewport({
      ratio: 1,
    });
    // Manual scrolling stays under user control until Week is entered again.
    await first.scrollIntoViewIfNeeded();
    await expect(first).toBeInViewport({ ratio: 1 });
    await expect(current).not.toBeInViewport();
    await popup.getByRole("button", { name: "Month", exact: true }).click();
    await popup.getByRole("button", { name: "Week", exact: true }).click();
    await expect(current).toBeInViewport({ ratio: 1 });
    await patch({ weekLayout: "fit" });
    await expectCalendarFits(popup);
    await expect(first).toBeInViewport({ ratio: 1 });
    await expect(current).toBeInViewport({ ratio: 1 });
    await patch({ weekLayout: "scroll", primaryTimeZone: "Asia/Tokyo" });
    await expect(
      popup.locator('.calendar-slot-header[data-time="20:00:00"]'),
    ).toBeInViewport({ ratio: 1 });
    await popup.screenshot({ path: "test-results/week-current-hour.png" });
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("sidebar backdrop dismisses drawers without activating the calendar behind it", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-sidebar-backdrop-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 800, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const week = popup.getByRole("button", { name: "Week", exact: true });
    const weekBounds = await week.boundingBox();
    expect(weekBounds).not.toBeNull();
    const sidebar = popup.getByRole("complementary", {
      name: "Calendar sidebar",
    });
    await popup.getByRole("button", { name: "Open sidebar" }).click();
    await expect(sidebar).toBeVisible();
    const backdrop = popup.getByRole("button", { name: "Dismiss sidebar" });
    await expect(backdrop).toBeVisible();
    await sidebar.getByText("Event types", { exact: true }).click();
    await expect(sidebar.locator(".type-filters")).toHaveAttribute("open", "");
    await expect(sidebar).toBeVisible();
    await popup.screenshot({ path: "test-results/sidebar-backdrop.png" });
    // The overlay consumes this click rather than switching to the Week view beneath it.
    await backdrop.click({
      position: {
        x: weekBounds!.x + weekBounds!.width / 2,
        y: weekBounds!.y + weekBounds!.height / 2,
      },
    });
    await expect(sidebar).toHaveCount(0);
    await expect(week).toHaveAttribute("aria-pressed", "false");
    await expect(
      popup.getByRole("button", { name: "Month", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await popup.getByRole("button", { name: "Open sidebar" }).click();
    await popup.getByRole("button", { name: "Close sidebar" }).click();
    await expect(sidebar).toHaveCount(0);

    const full = await context.newPage();
    await full.setViewportSize({ width: 1440, height: 900 });
    await full.goto(`chrome-extension://${id}/calendar.html`);
    const fullSidebar = full.getByRole("complementary", {
      name: "Calendar sidebar",
    });
    const fullBackdrop = full.getByRole("button", { name: "Dismiss sidebar" });
    await expect(fullSidebar).toBeVisible();
    await expect(fullBackdrop).toBeHidden();
    await full.getByRole("button", { name: "Today", exact: true }).click();
    await expect(fullSidebar).toBeVisible();
    await full.setViewportSize({ width: 640, height: 600 });
    await expect(fullBackdrop).toBeVisible();
    await fullBackdrop.click({ position: { x: 620, y: 570 } });
    await expect(fullSidebar).toHaveCount(0);
    await expect(
      full.getByRole("button", { name: "Open sidebar" }),
    ).toBeVisible();
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
