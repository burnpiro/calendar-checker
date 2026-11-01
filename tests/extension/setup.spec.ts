import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  emptyStore,
  STORAGE_KEY,
  storeSchema,
  SCOPES,
} from "../../src/shared/model";
import { browserFetch } from "../../src/background/google";

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
      "data:application/json,%7B%7D",
    );
    expect(
      await response.evaluate(async (value) => ({
        status: value.status,
        body: await value.json(),
      })),
    ).toEqual({ status: 200, body: {} });
    await response.dispose();
    const page = await first.context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${first.id}/options.html`);
    await expect(
      page.getByRole("heading", { name: "Together, on your terms." }),
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
      .getByRole("spinbutton", { name: "Connection check interval" })
      .fill("9");
    await page
      .getByRole("spinbutton", { name: "Warn when data is older than" })
      .fill("27");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status")).toContainText("Settings saved");
    const alarm = await page.evaluate(() =>
      chrome.alarms.get("calendar-checker.auth-check"),
    );
    expect(alarm?.periodInMinutes).toBe(9);
    await page
      .getByRole("spinbutton", { name: "Event sync interval", exact: true })
      .fill("7");
    await page
      .getByRole("button", { name: "Save sync preferences", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Sync preferences saved",
    );
    expect(
      (
        await page.evaluate(() =>
          chrome.alarms.get("calendar-checker.event-sync"),
        )
      )?.periodInMinutes,
    ).toBe(1);
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
          settings: { primaryTimeZone: "UTC" },
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
    await settings
      .getByRole("button", { name: "Save calendar preferences", exact: true })
      .click();
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
    await expect(updated).toHaveAttribute(
      "aria-label",
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
      .getByRole("textbox", { name: "Web application client ID", exact: true })
      .fill("123456789-fixture.apps.googleusercontent.com");
    await page
      .getByRole("button", { name: "Save account chooser", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Google account chooser saved",
    );
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
