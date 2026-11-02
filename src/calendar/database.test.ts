import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { CalendarDatabase } from "./database";
import { makeFixtureMonth } from "../../tests/fixtures/calendar";
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
  it.each([1, 2])(
    "removes legacy preview data from schema %s while preserving Google data",
    async (version) => {
      const name = `migration-${crypto.randomUUID()}`;
      const old = new Dexie(name);
      old.version(1).stores({
        events: "&key, [accountId+calendarId], start, end, eventType",
        demoEvents: "&key, [accountId+calendarId], start, end, eventType",
        meta: "&key",
      });
      if (version === 2)
        old.version(2).stores({
          syncStates: "&key, accountId, [accountId+calendarId]",
          ranges: "&key, accountId, [accountId+calendarId]",
        });
      const event = makeFixtureMonth("2026-11-01", "UTC")[0]!;
      await old.table("demoEvents").put({ ...event, source: "demo" });
      await old.table("events").put(event);
      await old.table("meta").bulkPut([
        { key: "demo-v1:2026-11-01", value: "UTC" },
        { key: "unrelated-metadata", value: "keep-me" },
      ]);
      const sync = {
        key: "calendar",
        accountId: event.accountId,
        calendarId: event.calendarId,
        syncToken: "saved-cursor",
        running: false,
        invalidated: false,
        failures: 0,
      };
      const range = {
        key: "home",
        accountId: event.accountId,
        calendarId: event.calendarId,
        kind: "home",
        start: "2026-11-01",
        end: "2026-12-01",
        eventKeys: [event.key],
        fetchedAt: event.updatedAt,
        validatedAt: event.updatedAt,
      };
      if (version === 2) {
        await old.table("syncStates").put(sync);
        await old.table("ranges").put(range);
      }
      old.close();
      const upgraded = database(name);
      await upgraded.open();
      expect(upgraded.tables.map((table) => table.name)).not.toContain(
        "demoEvents",
      );
      expect(await upgraded.events.toArray()).toEqual([event]);
      expect(await upgraded.meta.toArray()).toEqual([
        { key: "unrelated-metadata", value: "keep-me" },
      ]);
      expect(await upgraded.syncStates.toArray()).toEqual(
        version === 2 ? [sync] : [],
      );
      expect(await upgraded.ranges.toArray()).toEqual(
        version === 2 ? [range] : [],
      );
      upgraded.close();
      await upgraded.open();
      expect(await upgraded.events.toArray()).toEqual([event]);
    },
  );

  it("compares actual instants with fractional seconds and rejects invalid times or zones", () => {
    const event = makeFixtureMonth("2026-11-01", "UTC").find(
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
    const event = makeFixtureMonth("2026-11-01", "UTC").find(
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

it("upgrades a stage 3 cache in place with empty independent outbox and edit-base tables", async () => {
  const name = `stage-4-migration-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(3).stores({
    events: "&key, [accountId+calendarId], start, end, eventType",
    meta: "&key",
    syncStates: "&key, accountId, [accountId+calendarId]",
    ranges: "&key, accountId, [accountId+calendarId]",
  });
  const event = makeFixtureMonth("2026-11-01", "UTC")[0]!;
  await old.table("events").put(event);
  await old.table("meta").put({ key: "keep", value: "existing" });
  old.close();
  const upgraded = database(name);
  await upgraded.open();
  expect(upgraded.verno).toBe(4);
  expect(await upgraded.events.toArray()).toEqual([event]);
  expect(await upgraded.meta.get("keep")).toEqual({
    key: "keep",
    value: "existing",
  });
  expect(await upgraded.outbox.count()).toBe(0);
  expect(await upgraded.editBases.count()).toBe(0);
});
