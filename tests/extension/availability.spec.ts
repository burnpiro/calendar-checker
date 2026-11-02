import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { emptyStore, SCOPES, STORAGE_KEY } from "../../src/shared/model";

test("busy-only calendars sync through freeBusy, render read-only blocks and survive an offline restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-freebusy-"));
  const extension = join(root, "extension");
  const profile = join(root, "profile");
  let active: BrowserContext | undefined;
  const launch = async () => {
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [
        "--screen-info={1440x1000}",
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    active = context;
    return context;
  };
  try {
    await cp(resolve(".output/chrome-mv3"), extension, { recursive: true });
    const manifest = JSON.parse(
      await readFile(join(extension, "manifest.json"), "utf8"),
    );
    manifest.oauth2 = {
      client_id: "123456789-fixture.apps.googleusercontent.com",
      scopes: [...SCOPES],
    };
    await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
    const context = await launch();
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const id = new URL(worker.url()).host;
    const date = new Date().toISOString().slice(0, 10);
    await worker.evaluate(
      ({ date }) => {
        chrome.identity.getAuthToken = (async (
          details: chrome.identity.TokenDetails,
        ) => ({
          token: "availability-fixture-token",
          grantedScopes: details.scopes,
        })) as typeof chrome.identity.getAuthToken;
        const nativeFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input));
          if (url.hostname !== "www.googleapis.com")
            return nativeFetch(input, init);
          const respond = (data: unknown) =>
            new Response(JSON.stringify(data), {
              headers: { "Content-Type": "application/json" },
            });
          if (url.pathname === "/oauth2/v3/userinfo")
            return respond({
              sub: "availability-account",
              email: "availability@example.test",
              email_verified: true,
            });
          if (url.pathname.endsWith("/calendarList"))
            return respond({
              items: [
                {
                  id: "shared-calendar",
                  summary: "Shared availability",
                  accessRole: "freeBusyReader",
                  primary: false,
                  backgroundColor: "#348e81",
                },
              ],
            });
          if (url.pathname === "/calendar/v3/freeBusy") {
            if (init?.method !== "POST")
              throw new Error("Wrong availability method");
            const body = JSON.parse(String(init.body));
            if (
              body.items.length !== 1 ||
              body.items[0].id !== "shared-calendar" ||
              body.syncToken
            )
              throw new Error("Wrong availability request");
            const start = `${date}T09:00:00Z`,
              end = `${date}T10:00:00Z`;
            return respond({
              calendars: {
                "shared-calendar": {
                  busy:
                    Date.parse(body.timeMin) <= Date.parse(start) &&
                    Date.parse(body.timeMax) >= Date.parse(end)
                      ? [{ start, end }]
                      : [],
                },
              },
            });
          }
          throw new Error(
            "Busy-only calendars must not request event bodies or cursors",
          );
        };
      },
      { date },
    );
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    const store = emptyStore();
    store.settings.refreshOnOpen = false;
    store.settings.primaryTimeZone = "UTC";
    store.settings.cachePastMonths = 0;
    store.settings.cacheFutureMonths = 0;
    store.accounts = [
      {
        id: "availability-account",
        email: "availability@example.test",
        enabled: true,
        status: "connected",
        eventsReadGranted: true,
        connectedAt: new Date().toISOString(),
        lastCheckedAt: null,
        lastSuccessfulAt: null,
        calendars: [
          {
            id: "shared-calendar",
            summary: "Shared availability",
            accessRole: "freeBusyReader",
            primary: false,
            backgroundColor: "#348e81",
          },
        ],
      },
    ];
    await options.evaluate(
      ({ key, store }) => chrome.storage.local.set({ [key]: store }),
      { key: STORAGE_KEY, store },
    );
    await options
      .getByRole("button", { name: "Sync Google calendars", exact: true })
      .click();
    await expect(
      options.getByText(
        "Busy-only calendar · shows occupied times without event details.",
      ),
    ).toBeVisible();
    await expect(options.locator(".sync-calendar")).toContainText(
      "Last successful check",
    );
    const popup = await context.newPage();
    await popup.clock.setFixedTime(new Date(`${date}T08:45:00Z`));
    await popup.setViewportSize({ width: 800, height: 600 });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const block = popup.locator(".calendar-event").filter({ hasText: "Busy" });
    await expect(block).toHaveCount(1);
    await block.click();
    const dialog = popup.getByRole("dialog");
    await expect(dialog).toContainText("Only availability is shared");
    await expect(
      dialog.getByRole("button", { name: "Edit event", exact: true }),
    ).toHaveCount(0);
    await popup.screenshot({ path: "test-results/freebusy-details.png" });
    await popup.getByRole("button", { name: "Close event details" }).click();
    await popup.getByRole("button", { name: "Week", exact: true }).click();
    await expect(block).toHaveCount(1);
    await popup.screenshot({ path: "test-results/freebusy-week.png" });
    await context.close();
    const offline = await launch();
    await offline.setOffline(true);
    const restored = await offline.newPage();
    await restored.setViewportSize({ width: 800, height: 600 });
    await restored.goto(`chrome-extension://${id}/popup.html`);
    await expect(
      restored.locator(".calendar-event").filter({ hasText: "Busy" }),
    ).toHaveCount(1);
    await expect(restored.locator(".calendar-sync-notice")).toContainText(
      "Offline",
    );
  } finally {
    await active?.close();
    await rm(root, { recursive: true, force: true });
  }
});
