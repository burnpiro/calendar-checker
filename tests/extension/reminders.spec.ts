import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { emptyStore, STORAGE_KEY } from "../../src/shared/model";
import type { CalendarEvent } from "../../src/calendar/model";
interface NotificationFixture {
  created: { id: string; options: chrome.notifications.NotificationOptions }[];
  cleared: string[];
}
const extension = resolve(".output/chrome-mv3");
async function open(profile: string) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      "--screen-info={1440x1000}",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await context.setOffline(true);
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    const fixture: NotificationFixture = { created: [], cleared: [] };
    (
      globalThis as unknown as { notificationFixture: NotificationFixture }
    ).notificationFixture = fixture;
    chrome.notifications.getPermissionLevel = async () => "granted" as const;
    chrome.notifications.create = (async (
      id: string,
      options: chrome.notifications.NotificationOptions,
    ) => {
      fixture.created.push({ id, options });
      return id;
    }) as typeof chrome.notifications.create;
    chrome.notifications.clear = async (id: string) => {
      fixture.cleared.push(id);
      return true;
    };
  });
  return { context, worker, id };
}
async function storeEvent(
  page: import("@playwright/test").Page,
  event: CalendarEvent,
) {
  await page.evaluate(async (event) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("calendar-checker-events");
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      tx.objectStore("events").put(event);
      tx.oncomplete = () => resolve();
      tx.onerror = reject;
    });
    db.close();
  }, event);
}

