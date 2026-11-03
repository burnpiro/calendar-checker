import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { STORAGE_KEY, type Store, type Settings } from "../../src/shared/model";

test("preferences autosave only valid input and navigation follows manual scrolling", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-settings-autosave-"));
  let context: BrowserContext | undefined;
  try {
    const extension = resolve(".output/chrome-mv3");
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    await context.setOffline(true);
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto(`chrome-extension://${id}/options.html`);
    const saved = <K extends keyof Settings>(key: K) =>
      page.evaluate(
        async ({ storage, key }) => {
          const state = (await chrome.storage.local.get(storage))[storage] as
            Store | undefined;
          return state?.settings[key];
        },
        { storage: STORAGE_KEY, key },
      );
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("dark");
    await expect.poll(() => saved("theme")).toBe("dark");
    await page.getByLabel("Primary time zone").fill("Europe/");
    await expect(page.locator("#appearance .autosave-status")).toHaveAttribute(
      "data-save-state",
      "invalid",
    );
    expect(await saved("primaryTimeZone")).toBe("device");
    await page
      .getByRole("link", { name: "Connection & setup", exact: true })
      .click();
    await page
      .getByRole("spinbutton", { name: "Connection check interval" })
      .fill("9");
    await expect.poll(() => saved("connectionCheckMinutes")).toBe(9);
    await expect(page.getByLabel("Primary time zone")).toHaveValue("Europe/");
    await page.getByLabel("Primary time zone").fill("Europe/Warsaw");
    await expect.poll(() => saved("primaryTimeZone")).toBe("Europe/Warsaw");
    await page.locator("#appearance .settings-disclosure > summary").click();
    await page.getByLabel("Week view starts at").fill("");
    await expect(page.locator("#appearance .autosave-status")).toHaveAttribute(
      "data-save-state",
      "invalid",
    );
    expect(await saved("weekStartHour")).toBe(7);
    await page.getByLabel("Week view starts at").fill("23");
    expect(await saved("weekStartHour")).toBe(7);
    await page.getByLabel("Week view ends at").fill("24");
    await expect.poll(() => saved("weekStartHour")).toBe(23);
    await expect.poll(() => saved("weekEndHour")).toBe(24);
    await page.getByLabel("Event sync interval", { exact: true }).fill("");
    await expect(page.locator("#sync .autosave-status")).toHaveAttribute(
      "data-save-state",
      "invalid",
    );
    expect(await saved("syncIntervalMinutes")).toBe(5);
    await page.getByLabel("Event sync interval", { exact: true }).fill("7");
    await expect.poll(() => saved("syncIntervalMinutes")).toBe(7);
    await page.getByLabel("Manual Do not disturb", { exact: true }).check();
    await expect.poll(async () => (await saved("dnd"))?.manual).toBe(true);
    await page.getByLabel("Snooze presets in minutes").fill("0");
    await expect(
      page.locator("#notifications .autosave-status"),
    ).toHaveAttribute("data-save-state", "invalid");
    expect((await saved("reminders"))?.snoozePresets).toEqual([5, 10, 15]);
    await page.getByLabel("Snooze presets in minutes").fill("7, 15");
    await expect
      .poll(async () => (await saved("reminders"))?.snoozePresets)
      .toEqual([7, 15]);
    await page
      .getByRole("link", { name: "Connection & setup", exact: true })
      .click();
    await page
      .getByLabel("Web application client ID", { exact: true })
      .fill("invalid-client");
    await expect(
      page.locator(".account-chooser-form .autosave-status"),
    ).toHaveAttribute("data-save-state", "invalid");
    await page
      .getByLabel("Web application client ID", { exact: true })
      .fill("123456789-fixture.apps.googleusercontent.com");
    await expect
      .poll(() => saved("webOAuthClientId"))
      .toBe("123456789-fixture.apps.googleusercontent.com");
    await page.evaluate(async (storage) => {
      const state = (await chrome.storage.local.get(storage))[storage] as Store;
      state.accounts = [
        {
          id: "defaults-fixture",
          email: "defaults@example.test",
          enabled: true,
          status: "reconnect",
          connectedAt: new Date().toISOString(),
          lastCheckedAt: null,
          lastSuccessfulAt: null,
          calendars: [
            {
              id: "defaults-calendar",
              summary: "Fixture writable calendar",
              accessRole: "owner",
              primary: true,
            },
          ],
        },
      ];
      await chrome.storage.local.set({ [storage]: state });
    }, STORAGE_KEY);
    const destination = JSON.stringify([
      "defaults-fixture",
      "defaults-calendar",
    ]);
    await page
      .getByLabel("Default calendar for new events")
      .selectOption(destination);
    await expect.poll(() => saved("defaultWriteCalendar")).toBe(destination);
    await page.getByRole("link", { name: "Accounts", exact: true }).click();
    await page.evaluate(() =>
      document
        .getElementById("event-defaults")!
        .scrollIntoView({ block: "start" }),
    );
    await expect(
      page.getByRole("link", { name: "Event defaults", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    expect(new URL(page.url()).hash).toBe("#accounts");
    await page.evaluate(() =>
      document
        .getElementById("notifications")!
        .scrollIntoView({ block: "start" }),
    );
    await expect(
      page.getByRole("link", { name: "Notifications & sounds", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await expect.poll(async () => (await saved("dnd"))?.manual).toBe(true);
    await expect(page.getByText(/Currently active ·/)).toBeVisible();
    await page.screenshot({
      path: "test-results/settings-autosave-scroll.png",
    });
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(
      page.getByRole("link", { name: "Diagnostics", exact: true }),
    ).toHaveAttribute("aria-current", "location");
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Theme", exact: true }),
    ).toHaveValue("dark");
    await expect(page.getByLabel("Primary time zone")).toHaveValue(
      "Europe/Warsaw",
    );
    await expect(page.getByLabel("Snooze presets in minutes")).toHaveValue(
      "7, 15",
    );
    await expect(
      page.getByLabel("Manual Do not disturb", { exact: true }),
    ).toBeChecked();
    await expect(page.getByText(/Currently active ·/)).toBeVisible();
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
