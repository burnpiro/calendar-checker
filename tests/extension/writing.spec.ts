import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Worker,
} from "@playwright/test";
import {
  emptyStore,
  SCOPES,
  STORAGE_KEY,
  type Account,
} from "../../src/shared/model";
import { calendarKey } from "../../src/shared/preferences";
import type { EventBody } from "../../src/calendar/write-model";
import type { GoogleEvent } from "../../src/calendar/google-events";

interface WriteFixture {
  offline: boolean;
  version: number;
  events: Record<string, GoogleEvent>;
  writes: Array<{
    method: string;
    calendar: string;
    id: string;
    ifMatch?: string;
    body?: EventBody;
    conferenceDataVersion?: string | null;
    sendUpdates?: string | null;
  }>;
}
const month = new Date().toISOString().slice(0, 7);
const day = `${month}-05`;
const accounts: Account[] = ["a", "b"].map((id) => ({
  id,
  email: `${id}@example.test`,
  enabled: true,
  status: "connected",
  eventsReadGranted: true,
  eventsWriteGranted: true,
  connectedAt: new Date().toISOString(),
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  calendars: [
    {
      id: `${id}-calendar`,
      summary: id === "a" ? "Work" : "Personal",
      accessRole: "owner",
      primary: true,
      timeZone: "UTC",
      backgroundColor: "#348e81",
    },
    ...(id === "a"
      ? [
          {
            id: "readonly",
            summary: "Read only",
            accessRole: "reader",
            primary: false,
            timeZone: "UTC",
          },
        ]
      : []),
  ],
}));
const original: GoogleEvent = {
  id: "original",
  summary: "Original meeting",
  description: "Original description",
  location: "Office",
  start: { dateTime: `${day}T09:00:00Z`, timeZone: "UTC" },
  end: { dateTime: `${day}T10:00:00Z`, timeZone: "UTC" },
  eventType: "default",
  etag: '"v1"',
  organizer: { self: true },
};
const initialFixture = (): WriteFixture => ({
  offline: false,
  version: 1,
  events: {
    original,
    master: {
      ...original,
      id: "master",
      summary: "Weekly series",
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=8"],
      start: { dateTime: `${month}-01T08:00:00Z`, timeZone: "UTC" },
      end: { dateTime: `${month}-01T09:00:00Z`, timeZone: "UTC" },
      etag: '"master-v1"',
    },
  },
  writes: [],
});
async function installFixture(worker: Worker, fixture = initialFixture()) {
  await worker.evaluate(
    ({ fixture, accounts }) => {
      (globalThis as unknown as { writeFixture: WriteFixture }).writeFixture =
        fixture;
      chrome.identity.getAuthToken = (async (
        details: chrome.identity.TokenDetails,
      ) => ({
        token: `fixture-${details.account?.id ?? "a"}`,
        grantedScopes: details.scopes,
      })) as typeof chrome.identity.getAuthToken;
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.hostname !== "www.googleapis.com")
          return nativeFetch(input, init);
        if (fixture.offline) throw new TypeError("Fixture offline");
        const headers = init?.headers as Record<string, string>;
        const accountId = (headers.Authorization ?? "").replace(
          "Bearer fixture-",
          "",
        );
        const account = accounts.find((a) => a.id === accountId)!;
        const respond = (data: unknown, status = 200) =>
          new Response(JSON.stringify(data), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        if (url.pathname === "/oauth2/v3/userinfo")
          return respond({
            sub: account.id,
            email: account.email,
            email_verified: true,
          });
        if (url.pathname.endsWith("/calendarList"))
          return respond({ items: account.calendars });
        const match = url.pathname.match(
          /\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/,
        );
        if (!match) throw new Error("Unexpected fixture URL");
        const calendar = decodeURIComponent(match[1]!);
        const id = match[2] ? decodeURIComponent(match[2]) : "";
        const method = init?.method ?? "GET";
        const resolveEvent = (id: string): GoogleEvent | undefined => {
          if (fixture.events[id]) return fixture.events[id];
          const master = fixture.events[id.replace(/_instance$/, "")];
          if (!id.endsWith("_instance") || !master?.recurrence?.length)
            return undefined;
          return {
            ...master,
            id,
            recurringEventId: master.id,
            recurrence: undefined,
            start: {
              dateTime: master.start?.dateTime?.replace(/-01T/, "-05T"),
              timeZone: "UTC",
            },
            end: {
              dateTime: master.end?.dateTime?.replace(/-01T/, "-05T"),
              timeZone: "UTC",
            },
          };
        };
        if (method === "GET" && !id) {
          if (!url.searchParams.has("timeMin"))
            return respond({
              items: [{ id: "change" }],
              nextSyncToken: `cursor-${fixture.version}`,
            });
          const events =
            calendar === "a-calendar"
              ? Object.values(fixture.events)
              : Object.values(fixture.events).filter(
                  (event) =>
                    event.extendedProperties?.private?.fixtureCalendar ===
                    calendar,
                );
          return respond({
            timeZone: "UTC",
            items: events
              .filter(
                (event) =>
                  !event.recurringEventId &&
                  (!event.extendedProperties?.private?.fixtureCalendar ||
                    event.extendedProperties.private.fixtureCalendar ===
                      calendar),
              )
              .map((event) =>
                event.recurrence?.length
                  ? resolveEvent(`${event.id}_instance`)
                  : event,
              )
              .filter((event) => event?.status !== "cancelled"),
          });
        }
        if (method === "GET")
          return resolveEvent(id)
            ? respond(resolveEvent(id))
            : respond({}, 404);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const target = id || body.id;
        fixture.writes.push({
          method,
          calendar,
          id: target,
          ifMatch: headers["If-Match"],
          body,
          conferenceDataVersion: url.searchParams.get("conferenceDataVersion"),
          sendUpdates: url.searchParams.get("sendUpdates"),
        });
        if (method === "POST" && fixture.events[target])
          return respond({}, 409);
        if (
          method !== "POST" &&
          resolveEvent(target)?.etag !== headers["If-Match"]
        )
          return respond({}, 412);
        if (method === "DELETE") {
          fixture.events[target] = {
            ...resolveEvent(target)!,
            status: "cancelled",
          };
          fixture.version++;
          return new Response(null, { status: 204 });
        }
        const value = {
          ...resolveEvent(target),
          ...body,
          id: target,
          htmlLink: `https://calendar.google.com/calendar/event?eid=${target}`,
          eventType: "default",
          organizer: { self: true },
          etag: `"written-${++fixture.version}"`,
        };
        if (value.conferenceData?.createRequest) {
          value.conferenceData = {
            conferenceSolution: { key: { type: "hangoutsMeet" } },
            createRequest: {
              ...value.conferenceData.createRequest,
              status: { statusCode: "success" },
            },
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/fixture-meet",
              },
            ],
          };
        }
        for (const point of [value.start, value.end])
          if (point)
            for (const key of Object.keys(point))
              if (point[key] === null) delete point[key];
        value.extendedProperties ??= { private: {} };
        value.extendedProperties.private.fixtureCalendar = calendar;
        fixture.events[target] = value;
        return respond(value);
      };
    },
    { fixture, accounts },
  );
}
async function open(profile: string, extension: string) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      "--screen-info={1440x1000}",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  await installFixture(worker);
  return { context, worker, id };
}
async function copyExtension(root: string) {
  const extension = join(root, "extension");
  await cp(resolve(".output/chrome-mv3"), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  manifest.oauth2 = {
    client_id: "123456789-fixture.apps.googleusercontent.com",
    scopes: [...SCOPES],
  };
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  return extension;
}
async function seed(worker: Worker) {
  await worker.evaluate(
    async ({ accounts, store, key }) => {
      store.accounts = accounts;
      store.settings.primaryTimeZone = "UTC";
      store.settings.webOAuthClientId = "";
      await chrome.storage.local.set({ [key]: store });
    },
    { accounts, store: emptyStore(), key: STORAGE_KEY },
  );
}

test("offline all-day creation selects a writable account and survives a browser restart before sending", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-write-offline-"));
  let active: BrowserContext | undefined;
  try {
    const extension = await copyExtension(root);
    const profile = join(root, "profile");
    const first = await open(profile, extension);
    active = first.context;
    await seed(first.worker);
    const page = await first.context.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${first.id}/popup.html`);
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Original meeting" }),
    ).toBeVisible();
    await first.worker.evaluate(() => {
      (
        globalThis as unknown as { writeFixture: WriteFixture }
      ).writeFixture.offline = true;
    });
    await first.context.setOffline(true);
    await page.getByRole("button", { name: "Create event" }).click();
    const editor = page.getByRole("dialog", { name: "New event" });
    await expect(
      editor.getByLabel("Account and calendar").locator("option"),
    ).toHaveCount(2);
    await editor
      .getByLabel("Account and calendar")
      .selectOption(calendarKey("b", "b-calendar"));
    await editor
      .getByLabel("Title", { exact: true })
      .fill("Offline personal day");
    await editor.getByLabel("All day", { exact: true }).check();
    await editor.getByLabel("Starts", { exact: true }).fill(day);
    await editor.getByLabel("Last day (inclusive)").fill(day);
    await expect(
      editor.getByRole("button", { name: "Save event" }),
    ).toBeInViewport({ ratio: 1 });
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Saved while offline");
    await expect(
      editor.getByRole("button", { name: "Save event" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      editor.getByRole("heading", { name: "New event" }),
    ).toBeInViewport({ ratio: 1 });
    await editor.getByLabel("Title", { exact: true }).scrollIntoViewIfNeeded();
    await expect(
      editor.getByRole("heading", { name: "New event" }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: "test-results/event-editor-offline.png" });
    await editor.getByRole("button", { name: "Save event" }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      page
        .locator(".calendar-event")
        .filter({ hasText: "Offline personal day" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pending changes (1)" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pending changes (1)" }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("b@example.test · Personal", { exact: true }),
    ).toBeVisible();
    await active.close();
    active = undefined;
    const second = await open(profile, extension);
    active = second.context;
    await second.worker.evaluate(() => {
      (
        globalThis as unknown as { writeFixture: WriteFixture }
      ).writeFixture.offline = true;
    });
    await second.context.setOffline(true);
    const settings = await second.context.newPage();
    await settings.goto(`chrome-extension://${second.id}/options.html`);
    await expect(
      settings.getByText("Offline personal day", { exact: true }),
    ).toBeVisible();
    await settings.locator(".account-more > summary").last().click();
    settings.once("dialog", (dialog) => dialog.accept());
    await settings
      .getByRole("button", { name: "Remove", exact: true })
      .last()
      .click();
    await expect(
      settings.getByText(
        "Resolve or discard pending event changes for this account or event first. Saved changes have been kept.",
        { exact: true },
      ),
    ).toBeVisible();
    await second.context.setOffline(false);
    await second.worker.evaluate(() => {
      (
        globalThis as unknown as { writeFixture: WriteFixture }
      ).writeFixture.offline = false;
    });
    await settings
      .getByRole("button", { name: "Retry now", exact: true })
      .click();
    await expect(
      settings.getByText("No pending event changes.", { exact: true }),
    ).toBeVisible();
    const result = await second.worker.evaluate(
      () =>
        (globalThis as unknown as { writeFixture: WriteFixture }).writeFixture,
    );
    expect(result.writes.filter((w) => w.method === "POST")).toEqual([
      expect.objectContaining({ calendar: "b-calendar" }),
    ]);
    const event = Object.values(result.events).find(
      (e) => e.summary === "Offline personal day",
    )!;
    expect(event.start).toEqual({ date: day });
    expect(event.end?.date).not.toBe(day);
    expect(event.end?.date).toBe(`${month}-06`);
  } finally {
    await active?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("editing resolves Google conflicts explicitly and targets the series master or one occurrence", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-write-conflict-"));
  let active: BrowserContext | undefined;
  try {
    const extension = await copyExtension(root);
    const session = await open(join(root, "profile"), extension);
    active = session.context;
    await seed(session.worker);
    const page = await session.context.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${session.id}/popup.html`);
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Original meeting" })
      .click();
    await page.getByRole("button", { name: "Edit event", exact: true }).click();
    const editor = page.getByRole("dialog", {
      name: "Edit event",
      exact: true,
    });
    await expect(editor.getByLabel("Account and calendar")).toBeDisabled();
    await editor.getByLabel("Title", { exact: true }).fill("My meeting title");
    await session.worker.evaluate(() => {
      const fixture = (globalThis as unknown as { writeFixture: WriteFixture })
        .writeFixture;
      fixture.events.original = {
        ...fixture.events.original!,
        summary: "Google meeting title",
        location: "Remote room",
        etag: '"google-v2"',
      };
      fixture.version++;
    });
    await editor.getByRole("button", { name: "Save event" }).click();
    await page.getByRole("button", { name: "Pending changes (1)" }).click();
    const pending = page.getByRole("dialog", { name: "Pending event changes" });
    await expect(
      pending.getByText("Google meeting title", { exact: true }),
    ).toBeVisible();
    await pending.screenshot({ path: "test-results/event-conflict.png" });
    page.once("dialog", (dialog) => dialog.accept());
    await pending.getByRole("button", { name: "Apply my changes" }).click();
    await expect(
      pending.getByText("No pending event changes.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close pending changes" }).click();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "My meeting title" }),
    ).toBeVisible();
    expect(
      await session.worker.evaluate(
        () =>
          (globalThis as unknown as { writeFixture: WriteFixture }).writeFixture
            .events.original?.location,
      ),
    ).toBe("Remote room");
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Weekly series" })
      .click();
    await page
      .getByRole("button", { name: "Edit series", exact: true })
      .click();
    const seriesEditor = page.getByRole("dialog", {
      name: "Edit recurring series",
    });
    await expect(
      seriesEditor.getByLabel("Starts", { exact: true }),
    ).toHaveValue(`${month}-01`);
    await expect(
      seriesEditor.getByRole("button", { name: "Start time", exact: true }),
    ).toHaveText("08:00");
    await seriesEditor
      .getByLabel("Title", { exact: true })
      .fill("Edited whole series");
    await seriesEditor.getByRole("button", { name: "Save event" }).click();
    await expect(
      page.getByRole("button", { name: "Pending changes", exact: true }),
    ).toBeVisible();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Edited whole series" })
      .click();
    await page
      .getByRole("button", { name: "Edit occurrence", exact: true })
      .click();
    const occurrence = page.getByRole("dialog", {
      name: "Edit event",
      exact: true,
    });
    await expect(occurrence.getByLabel("Starts", { exact: true })).toHaveValue(
      `${month}-05`,
    );
    await expect(
      occurrence.getByRole("button", { name: "Start time", exact: true }),
    ).toHaveText("08:00");
    await occurrence
      .getByLabel("Title", { exact: true })
      .fill("Edited occurrence");
    await occurrence.getByRole("button", { name: "Save event" }).click();
    await expect
      .poll(() =>
        session.worker.evaluate(() =>
          (
            globalThis as unknown as { writeFixture: WriteFixture }
          ).writeFixture.writes
            .filter((w) => w.method === "PATCH")
            .map((w) => w.id),
        ),
      )
      .toEqual(["original", "master", "master_instance"]);
    await expect(
      page.getByRole("button", { name: "Pending changes", exact: true }),
    ).toBeVisible();
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Edited occurrence" })
      .click();
    await page
      .getByRole("button", { name: "Edit occurrence", exact: true })
      .click();
    const deleting = page.getByRole("dialog", {
      name: "Edit event",
      exact: true,
    });
    await deleting.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      deleting.getByRole("button", { name: "Confirm delete", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      deleting.getByRole("button", { name: "Confirm delete", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: "test-results/delete-confirmation-visible.png",
    });
    await deleting
      .getByRole("button", { name: "Confirm delete", exact: true })
      .click();
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Edited occurrence" }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        session.worker.evaluate(() =>
          (
            globalThis as unknown as { writeFixture: WriteFixture }
          ).writeFixture.writes
            .filter((w) => w.method === "DELETE")
            .map((w) => w.id),
        ),
      )
      .toEqual(["master_instance"]);
  } finally {
    await active?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("new events default to one hour with a clock picker and an unfiltered searchable zone list", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-editor-controls-"));
  let active: BrowserContext | undefined;
  try {
    const extension = await copyExtension(root);
    const session = await open(join(root, "profile"), extension);
    active = session.context;
    await seed(session.worker);
    const page = await session.context.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${session.id}/popup.html`);
    await page
      .locator(`.calendar-day-cell[data-date="${month}-10"]`)
      .click({ position: { x: 25, y: 45 } });
    const editor = page.getByRole("dialog", { name: "New event", exact: true });
    await expect(
      editor.getByLabel("All day", { exact: true }),
    ).not.toBeChecked();
    await expect(editor.getByLabel("Starts", { exact: true })).toHaveValue(
      `${month}-10`,
    );
    await expect(
      editor.getByRole("button", { name: "Start time", exact: true }),
    ).toHaveText("09:00");
    await expect(
      editor.getByRole("button", { name: "End time", exact: true }),
    ).toHaveText("10:00");
    await editor
      .getByRole("button", { name: "Start time", exact: true })
      .click();
    const clock = page.getByRole("dialog", { name: "Start time", exact: true });
    await clock.getByRole("button", { name: "14 hours", exact: true }).click();
    await clock
      .getByRole("button", { name: "30 minutes", exact: true })
      .click();
    await expect(
      clock.getByRole("button", { name: "Set time", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: "test-results/event-clock-picker.png" });
    await clock.getByRole("button", { name: "Set time", exact: true }).click();
    await expect(clock).toHaveCount(0);
    await expect(editor).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Start time", exact: true }),
    ).toHaveText("14:30");
    await expect(
      editor.getByRole("button", { name: "End time", exact: true }),
    ).toHaveText("15:30");
    // Exact minutes stay available without a native scrolling time control.
    await editor.getByRole("button", { name: "End time", exact: true }).click();
    const endClock = page.getByRole("dialog", {
      name: "End time",
      exact: true,
    });
    await endClock
      .getByRole("spinbutton", { name: "Minute", exact: true })
      .fill("47");
    await endClock
      .getByRole("button", { name: "Set time", exact: true })
      .click();
    await expect(
      editor.getByRole("button", { name: "End time", exact: true }),
    ).toHaveText("15:47");
    await expect(
      editor.getByRole("button", {
        name: "Event time zone UTC · default",
        exact: true,
      }),
    ).toBeVisible();
    await editor
      .getByRole("button", {
        name: "Event time zone UTC · default",
        exact: true,
      })
      .click();
    const search = editor.getByRole("combobox", { name: "Search time zones" });
    await expect(search).toHaveValue("");
    const options = editor.getByRole("option");
    expect(await options.count()).toBeGreaterThan(400);
    await search.fill("new york");
    await expect(
      editor.getByRole("option", { name: "America/New York", exact: true }),
    ).toBeVisible();
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(
      editor.getByRole("button", {
        name: "Event time zone America/New York",
        exact: true,
      }),
    ).toBeFocused();
    await editor
      .getByRole("button", {
        name: "Event time zone America/New York",
        exact: true,
      })
      .click();
    await expect(search).toHaveValue("");
    expect(await options.count()).toBeGreaterThan(400);
    await page.screenshot({ path: "test-results/event-timezone-search.png" });
    await search.fill("not-a-real-timezone");
    await expect(editor.getByText("No matching time zones.")).toBeVisible();
    await search.press("Escape");
    await expect(editor).toBeVisible();
    await editor
      .getByRole("button", {
        name: "Event time zone America/New York",
        exact: true,
      })
      .click();
    await search.fill("UTC");
    await editor
      .getByRole("option", { name: "UTC · default", exact: true })
      .click();
    await editor
      .getByLabel("Title", { exact: true })
      .fill("Clock-created event");
    await editor
      .getByRole("button", { name: "Save event", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pending changes", exact: true }),
    ).toBeVisible();
    const event = await session.worker.evaluate(() =>
      Object.values(
        (globalThis as unknown as { writeFixture: WriteFixture }).writeFixture
          .events,
      ).find((event) => event.summary === "Clock-created event"),
    );
    expect(event?.start?.dateTime).toBe(`${month}-10T14:30:00Z`);
    expect(event?.end?.dateTime).toBe(`${month}-10T15:47:00Z`);
    expect(event?.start?.timeZone).toBe("UTC");
    // Toolbar creation also starts timed, in the saved default zone.
    await page.getByRole("button", { name: "Create event" }).click();
    await expect(
      editor.getByLabel("All day", { exact: true }),
    ).not.toBeChecked();
    await expect(
      editor.getByRole("button", {
        name: "Event time zone UTC · default",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await active?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("complete event options persist offline, sync to Google and open the saved event", async () => {
  const root = await mkdtemp(join(tmpdir(), "calendar-complete-editor-"));
  let active: BrowserContext | undefined;
  try {
    const extension = await copyExtension(root);
    const session = await open(join(root, "profile"), extension);
    active = session.context;
    await seed(session.worker);
    await active.route("https://calendar.google.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Fixture Google event</title>",
      }),
    );
    const page = await active.newPage();
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${session.id}/popup.html`);
    await expect(
      page.locator(".calendar-event").filter({ hasText: "Original meeting" }),
    ).toBeVisible();
    await session.worker.evaluate(() => {
      (
        globalThis as unknown as { writeFixture: WriteFixture }
      ).writeFixture.offline = true;
    });
    await active.setOffline(true);
    await page
      .getByRole("button", { name: "Create event", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: "New event", exact: true });
    await editor
      .getByLabel("Title", { exact: true })
      .fill("Complete offline event");
    await editor
      .getByLabel("Account and calendar")
      .selectOption(calendarKey("b", "b-calendar"));
    await editor.getByLabel("Starts", { exact: true }).fill(day);
    await editor.getByLabel("Location", { exact: true }).fill("Meeting room");
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Notes kept offline");
    await editor.getByLabel("Repeats", { exact: true }).selectOption("WEEKLY");
    await editor.getByLabel("Repeat every", { exact: true }).fill("2");
    await editor.getByLabel("Mon", { exact: true }).check();
    await editor.getByLabel("Wed", { exact: true }).check();
    await editor.getByLabel("Number of occurrences", { exact: true }).fill("4");
    await editor.getByLabel("Event color", { exact: true }).selectOption("11");
    await editor
      .getByLabel("Show as", { exact: true })
      .selectOption("transparent");
    await editor
      .getByLabel("Visibility", { exact: true })
      .selectOption("private");
    await editor
      .getByLabel("Video conferencing", { exact: true })
      .selectOption("create");
    await editor
      .getByLabel("Use calendar default notifications", { exact: true })
      .uncheck();
    await editor
      .getByRole("button", { name: "Add notification", exact: true })
      .click();
    await editor
      .getByLabel("Notification 1", { exact: true })
      .selectOption("email");
    await editor.getByLabel("Minutes before", { exact: true }).fill("30");
    await editor.getByRole("button", { name: "Guests", exact: true }).click();
    await editor
      .getByRole("button", { name: "Add guest", exact: true })
      .click();
    await editor
      .getByLabel("Guest 1 email", { exact: true })
      .fill("guest@example.test");
    await editor.getByLabel("Optional", { exact: true }).check();
    await editor
      .getByLabel("Guests can invite others", { exact: true })
      .uncheck();
    await editor
      .getByLabel("Guests can see guest list", { exact: true })
      .uncheck();
    await expect(
      editor.getByRole("button", { name: "Save event", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: "test-results/event-editor-complete-options.png",
    });
    await editor
      .getByLabel("Event color", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/event-editor-colors-notifications.png",
    });
    await editor.getByLabel("Title", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/event-editor-complete-dates.png",
    });
    await editor
      .getByRole("button", { name: "Save & open in Google", exact: true })
      .click();
    await expect(editor).toHaveCount(0);
    const settings = await active.newPage();
    await settings.goto(`chrome-extension://${session.id}/options.html`);
    await expect(
      settings.getByText("Complete offline event", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await session.worker.evaluate(
          () =>
            (globalThis as unknown as { writeFixture: WriteFixture })
              .writeFixture.writes,
        )
      ).length,
    ).toBe(0);
    await active.setOffline(false);
    await session.worker.evaluate(() => {
      (
        globalThis as unknown as { writeFixture: WriteFixture }
      ).writeFixture.offline = false;
    });
    const opened = active.waitForEvent("page");
    await settings
      .getByRole("button", { name: "Retry now", exact: true })
      .click();
    const googlePage = await opened;
    await expect(googlePage).toHaveURL(
      /^https:\/\/calendar.google.com\/calendar\/event\?eid=/,
    );
    await expect(
      settings.getByText("No pending event changes.", { exact: true }),
    ).toBeVisible();
    const fixture = await session.worker.evaluate(
      () =>
        (globalThis as unknown as { writeFixture: WriteFixture }).writeFixture,
    );
    const write = fixture.writes.find((w) => w.method === "POST")!;
    expect(write).toMatchObject({
      calendar: "b-calendar",
      conferenceDataVersion: "1",
      sendUpdates: "all",
      body: {
        summary: "Complete offline event",
        colorId: "11",
        transparency: "transparent",
        visibility: "private",
        location: "Meeting room",
        description: "Notes kept offline",
        attendees: [{ email: "guest@example.test", optional: true }],
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
        reminders: {
          useDefault: false,
          overrides: [{ method: "email", minutes: 30 }],
        },
        recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4"],
        conferenceData: {
          createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      },
    });
    const event = fixture.events[write.id]!;
    expect(event.conferenceData?.entryPoints?.[0]?.uri).toBe(
      "https://meet.google.com/fixture-meet",
    );
    await settings.reload();
    await page.reload();
    await page
      .getByRole("searchbox", { name: "Search events" })
      .fill("Complete offline event");
    await page
      .locator(".calendar-event")
      .filter({ hasText: "Complete offline event" })
      .click();
    const details = page.getByRole("dialog", {
      name: "Complete offline event",
      exact: true,
    });
    await expect(
      details.getByRole("link", { name: "Join meeting ↗" }),
    ).toHaveAttribute("href", "https://meet.google.com/fixture-meet");
    await details
      .getByRole("button", { name: "Edit series", exact: true })
      .click();
    const edit = page.getByRole("dialog", {
      name: "Edit recurring series",
      exact: true,
    });
    await expect(edit.getByLabel("Event color", { exact: true })).toHaveValue(
      "11",
    );
    await expect(edit.getByLabel("Show as", { exact: true })).toHaveValue(
      "transparent",
    );
    await expect(edit.getByLabel("Visibility", { exact: true })).toHaveValue(
      "private",
    );
    await expect(
      edit.getByLabel("Use calendar default notifications", { exact: true }),
    ).not.toBeChecked();
    await edit.getByRole("button", { name: "Guests", exact: true }).click();
    await expect(edit.getByLabel("Guest 1 email", { exact: true })).toHaveValue(
      "guest@example.test",
    );
    await expect(edit.getByLabel("Optional", { exact: true })).toBeChecked();
    await edit
      .getByLabel("Title", { exact: true })
      .fill("Retitled advanced event");
    await edit.getByRole("button", { name: "Save event", exact: true }).click();
    await expect
      .poll(async () =>
        session.worker.evaluate(
          () =>
            (
              globalThis as unknown as { writeFixture: WriteFixture }
            ).writeFixture.writes.filter((w) => w.method === "PATCH").length,
        ),
      )
      .toBe(1);
    const patch = await session.worker.evaluate(() =>
      (
        globalThis as unknown as { writeFixture: WriteFixture }
      ).writeFixture.writes.find((w) => w.method === "PATCH")!,
    );
    expect(Object.keys(patch.body!).sort()).toEqual([
      "extendedProperties",
      "summary",
    ]);
    await page
      .getByRole("button", { name: "Create event", exact: true })
      .click();
    const fresh = page.getByRole("dialog", { name: "New event", exact: true });
    await expect(fresh.getByLabel("Event color", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      fresh.getByLabel("Use calendar default notifications", { exact: true }),
    ).toBeChecked();
  } finally {
    await active?.close();
    await rm(root, { recursive: true, force: true });
  }
});
