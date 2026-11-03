import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { Temporal } from "temporal-polyfill";
import {
  emptyStore,
  SCOPES,
  STORAGE_KEY,
  type Account,
} from "../../src/shared/model";
import { eventKey, type CalendarEvent } from "../../src/calendar/model";
import { calendarKey } from "../../src/shared/preferences";
import { emptySyncState } from "../../src/calendar/sync-model";

const at = "2026-11-10T09:15:00.000Z";
const accounts: Account[] = [
  {
    id: "showcase-work",
    email: "alex.work@example.com",
    enabled: true,
    status: "connected",
    eventsReadGranted: true,
    eventsWriteGranted: true,
    connectedAt: at,
    lastCheckedAt: at,
    lastSuccessfulAt: at,
    calendars: [
      {
        id: "studio",
        summary: "Studio",
        primary: true,
        accessRole: "owner",
        backgroundColor: "#7765d8",
        timeZone: "Europe/Warsaw",
        allowedConferenceSolutionTypes: ["hangoutsMeet"],
      },
      {
        id: "product",
        summary: "Product",
        primary: false,
        accessRole: "writer",
        backgroundColor: "#4285b4",
        timeZone: "Europe/Warsaw",
      },
      {
        id: "team",
        summary: "Team availability",
        primary: false,
        accessRole: "freeBusyReader",
        backgroundColor: "#a386bf",
        timeZone: "Europe/Warsaw",
      },
    ],
  },
  {
    id: "showcase-personal",
    email: "alex@example.com",
    enabled: true,
    status: "connected",
    eventsReadGranted: true,
    eventsWriteGranted: true,
    connectedAt: at,
    lastCheckedAt: at,
    lastSuccessfulAt: at,
    calendars: [
      {
        id: "personal",
        summary: "Personal",
        primary: true,
        accessRole: "owner",
        backgroundColor: "#348e81",
        timeZone: "Europe/Warsaw",
      },
      {
        id: "birthdays",
        summary: "Birthdays",
        primary: false,
        accessRole: "reader",
        backgroundColor: "#bd8d34",
        timeZone: "Europe/Warsaw",
      },
    ],
  },
];
function instant(date: string, hour: string) {
  return Temporal.PlainDateTime.from(`${date}T${hour}`)
    .toZonedDateTime("Europe/Warsaw")
    .toInstant()
    .toString();
}
const events: CalendarEvent[] = [];
function event(
  day: number,
  title: string,
  calendarId: string,
  start = "09:00",
  end = "10:00",
  allDay = false,
  days = 1,
) {
  const account = accounts.find((a) =>
    a.calendars.some((c) => c.id === calendarId),
  )!;
  const calendar = account.calendars.find((c) => c.id === calendarId)!;
  const date = `2026-11-${String(day).padStart(2, "0")}`;
  const id = `${calendarId}-${day}-${events.length}`;
  events.push({
    key: eventKey(account.id, calendar.id, id),
    source: "google",
    accountId: account.id,
    calendarId,
    eventId: id,
    title,
    description:
      "Illustrative event for Calendar Checker's public screenshots.",
    location: calendarId === "studio" ? "Studio meeting room" : "",
    eventType: calendarId === "birthdays" ? "birthday" : "default",
    color: calendar.backgroundColor!,
    calendarName: calendar.summary,
    accountName: account.email,
    timeZone: "Europe/Warsaw",
    allDay,
    start: allDay ? date : instant(date, start),
    end: allDay
      ? Temporal.PlainDate.from(date).add({ days }).toString()
      : instant(date, end),
    updatedAt: at,
    etag: '"showcase"',
    organizerSelf: true,
    attendees: [],
    reminders: { useDefault: true },
    ...(calendarId === "team"
      ? { availabilityOnly: true as const, title: "Busy" }
      : {}),
  } as CalendarEvent);
}
for (const day of [2, 9, 16, 23, 30]) {
  event(day, "Weekly planning", "studio");
  event(day, "Grocery run", "personal", "18:00", "18:30");
}
for (const day of [3, 10, 17, 24]) {
  event(day, "Design review", "product", "11:30", "12:30");
  event(day, "Build session", "studio", "14:00", "16:00");
}
for (const day of [4, 11, 18, 25]) {
  event(day, "Team check-in", "studio", "09:30", "10:00");
  event(day, "Coffee with Sam", "personal", "16:00", "17:00");
}
for (const day of [5, 12, 19, 26]) {
  event(day, "Project workshop", "product", "10:00", "11:30");
  event(day, "Evening run", "personal", "18:00", "19:00");
}
for (const day of [6, 13, 20, 27]) {
  event(day, "Friday wrap-up", "studio", "15:00", "16:00");
}
event(8, "Weekend in the hills", "personal", "00:00", "00:00", true);
event(10, "Lunch with Jamie", "personal", "13:00", "14:00");
event(10, "Busy", "team", "10:00", "11:00");
event(14, "Sam's birthday", "birthdays", "00:00", "00:00", true);
event(21, "Dinner with friends", "personal", "19:00", "21:00");
event(26, "Team offsite", "product", "00:00", "00:00", true, 2);

