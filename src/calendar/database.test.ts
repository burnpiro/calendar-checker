import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { CalendarDatabase, LocalCalendarRepository } from "./database";
import { makeDemoMonth } from "./demo";
import { eventSchema } from "./model";
import { Dexie } from "dexie";

const databases: CalendarDatabase[] = [];
function database(name = `calendar-test-${crypto.randomUUID()}`) {
  const db = new CalendarDatabase(name);
  databases.push(db);
  return db;
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

describe("local event storage", () => {
  it("upgrades the stage 2 database without clearing samples or reserved Google rows", async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      events: "&key, [accountId+calendarId], start, end, eventType",
      demoEvents: "&key, [accountId+calendarId], start, end, eventType",
      meta: "&key",
    });
    const event = makeDemoMonth("2026-11-01", "UTC")[0]!;
    await old.table("demoEvents").put(event);
    await old.table("events").put({ ...event, source: "google" });
    old.close();
    const upgraded = database(name);
    expect(await upgraded.demoEvents.count()).toBe(1);
    expect(await upgraded.events.count()).toBe(1);
    expect(await upgraded.ranges.count()).toBe(0);
    expect(await upgraded.syncStates.count()).toBe(0);
  });
  it("keeps demo generation separate from Google records and de-duplicates repeated preparation", async () => {
    const db = database();
    const repository = new LocalCalendarRepository(db);
    const google = {
      ...makeDemoMonth("2026-11-01", "Europe/Warsaw")[0]!,
      key: "google-key",
      source: "google" as const,
      accountId: "real-account",
      calendarId: "real-calendar",
    };
    await db.events.put(google);
    await Promise.all([
      repository.prepareDemo("2026-11-01", "Europe/Warsaw"),
      repository.prepareDemo("2026-11-01", "Europe/Warsaw"),
    ]);
    const before = await db.demoEvents.count();
    await repository.prepareDemo("2026-11-01", "America/New_York");
    expect(await db.demoEvents.count()).toBe(before);
    expect(before).toBeGreaterThan(100);
    expect(await db.events.toArray()).toEqual([google]);
    expect(
      (await db.demoEvents.toArray()).every((event) => event.source === "demo"),
    ).toBe(true);
  });

  it("clearing samples preserves Google events and unrelated sync metadata", async () => {
    const db = database();
    const repository = new LocalCalendarRepository(db);
    const google = {
      ...makeDemoMonth("2026-11-01", "UTC")[0]!,
      key: "google-key",
      source: "google" as const,
    };
    await db.events.put(google);
    await db.meta.put({ key: "google-cursor", value: "keep-me" });
    await repository.prepareDemo("2026-11-01", "UTC");
    await repository.resetDemo();
    expect(await db.demoEvents.count()).toBe(0);
    expect(await db.events.get("google-key")).toEqual(google);
    expect(await db.meta.toArray()).toEqual([
      { key: "google-cursor", value: "keep-me" },
    ]);
    await repository.prepareDemo("2026-11-01", "UTC");
    expect(await db.demoEvents.count()).toBeGreaterThan(0);
  });

  it("retains events after closing and reopening the database", async () => {
    const db = database();
    await new LocalCalendarRepository(db).prepareDemo("2026-11-01", "UTC");
    const count = await db.demoEvents.count();
    db.close();
    await db.open();
    expect(await db.demoEvents.count()).toBe(count);
  });

  it.each([
    ["2026-99-01", "UTC"],
    ["2026-11-02", "UTC"],
    ["2026-11-01", "Invalid/Zone"],
  ])(
    "rejects invalid preparation inputs without writing data",
    async (month, zone) => {
      const db = database();
      await expect(
        new LocalCalendarRepository(db).prepareDemo(month, zone),
      ).rejects.toMatchObject({ code: "invalid-request" });
      expect(await db.demoEvents.count()).toBe(0);
    },
  );

  it("compares actual instants with fractional seconds and rejects invalid times or zones", () => {
    const event = makeDemoMonth("2026-11-01", "UTC").find(
      (event) => !event.allDay,
    )!;
    expect(
      eventSchema.safeParse({
        ...event,
        start: "2026-11-01T09:00:00Z",
        end: "2026-11-01T09:00:00.100Z",
      }).success,
    ).toBe(true);
    expect(eventSchema.safeParse({ ...event, end: "not-a-time" }).success).toBe(
      false,
    );
    expect(
      eventSchema.safeParse({ ...event, timeZone: "device" }).success,
    ).toBe(false);
  });

  it("models all-day dates with exclusive ends and valid calendar dates", () => {
    const event = makeDemoMonth("2026-11-01", "UTC").find(
      (event) => event.allDay,
    )!;
    expect(eventSchema.safeParse({ ...event, end: event.start }).success).toBe(
      false,
    );
    expect(
      eventSchema.safeParse({ ...event, start: "2026-02-30" }).success,
    ).toBe(false);
  });
});
