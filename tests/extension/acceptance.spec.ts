import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { CalendarEvent } from "../../src/calendar/model";
import { emptyStore, STORAGE_KEY } from "../../src/shared/model";
import { makeFixtureMonth, FIXTURE_CALENDARS } from "../fixtures/calendar";

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), "calendar-stage6-"));
  const extension = resolve(".output/chrome-mv3");
  const context = await chromium.launchPersistentContext(profile, {
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(`chrome-extension://${id}/options.html`);
  const store = emptyStore();
  store.settings.primaryTimeZone = "UTC";
  store.settings.refreshOnOpen = false;
  store.accounts = ["fixture-work-account", "fixture-personal-account"].map(
    (id) => ({
      id,
      email: `${id}@example.test`,
      enabled: true,
      status: "reconnect" as const,
      connectedAt: new Date().toISOString(),
      lastCheckedAt: null,
      lastSuccessfulAt: null,
      calendars: FIXTURE_CALENDARS.filter((c) => c.accountId === id).map(
        (c) => ({
          id: c.id,
          summary: c.name,
          primary: true,
          accessRole: "owner",
          backgroundColor: c.color,
          timeZone: "UTC",
        }),
      ),
    }),
  );
  await page.evaluate(
    async ({ key, store }) => {
      await chrome.storage.local.set({ [key]: store });
    },
    { key: STORAGE_KEY, store },
  );
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  return { context, profile, id, page };
}
async function seedEvents(page: Page, rows: CalendarEvent[]) {
  await page.evaluate(async (rows) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("calendar-checker-events");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("events", "readwrite");
        for (const row of rows) tx.objectStore("events").put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, rows);
}
const axe = async (page: Page, label: string) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  if (results.violations.length)
    await writeFile(
      `test-results/a11y-${label.replaceAll(" ", "-")}.json`,
      JSON.stringify(results.violations, null, 2),
    );
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    nodes: v.nodes.map((n) => ({
      target: n.target,
      failure: n.failureSummary,
    })),
  }));
  expect.soft(summary, label).toEqual([]);
};

test("stage 6 accessibility and keyboard review covers settings and calendar dialogs in both themes", async () => {
  test.setTimeout(90_000);
  const session = await launch();
  const { page, context, profile, id } = session;
  try {
    await seedEvents(
      page,
      makeFixtureMonth(`${new Date().toISOString().slice(0, 7)}-01`, "UTC"),
    );
    for (const theme of ["light", "dark"]) {
      await page.goto(`chrome-extension://${id}/options.html`);
      await page
        .getByRole("combobox", { name: "Theme", exact: true })
        .selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await axe(page, `${theme} settings`);
      await page.locator("details").evaluateAll((items) =>
        items.forEach((item) => {
          (item as HTMLDetailsElement).open = true;
        }),
      );
      await axe(page, `${theme} expanded settings`);
      await page.goto(`chrome-extension://${id}/popup.html`);
      await expect(
        page.getByRole("button", { name: "Create event", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Month", exact: true }).click();
      await expect(
        page.locator(".calendar-event:visible").first(),
      ).toBeVisible();
      await axe(page, `${theme} month popup`);
      const event = page.locator(".calendar-event:visible").first();
      await event.click();
      await axe(page, `${theme} event details`);
      await page.keyboard.press("Escape");
      await expect(event).toBeFocused();
      await page.getByRole("button", { name: "Week", exact: true }).click();
      await expect(
        page.locator("[data-calendar-scroll]").first(),
      ).toBeAttached();
      const timeHeader = page.locator("[data-calendar-scroll]").first();
      await timeHeader.focus();
      const scrollPosition = async (reset = false) =>
        timeHeader.evaluate((el, reset) => {
          let parent = el.parentElement;
          while (
            parent &&
            !(
              /auto|scroll/.test(getComputedStyle(parent).overflowY) &&
              parent.scrollHeight > parent.clientHeight + 1
            )
          )
            parent = parent.parentElement;
          if (reset && parent) parent.scrollTop = 0;
          return parent?.scrollTop ?? -1;
        }, reset);
      await scrollPosition(true);
      await timeHeader.press("PageDown");
      await expect.poll(() => scrollPosition()).toBeGreaterThan(0);
      await expect(timeHeader).toBeFocused();
      await axe(page, `${theme} week popup`);
      const create = page.getByRole("button", {
        name: "Create event",
        exact: true,
      });
      await create.focus();
      await page.keyboard.press("Enter");
      const editor = page.getByRole("dialog", {
        name: "New event",
        exact: true,
      });
      await expect(editor.getByLabel("Title", { exact: true })).toBeFocused();
      await axe(page, `${theme} event editor`);
      await editor.getByRole("button", { name: /^Start time / }).click();
      await axe(page, `${theme} clock dialog`);
      await page.keyboard.press("Escape");
      await expect(
        editor.getByRole("button", { name: /^Start time / }),
      ).toBeFocused();
      await editor
        .getByRole("button", {
          name: "Event time zone UTC · default",
          exact: true,
        })
        .click();
      await axe(page, `${theme} time-zone list`);
      const search = page.getByRole("combobox", { name: "Search time zones" });
      await search.fill("tokyo");
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(
        editor.getByRole("button", {
          name: "Event time zone Asia/Tokyo",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      expect(
        await editor.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
      page.once("dialog", (d) => d.accept());
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(create).toBeFocused();
    }
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("stage 6 cached calendar performance stays bounded with a crowded offline month", async () => {
  const { page, context, profile, id } = await launch();
  try {
    const month = new Date().toISOString().slice(0, 7);
    const fixture = makeFixtureMonth(`${month}-01`, "UTC");
    const rows = Array.from({ length: 20 }, (_, batch) =>
      fixture.map((e) => ({
        ...e,
        key: JSON.stringify([
          e.accountId,
          e.calendarId,
          `${e.eventId}-${batch}`,
        ]),
        eventId: `${e.eventId}-${batch}`,
        title: `${e.title} ${batch}`,
      })),
    ).flat();
    await page.goto(`chrome-extension://${id}/calendar.html`);
    await seedEvents(page, rows);
    await page.setViewportSize({ width: 1360, height: 900 });
    const start = performance.now();
    await page.reload();
    await expect(page.locator(".calendar-event").first()).toBeVisible({
      timeout: 10_000,
    });
    const renderMs = performance.now() - start;
    const searchStart = performance.now();
    await page
      .getByRole("searchbox", { name: "Search events" })
      .fill("Weekly planning 19");
    await expect(page.locator(".calendar-event").first()).toContainText(
      "Weekly planning 19",
    );
    await expect(page.locator(".calendar-event")).toHaveCount(
      fixture.filter((e) => e.title === "Weekly planning").length,
    );
    const searchMs = performance.now() - searchStart;
    const report = {
      browser: context.browser()?.version(),
      eventCount: rows.length,
      renderMs: Math.round(renderMs),
      searchMs: Math.round(searchMs),
    };
    await writeFile(
      "test-results/stage-6-performance.json",
      JSON.stringify(report, null, 2),
    );
    expect(renderMs).toBeLessThan(10_000);
    expect(searchMs).toBeLessThan(5_000);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
