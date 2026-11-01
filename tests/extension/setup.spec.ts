import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { emptyStore, STORAGE_KEY, storeSchema } from "../../src/shared/model";
import { browserFetch } from "../../src/background/google";

const extensionPath = resolve(".output/chrome-mv3");

async function launch(
  profile: string,
): Promise<{ context: BrowserContext; id: string }> {
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      // Configure the native virtual display as well as Playwright's page viewport.
      // Chromium's default 800x600 display leaves only 498px below its toolbar.
      "--screen-info={1440x1000}",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
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
    const more = reopened.locator(".calendar-more-link").first();
    await expect(more).toBeVisible();
    // Compact cells must fit both the visible event and its overflow control.
    await expect
      .poll(() =>
        more.evaluate((el) => {
          const cell = el.closest(".calendar-day-cell")!;
          const event = cell.querySelector(".calendar-event")!;
          return (
            el.getBoundingClientRect().top >=
            event.getBoundingClientRect().bottom - 1
          );
        }),
      )
      .toBe(true);
    await more.click();
    await expect(reopened.getByRole("dialog")).toBeVisible();
    await reopened.keyboard.press("Escape");
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
    // Automatic month overflow can move the first stored event behind “more”.
    await expect(page.locator(".calendar-event:visible").first()).toBeVisible();
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

test("calendar navigation, demo isolation, event details, shared preferences and offline persistence", async () => {
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), "calendar-checker-calendar-"));
  let active: BrowserContext | undefined;
  try {
    const { context, id } = await launch(profile);
    active = context;
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 960 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${id}/calendar.html`);
    await expect(
      page.getByText("Sample events, just for exploring.", { exact: false }),
    ).toBeVisible();
    const design = page
      .locator(".calendar-event")
      .filter({ hasText: "Design review" })
      .first();
    await expect(design).toBeVisible();
    await design.hover();
    await expect(page.locator(".event-hover-card")).not.toBeVisible();
    await expect(page.locator(".event-hover-card")).toBeVisible({
      timeout: 2500,
    });
    await design.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "Design review" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await design.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("searchbox", { name: "Search events" }).fill("Maya");
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Maya" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".calendar-event").filter({ hasNotText: "Maya" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Clear search", exact: true })
      .click();
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Week", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .locator(".calendar-app")
      .screenshot({ path: "test-results/calendar-week.png" });
    const work = page.getByRole("checkbox", { name: /^Work Work/ });
    await work.click();
    await expect(work).not.toBeChecked();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Design review" }),
    ).toHaveCount(0);
    await work.click();
    await expect(work).toBeChecked();
    await page.getByRole("button", { name: "Month", exact: true }).click();
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
    await page
      .locator(".calendar-app")
      .screenshot({ path: "test-results/calendar-month.png" });
    await page
      .getByRole("button", { name: "Show my calendars", exact: true })
      .click();
    await expect(
      page.getByText("Google event syncing is coming next.", { exact: false }),
    ).toBeVisible();
    await expect(page.locator(".calendar-event")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Try demo preview", exact: true })
      .click();
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/options.html`);
    await settings
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("dark");
    await settings
      .getByRole("button", { name: "Save calendar preferences", exact: true })
      .click();
    await expect(settings.getByRole("status")).toContainText(
      "Calendar preferences saved",
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page
        .locator(".calendar-event")
        .filter({ hasText: "Design review" })
        .first(),
    ).toBeVisible();
    await page
      .locator(".calendar-app")
      .screenshot({ path: "test-results/calendar-dark.png" });
    expect(errors).toEqual([]);
    await context.close();
    active = undefined;
    const reopened = await launch(profile);
    active = reopened.context;
    const offlinePage = await reopened.context.newPage();
    await reopened.context.setOffline(true);
    await offlinePage.goto(`chrome-extension://${id}/calendar.html`);
    await expect(offlinePage.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await expect(
      offlinePage
        .locator(".calendar-event")
        .filter({ hasText: "Design review" })
        .first(),
    ).toBeVisible();
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