test("capture public screenshots using fictional accounts and local event fixtures", async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), "calendar-public-screens-"));
  let context: BrowserContext | undefined;
  try {
    const extension = join(root, "extension");
    await cp(resolve(".output/chrome-mv3"), extension, { recursive: true });
    const manifest = JSON.parse(
      await readFile(join(extension, "manifest.json"), "utf8"),
    );
    manifest.oauth2 = {
      client_id: "123456789-showcase.apps.googleusercontent.com",
      scopes: [...SCOPES],
    };
    await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext(join(root, "profile"), {
      channel: "chromium",
      headless: true,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    await context.route("https://**/*", (route) => route.abort());
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await worker.evaluate(
      ({ accounts, at, events }) => {
        globalThis.Date = new Proxy(Date, {
          construct(target, args) {
            return Reflect.construct(target, args.length ? args : [at]);
          },
          get(target, key) {
            return key === "now"
              ? () => target.parse(at)
              : Reflect.get(target, key);
          },
        });
        chrome.identity.getAuthToken = (async (
          details: chrome.identity.TokenDetails,
        ) => ({
          token: `showcase-${details.account?.id ?? "showcase-work"}`,
          grantedScopes: details.scopes,
        })) as typeof chrome.identity.getAuthToken;
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input));
          const headers = new Headers(init?.headers);
          const id = headers
            .get("Authorization")
            ?.replace("Bearer showcase-", "");
          const account = accounts.find((a) => a.id === id) ?? accounts[0]!;
          const response = (body: unknown) =>
            new Response(JSON.stringify(body), {
              headers: { "Content-Type": "application/json" },
            });
          if (url.hostname !== "www.googleapis.com")
            throw new TypeError("Showcase network is isolated");
          if (url.pathname.endsWith("/userinfo"))
            return response({
              sub: account.id,
              email: account.email,
              email_verified: true,
            });
          if (url.pathname.endsWith("/calendarList"))
            return response({ items: account.calendars });
          if (
            url.pathname.endsWith("/events") &&
            !url.searchParams.has("timeMin")
          )
            return response({ items: [], nextSyncToken: "showcase-cursor" });
          if (
            url.pathname.endsWith("/events") &&
            url.searchParams.has("timeMin")
          ) {
            const calendarId = decodeURIComponent(
              url.pathname.split("/calendars/")[1]!.split("/events")[0]!,
            );
            return response({
              timeZone: "Europe/Warsaw",
              items: events
                .filter((e) => e.calendarId === calendarId)
                .map((e) => ({
                  id: e.eventId,
                  summary: e.title,
                  description: e.description,
                  location: e.location,
                  eventType: e.eventType,
                  etag: e.etag,
                  updated: at,
                  organizer: { self: true },
                  attendees: [],
                  start: e.allDay
                    ? { date: e.start }
                    : { dateTime: e.start, timeZone: e.timeZone },
                  end: e.allDay
                    ? { date: e.end }
                    : { dateTime: e.end, timeZone: e.timeZone },
                })),
            });
          }
          if (url.pathname.endsWith("/freeBusy")) {
            const body = JSON.parse(String(init?.body));
            const calendarId = body.items[0].id;
            return response({
              calendars: {
                [calendarId]: {
                  busy: events
                    .filter((e) => e.calendarId === calendarId)
                    .map((e) => ({ start: e.start, end: e.end })),
                },
              },
            });
          }
          throw new TypeError("No network event writes in screenshots");
        };
      },
      { accounts, at, events },
    );
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(at));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`chrome-extension://${id}/options.html`);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    const store = emptyStore();
    store.accounts = accounts;
    Object.assign(store.settings, {
      theme: "light",
      primaryTimeZone: "Europe/Warsaw",
      secondaryTimeZone: "America/New_York",
      refreshOnOpen: false,
      syncIntervalMinutes: 1440,
      connectionCheckMinutes: 1440,
      weekStartHour: 8,
      weekEndHour: 20,
      weekHourHeight: 56,
      reminders: {
        ...store.settings.reminders,
        desktop: true,
        sound: true,
        offsets: [10, 30],
      },
      dnd: { ...store.settings.dnd, scheduleEnabled: true },
    });
    const states = accounts.flatMap((a) =>
      a.calendars.map((c) => ({
        ...emptySyncState(a.id, c.id),
        lastAttemptAt: at,
        lastCheckedAt: at,
        dataKind:
          c.accessRole === "freeBusyReader"
            ? ("freebusy" as const)
            : ("events" as const),
      })),
    );
    const ranges = accounts.flatMap((a) =>
      a.calendars.map((c) => ({
        key: `${calendarKey(a.id, c.id)}:home`,
        accountId: a.id,
        calendarId: c.id,
        kind: "home",
        start: "2026-10-01",
        end: "2027-01-01",
        fetchedAt: at,
        validatedAt: at,
        eventKeys: events
          .filter((e) => e.accountId === a.id && e.calendarId === c.id)
          .map((e) => e.key),
      })),
    );
    await page.evaluate(
      async ({ key, store, events, states, ranges }) => {
        await chrome.storage.local.set({ [key]: store });
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("calendar-checker-events");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(
              ["events", "syncStates", "ranges"],
              "readwrite",
            );
            for (const row of events) tx.objectStore("events").put(row);
            for (const row of states) tx.objectStore("syncStates").put(row);
            for (const row of ranges) tx.objectStore("ranges").put(row);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      },
      { key: STORAGE_KEY, store, events, states, ranges },
    );
    const capture = async (name: string) => {
      if (name !== "reminders" && name !== "editor")
        await expect(
          page.getByRole("button", { name: "Sync events", exact: true }),
        ).toBeEnabled();
      await page.mouse.move(1270, 790);
      await page.screenshot({
        path: `site/assets/screens/${name}.png`,
        animations: "disabled",
      });
      if (name !== "popup")
        await page.screenshot({
          path: `marketing/chrome-web-store/${name}.png`,
          animations: "disabled",
        });
    };
    await page.goto(`chrome-extension://${id}/calendar.html`);
    await expect(
      page
        .locator(".calendar-event:visible")
        .filter({ hasText: "Design review" })
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await capture("month");
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(
      page.locator(".calendar-secondary-hour").first(),
    ).toBeAttached();
    await capture("week");
    await page
      .getByRole("button", { name: "Create event", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: "New event", exact: true });
    await editor.getByLabel("Title", { exact: true }).fill("Project kickoff");
    await editor
      .getByLabel("Location", { exact: true })
      .fill("Studio meeting room");
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Goals, ideas and next steps for the new project.");
    await editor.getByLabel("Event color", { exact: true }).selectOption("3");
    await editor
      .getByLabel("Video conferencing", { exact: true })
      .selectOption("create");
    await editor.getByRole("button", { name: "Guests", exact: true }).click();
    await editor
      .getByRole("button", { name: "Add guest", exact: true })
      .click();
    await editor
      .getByLabel("Guest 1 email", { exact: true })
      .fill("jamie@example.com");
    await editor.getByLabel("Title", { exact: true }).scrollIntoViewIfNeeded();
    await capture("editor");
    page.once("dialog", (d) => d.accept());
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.goto(`chrome-extension://${id}/options.html#notifications`);
    await page.locator("#notifications").scrollIntoViewIfNeeded();
    await page.evaluate(() =>
      document
        .getElementById("notifications")!
        .scrollIntoView({ block: "start" }),
    );
    await capture("reminders");
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.goto(`chrome-extension://${id}/calendar.html`);
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(page.locator(".calendar-event:visible").first()).toBeVisible();
    await capture("dark");
    await page.goto(`chrome-extension://${id}/options.html`);
    await page
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("light");
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.locator(".calendar-event:visible").first()).toBeVisible();
    await page.screenshot({
      path: "site/assets/screens/popup.png",
      animations: "disabled",
    });
  } finally {
    await context?.close();
    await rm(root, { recursive: true, force: true });
  }
});
