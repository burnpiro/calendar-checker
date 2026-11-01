import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { emptyStore, STORAGE_KEY, storeSchema } from "../../src/shared/model";

const extensionPath = resolve(".output/chrome-mv3");

async function launch(
  profile: string,
): Promise<{ context: BrowserContext; id: string }> {
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
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

test("setup, local settings and background alarms survive a browser restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "calendar-checker-test-"));
  let active: BrowserContext | undefined;
  try {
    const first = await launch(profile);
    active = first.context;
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
    await reopened.goto(`chrome-extension://${second.id}/popup.html`);
    await expect(
      reopened.getByRole("heading", { name: "Your accounts", exact: true }),
    ).toBeVisible();
    await expect(
      reopened.getByRole("button", { name: "Settings ↗", exact: true }),
    ).toBeVisible();
    await reopened.screenshot({ path: "test-results/popup.png" });
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
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.getByRole("alert")).toContainText(
      "1 account needs to be reconnected",
    );
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
    await expect(page.getByRole("alert")).toHaveCount(0);
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
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.screenshot({ path: "test-results/options.png", fullPage: true });
  } finally {
    await active?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