test("reminders deliver offline, snooze durably, honor DND, and support local audio import/preview after restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-reminders-"));
  let active: BrowserContext | undefined;
  try {
    const first = await open(profile);
    active = first.context;
    const settings = await first.context.newPage();
    await settings.goto(`chrome-extension://${first.id}/options.html`);
    const now = new Date();
    const start = new Date(now.getTime() + 9 * 60_000);
    const end = new Date(now.getTime() + 70 * 60_000);
    const store = emptyStore();
    store.settings.primaryTimeZone = "UTC";
    store.accounts = [
      {
        id: "fixture-account",
        email: "fixture@example.test",
        enabled: true,
        status: "offline",
        connectedAt: now.toISOString(),
        lastCheckedAt: null,
        lastSuccessfulAt: null,
        calendars: [
          {
            id: "fixture-calendar",
            summary: "Reminders fixture",
            accessRole: "owner",
            primary: true,
          },
        ],
      },
    ];
    await settings.evaluate(
      ({ key, store }) => chrome.storage.local.set({ [key]: store }),
      { key: STORAGE_KEY, store },
    );
    const event: CalendarEvent = {
      key: '["fixture-account","fixture-calendar","reminder"]',
      accountId: "fixture-account",
      calendarId: "fixture-calendar",
      eventId: "reminder",
      source: "google",
      title: "Offline fixture reminder",
      description: "",
      location: "Fixture room",
      allDay: false,
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone: "UTC",
      calendarName: "Reminders fixture",
      accountName: "fixture@example.test",
      color: "#348e81",
      eventType: "default",
      updatedAt: now.toISOString(),
    };
    await storeEvent(settings, event);
    await settings
      .getByRole("checkbox", { name: "Desktop notifications", exact: true })
      .check();
    await settings.getByLabel("Notification privacy").selectOption("private");
    await settings.getByLabel("Snooze presets in minutes").fill("5, 12");
    await settings
      .getByRole("button", { name: "Save reminder preferences", exact: true })
      .click();
    await expect
      .poll(() =>
        first.worker.evaluate(
          () =>
            (
              globalThis as unknown as {
                notificationFixture: NotificationFixture;
              }
            ).notificationFixture.created.length,
        ),
      )
      .toBe(1);
    const notification = await first.worker.evaluate(
      () =>
        (globalThis as unknown as { notificationFixture: NotificationFixture })
          .notificationFixture.created[0],
    );
    expect(notification?.options).toMatchObject({
      title: "Calendar reminder",
      silent: true,
    });
    expect(JSON.stringify(notification?.options)).not.toContain(
      "Offline fixture reminder",
    );
    await settings
      .getByRole("button", { name: "Snooze 5m", exact: true })
      .click();
    await expect(settings.getByText(/Snoozed until/)).toBeVisible();
    // The audio decoder runs in the actual extension offscreen page, without a user profile or server.
    await settings.getByLabel("Sound name").fill("Local test chime");
    await settings
      .getByLabel("Audio file")
      .setInputFiles(resolve("public/sounds/chime.wav"));
    await settings
      .getByRole("button", { name: "Import sound", exact: true })
      .click();
    await expect(
      settings.getByRole("button", {
        name: "Preview Local test chime",
        exact: true,
      }),
    ).toBeVisible();
    await settings
      .getByLabel("Default sound", { exact: true })
      .selectOption({ label: "Local test chime" });
    await settings.getByLabel("Sound volume").fill("0");
    await settings
      .getByRole("checkbox", { name: "Sound notifications", exact: true })
      .check();
    await settings
      .getByRole("checkbox", { name: "Manual Do not disturb", exact: true })
      .check();
    await settings
      .getByRole("button", { name: "Save reminder preferences", exact: true })
      .click();
    await expect(
      settings.getByText("Reminder preferences saved.", { exact: true }),
    ).toBeVisible();
    await settings
      .getByRole("button", { name: "Preview selected sound", exact: true })
      .click();
    await expect(
      settings.getByText("Sound preview started.", { exact: true }),
    ).toBeVisible();
    settings.once("dialog", (dialog) => dialog.accept());
    await settings
      .getByRole("button", { name: "Delete Local test chime", exact: true })
      .click();
    await expect(
      settings.getByText(/This sound is assigned to reminders/),
    ).toBeVisible();
    await settings
      .getByRole("heading", {
        name: "Notifications, sounds and Do not disturb",
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await settings.screenshot({ path: "test-results/reminder-settings.png" });
    await settings
      .getByRole("heading", { name: "Custom notification sounds", exact: true })
      .scrollIntoViewIfNeeded();
    await settings.screenshot({
      path: "test-results/local-sound-settings.png",
    });
    await active.close();
    active = undefined;
    const second = await open(profile);
    active = second.context;
    const restarted = await second.context.newPage();
    await restarted.goto(`chrome-extension://${second.id}/options.html`);
    await expect(
      restarted.getByRole("checkbox", {
        name: "Manual Do not disturb",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      restarted.getByRole("button", {
        name: "Preview Local test chime",
        exact: true,
      }),
    ).toBeVisible();
    await expect(restarted.getByText(/Snoozed until/)).toBeVisible();
    await expect
      .poll(() =>
        second.worker.evaluate(
          async () =>
            (await chrome.alarms.get("calendar-checker.reminder-tick"))
              ?.periodInMinutes,
        ),
      )
      .toBe(1);
    await expect
      .poll(() =>
        second.worker.evaluate(async () =>
          Boolean(await chrome.alarms.get("calendar-checker.reminder-next")),
        ),
      )
      .toBe(true);
    await restarted
      .getByRole("button", { name: "Preview selected sound", exact: true })
      .click();
    await expect(
      restarted.getByText("Sound preview started.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          second.worker.evaluate(
            async () =>
              (
                await chrome.runtime.getContexts({
                  contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
                })
              ).length,
          ),
        { timeout: 10000 },
      )
      .toBe(0);

    expect(
      await second.worker.evaluate(
        () =>
          (
            globalThis as unknown as {
              notificationFixture: NotificationFixture;
            }
          ).notificationFixture.created,
      ),
    ).toHaveLength(0);
    await restarted
      .getByRole("button", { name: "Dismiss", exact: true })
      .click();
    await expect(restarted.getByText(/Snoozed until/)).toHaveCount(0);
    // Change the event while DND is active, forcing a new reminder identity that must be suppressed.
    await storeEvent(restarted, {
      ...event,
      start: new Date(Date.now() + 8 * 60_000).toISOString(),
    });
    await restarted.evaluate(() =>
      chrome.runtime.sendMessage({
        namespace: "calendar-checker",
        command: { type: "REFRESH_REMINDERS" },
      }),
    );
    await expect(
      restarted
        .locator(".reminder-inbox")
        .getByText("Do not disturb", { exact: true }),
    ).toBeVisible();
    expect(
      await second.worker.evaluate(
        () =>
          (
            globalThis as unknown as {
              notificationFixture: NotificationFixture;
            }
          ).notificationFixture.created,
      ),
    ).toHaveLength(0);
    const popup = await second.context.newPage();
    await popup.setViewportSize({ width: 800, height: 600 });
    await popup.goto(`chrome-extension://${second.id}/popup.html`);
    await popup.getByRole("button", { name: "Reminders", exact: true }).click();
    await expect(
      popup.getByRole("dialog", { name: "Reminders", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await popup.screenshot({ path: "test-results/reminder-inbox.png" });
    const manifest = JSON.parse(
      await readFile(join(extension, "manifest.json"), "utf8"),
    );
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["notifications", "offscreen"]),
    );
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("secondary-zone week labels, hover details and preference changes stay inside the popup", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-dual-zone-"));
  let active: BrowserContext | undefined;
  try {
    const session = await open(profile);
    active = session.context;
    const settings = await session.context.newPage();
    await settings.goto(`chrome-extension://${session.id}/options.html`);
    await settings.getByLabel("Primary time zone").fill("UTC");
    await settings.getByLabel("Secondary time zone").fill("Asia/Tokyo");
    await settings
      .locator("#appearance .settings-disclosure > summary")
      .click();
    await settings.getByLabel("Week view starts at").fill("0");
    await settings.getByLabel("Week view ends at").fill("24");
    await settings
      .getByRole("button", { name: "Save calendar preferences", exact: true })
      .click();
    const popup = await session.context.newPage();
    await popup.clock.setFixedTime(new Date("2026-11-02T11:00:00Z"));
    await popup.setViewportSize({ width: 800, height: 600 });
    await popup.goto(`chrome-extension://${session.id}/popup.html`);
    await popup.getByRole("button", { name: "Week", exact: true }).click();
    const row = popup.locator('.calendar-slot-header[data-time="11:00:00"]');
    await expect(row.locator(".calendar-secondary-hour")).toHaveText("20:00");
    await expect(row.locator(".calendar-secondary-hour")).toBeInViewport();
    await expect
      .poll(() =>
        popup.evaluate(
          () =>
            document.body.scrollWidth <= innerWidth &&
            document.body.scrollHeight <= innerHeight,
        ),
      )
      .toBe(true);
    await popup.screenshot({ path: "test-results/dual-timezone-week.png" });
    await settings
      .locator("#appearance .settings-disclosure > summary")
      .click();
    await settings.getByLabel("Week view layout").selectOption("fit");
    await settings
      .getByRole("button", { name: "Save calendar preferences", exact: true })
      .click();
    await expect(
      popup.locator(
        '.calendar-slot-header[data-time="23:00:00"] .calendar-secondary-hour',
      ),
    ).toHaveText("08:00 +1d");
    await expect
      .poll(() =>
        popup
          .getByTestId("calendar-grid")
          .evaluate((root) =>
            [...root.querySelectorAll<HTMLElement>("*")].some(
              (el) =>
                /auto|scroll/.test(getComputedStyle(el).overflowY) &&
                el.scrollHeight > el.clientHeight + 1,
            ),
          ),
      )
      .toBe(false);
    const store = emptyStore();
    store.settings.primaryTimeZone = "UTC";
    store.settings.secondaryTimeZone = "Asia/Tokyo";
    store.accounts = [
      {
        id: "fixture-account",
        email: "fixture@example.test",
        enabled: true,
        status: "offline",
        connectedAt: "2026-11-02T10:00:00Z",
        lastCheckedAt: null,
        lastSuccessfulAt: null,
        calendars: [
          {
            id: "fixture-calendar",
            summary: "Fixture calendar",
            accessRole: "owner",
            primary: true,
          },
        ],
      },
    ];
    await settings.evaluate(
      ({ key, store }) => chrome.storage.local.set({ [key]: store }),
      { key: STORAGE_KEY, store },
    );
    await storeEvent(settings, {
      key: '["fixture-account","fixture-calendar","timezone"]',
      source: "google",
      accountId: "fixture-account",
      calendarId: "fixture-calendar",
      eventId: "timezone",
      title: "Dual zone event",
      description: "",
      location: "",
      eventType: "default",
      color: "#348e81",
      calendarName: "Fixture calendar",
      accountName: "fixture@example.test",
      timeZone: "UTC",
      allDay: false,
      start: "2026-11-02T11:00:00Z",
      end: "2026-11-02T12:00:00Z",
      updatedAt: "2026-11-02T10:00:00Z",
    });
    await popup.reload();
    await popup.getByRole("button", { name: "Month", exact: true }).click();
    const event = popup
      .locator(".calendar-event")
      .filter({ hasText: "Dual zone event" });
    await event.hover();
    await expect(
      popup.getByRole("tooltip").filter({ hasText: "Dual zone event" }),
    ).toContainText("Asia/Tokyo");
    await event.click();
    await expect(
      popup.getByRole("dialog").filter({ hasText: "Dual zone event" }),
    ).toContainText("Asia/Tokyo");
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
