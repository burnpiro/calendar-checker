import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { STORAGE_KEY, type Store } from "../../src/shared/model";
import { makeFixtureMonth } from "../fixtures/calendar";

test("description privacy autosaves, removes offline copies and survives a browser restart", async () => {
  const profile = await mkdtemp(
    join(tmpdir(), "calendar-description-privacy-"),
  );
  let context: BrowserContext | undefined;
  const launch = async () => {
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
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${new URL(worker.url()).host}/options.html`,
    );
    return page;
  };
  try {
    let page = await launch();
    const event = {
      ...makeFixtureMonth("2026-11-01", "UTC")[0]!,
      description: "Private offline fixture notes",
    };
    await page.evaluate(
      async ({ storage, event }) => {
        const reply = await chrome.runtime.sendMessage({
          namespace: "calendar-checker",
          command: {
            type: "UPDATE_SETTINGS",
            settings: { excludeEventDescriptions: false },
          },
        });
        if (!reply.ok) throw new Error("Fixture initialization failed");
        const state = (await chrome.storage.local.get(storage))[
          storage
        ] as Store;
        state.accounts = [
          {
            id: event.accountId,
            email: "privacy@example.test",
            enabled: false,
            status: "connected",
            connectedAt: "2026-11-01T00:00:00Z",
            lastCheckedAt: null,
            lastSuccessfulAt: null,
            calendars: [
              {
                id: event.calendarId,
                summary: "Private fixture calendar",
                primary: true,
                accessRole: "owner",
              },
            ],
          },
        ];
        await chrome.storage.local.set({ [storage]: state });
        const open = indexedDB.open("calendar-checker-events");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(["events", "editBases"], "readwrite");
            tx.objectStore("events").put(event);
            tx.objectStore("editBases").put({ key: "fixture-master", event });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      },
      { storage: STORAGE_KEY, event },
    );
    const read = () =>
      page.evaluate(async (storage) => {
        const state = (await chrome.storage.local.get(storage))[
          storage
        ] as Store;
        const open = indexedDB.open("calendar-checker-events");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        try {
          const tx = db.transaction(["events", "editBases"], "readonly");
          const get = (table: string) =>
            new Promise<unknown[]>((resolve, reject) => {
              const req = tx.objectStore(table).getAll();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
          return {
            settings: state.settings,
            events: await get("events"),
            bases: await get("editBases"),
          };
        } finally {
          db.close();
        }
      }, STORAGE_KEY);
    await page
      .getByRole("link", { name: "Sync & offline storage", exact: true })
      .click();
    const toggle = () =>
      page.getByLabel("Exclude event descriptions", { exact: true });
    await toggle().check();
    await expect
      .poll(async () => (await read()).settings.excludeEventDescriptions)
      .toBe(true);
    await expect
      .poll(async () => JSON.stringify((await read()).events))
      .not.toContain(event.description);
    const redacted = await read();
    expect(redacted.events).toMatchObject([
      {
        key: event.key,
        title: event.title,
        description: "",
        descriptionOmitted: true,
      },
    ]);
    expect(JSON.stringify(redacted.bases)).not.toContain(event.description);
    await page.getByLabel("Cache past months").fill("0");
    await page.getByLabel("Cache future months").fill("0");
    await expect
      .poll(async () => (await read()).settings.cacheFutureMonths)
      .toBe(0);
    await expect(
      page.getByText(/does not disable offline storage/),
    ).toBeVisible();
    expect((await read()).events).toHaveLength(1);
    await page.screenshot({ path: "test-results/description-privacy.png" });
    await context!.close();
    context = undefined;
    page = await launch();
    await expect(toggle()).toBeChecked();
    expect((await read()).events).toMatchObject([
      { description: "", descriptionOmitted: true },
    ]);
    expect((await read()).bases).toHaveLength(1);
    await toggle().uncheck();
    await expect
      .poll(async () => (await read()).settings.excludeEventDescriptions)
      .toBe(false);
    expect((await read()).events).toHaveLength(1);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
