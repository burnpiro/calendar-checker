import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { emptyStore, type Account } from "../shared/model";
import { calendarKey } from "../shared/preferences";
import { eventKey, eventSchema, type CalendarEvent } from "./model";
import { badgeTextColor, nextEventBadge } from "./toolbar-badge";
import { CalendarDatabase } from "./database";
import { EventRepository } from "./event-repository";
import { emptySyncState, type SyncMetadata } from "./sync-model";

const now = new Date("2026-11-02T10:00:00Z");
const settings = { ...emptyStore().settings, primaryTimeZone: "UTC" };
function account(id = "a", enabled = true): Account {
  return {
    id,
    email: `${id}@example.test`,
    enabled,
    status: "connected",
    calendars: ["calendar", "hidden"].map((id) => ({
      id,
      summary: id,
      accessRole: "owner",
      primary: id === "calendar",
    })),
    connectedAt: now.toISOString(),
    lastCheckedAt: null,
    lastSuccessfulAt: null,
  };
}
function event(
  start = "2026-11-02T14:30:00Z",
  patch: Partial<CalendarEvent> = {},
): CalendarEvent {
  const value = {
    source: "google",
    accountId: "a",
    calendarId: "calendar",
    eventId: start,
    title: "Meeting",
    calendarName: "Work",
    accountName: "a@example.test",
    color: "#7765d8",
    eventType: "default",
    allDay: false,
    start,
    end: new Date(Date.parse(start) + 3600_000).toISOString(),
    timeZone: "UTC",
    updatedAt: now.toISOString(),
    ...patch,
  };
  return eventSchema.parse({
    ...value,
    key: eventKey(value.accountId, value.calendarId, value.eventId),
  });
}
const metadata: SyncMetadata = { states: [], ranges: [], failed: false };
const badge = (events: CalendarEvent[], at = now, overrides = {}) =>
  nextEventBadge(
    [account()],
    { ...settings, ...overrides },
    events,
    metadata,
    at,
  );

describe("next-event toolbar badge", () => {
  it("includes busy-only calendars with their color, day distance and visibility rules", () => {
    const a = account();
    a.calendars[0]!.accessRole = "freeBusyReader";
    const busy = event("2026-11-02T11:00:00Z", {
      availabilityOnly: true,
      title: "Busy",
      locked: true,
      color: "#348e81",
    });
    const select = (overrides = {}) =>
      nextEventBadge([a], { ...settings, ...overrides }, [busy], metadata, now);
    expect(select()).toMatchObject({ text: "11:00", color: "#348e81" });
    expect(select().title).toContain("Next saved busy period: Busy");
    expect(
      select({ calendarVisibility: { [calendarKey("a", "calendar")]: false } })
        .text,
    ).toBe("");
    expect(
      badge([
        { ...busy, start: "2026-11-03T11:00:00Z", end: "2026-11-03T12:00:00Z" },
      ]).text,
    ).toBe("+1d");
    a.enabled = false;
    expect(select().text).toBe("");
  });
  it("joins midnight busy segments without mutating cached data or announcing an ongoing period again", async () => {
    const db = new CalendarDatabase(`toolbar-busy-${crypto.randomUUID()}`);
    try {
      const blocks = [
        event("2026-11-02T23:00:00Z", {
          availabilityOnly: true,
          title: "Busy",
          end: "2026-11-03T00:00:00Z",
        }),
        event("2026-11-03T00:00:00Z", {
          availabilityOnly: true,
          title: "Busy",
          end: "2026-11-03T01:00:00Z",
        }),
        event("2026-11-03T10:00:00Z", {
          availabilityOnly: true,
          title: "Busy",
        }),
      ];
      await db.events.bulkPut(blocks);
      const at = new Date("2026-11-02T23:30:00Z");
      const data = await new EventRepository(db).toolbarData(at);
      expect(data.events).toHaveLength(3);
      const original = structuredClone(data.events);
      expect(
        nextEventBadge(
          [account()],
          { ...settings, primaryTimeZone: "Europe/Warsaw" },
          data.events,
          metadata,
          at,
        ).text,
      ).toBe("11:00");
      expect(data.events).toEqual(original);
      expect(
        nextEventBadge(
          [account()],
          settings,
          blocks.slice(0, 2),
          metadata,
          new Date("2026-11-02T22:30:00Z"),
        ).title,
      ).toContain("1:00");
    } finally {
      await db.delete();
    }
  });
  it("shows only the nearest upcoming start time, with details in the tooltip", () => {
    const result = badge([
      event("2026-11-02T16:00:00Z", { color: "#f6bf26" }),
      event(undefined, { color: "#1a237e" }),
    ]);
    expect(result.text).toBe("14:30");
    expect(result.color).toBe("#1a237e");
    expect(badgeTextColor(result.color)).toBe("#ffffff");
    expect(result.title).toContain("Next saved event: Meeting");
    expect(result.title).toContain("UTC");
    expect(badge([event()], now, { timeFormat: "12h" }).text).toBe("14:30");
  });
  it.each([1, 3, 12])(
    "shows +%sd when the next event is on a later calendar date",
    (days) => {
      const date = new Date(now.getTime() + days * 86400_000)
        .toISOString()
        .slice(0, 10);
      const result = badge([event(`${date}T14:30:00Z`, { color: "#f6bf26" })]);
      expect(result.text).toBe(`+${days}d`);
      expect(result.color).toBe("#f6bf26");
      expect(badgeTextColor(result.color)).toBe("#000000");
    },
  );
  it("uses the selected time zone to determine today and the event time", () => {
    const at = new Date("2026-11-02T07:30:00Z");
    expect(
      badge([event("2026-11-02T07:45:00Z")], at, {
        primaryTimeZone: "America/Los_Angeles",
      }).text,
    ).toBe("23:45");
    expect(
      badge([event("2026-11-02T08:30:00Z")], at, {
        primaryTimeZone: "America/Los_Angeles",
      }).text,
    ).toBe("+1d");
  });
  it.each([
    ["2026-03-28T23:30:00Z", "2026-03-29T22:30:00Z"],
    ["2026-10-24T22:30:00Z", "2026-10-25T23:30:00Z"],
  ])("counts calendar dates across DST from %s", (at, start) => {
    expect(
      badge([event(start)], new Date(at), { primaryTimeZone: "Europe/Warsaw" })
        .text,
    ).toBe("+1d");
  });
  it("skips past, all-day, declined, hidden and paused-account events", () => {
    const hidden = {
      ...settings,
      calendarVisibility: { [calendarKey("a", "hidden")]: false },
    };
    const candidates = [
      event("2026-11-02T09:00:00Z"),
      event("2026-11-02", { allDay: true, end: "2026-11-03" }),
      event("2026-11-02T10:15:00Z", { responseStatus: "declined" }),
      event("2026-11-02T10:30:00Z", { calendarId: "hidden" }),
      event("2026-11-02T11:00:00Z", { accountId: "b" }),
      event(),
    ];
    expect(
      nextEventBadge(
        [account(), account("b", false)],
        hidden,
        candidates,
        metadata,
        now,
      ).text,
    ).toBe("14:30");
    expect(nextEventBadge([], settings, candidates, metadata, now).text).toBe(
      "",
    );
  });
  it("prefers the better-covered shared calendar copy, matching the calendar UI", () => {
    const ranges = ["a", "b"].map((id) => ({
      key: id,
      accountId: id,
      calendarId: "calendar",
      kind: "home" as const,
      start: "2026-11-01",
      end: "2026-12-01",
      fetchedAt: id === "a" ? "2026-11-02T09:00:00Z" : "2026-11-02T10:00:00Z",
      validatedAt: id === "a" ? "2026-11-02T09:00:00Z" : "2026-11-02T10:00:00Z",
    }));
    expect(
      nextEventBadge(
        [account(), account("b")],
        settings,
        [
          event("2026-11-02T10:30:00Z"),
          event("2026-11-02T11:00:00Z", { accountId: "b" }),
        ],
        { ...metadata, ranges },
        now,
      ).text,
    ).toBe("11:00");
  });
  it("advances from the saved cache as time passes, without needing a network sync", () => {
    const events = [event("2026-11-02T10:15:00Z"), event()];
    expect(badge(events).text).toBe("10:15");
    expect(badge(events, new Date("2026-11-02T11:00:00Z")).text).toBe("14:30");
    expect(badge(events, new Date("2026-11-02T15:00:00Z")).text).toBe("");
  });
  it("clears when disabled or when no future timed event is cached", () => {
    expect(badge([event()], now, { showEventBadge: false }).text).toBe("");
    expect(badge([]).text).toBe("");
  });
  it("reads upcoming cache candidates and cursor-free metadata without fractional-second index gaps", async () => {
    const db = new CalendarDatabase(`toolbar-${crypto.randomUUID()}`);
    try {
      const future = event("2026-11-02T10:00:00.550Z");
      await db.events.bulkPut([
        event("2026-11-02T09:59:59Z"),
        future,
        event("2026-11-03", { allDay: true, end: "2026-11-04" }),
        event("2026-11-02T11:00:00Z", { responseStatus: "declined" }),
      ]);
      await db.syncStates.put({
        ...emptySyncState("a", "calendar"),
        syncToken: "private-cursor",
      });
      const data = await new EventRepository(db).toolbarData(
        new Date("2026-11-02T10:00:00.500Z"),
      );
      expect(data.events).toEqual([future]);
      expect(JSON.stringify(data.metadata)).not.toContain("private-cursor");
      expect(
        nextEventBadge(
          [account()],
          settings,
          data.events,
          data.metadata,
          new Date("2026-11-02T10:00:00.500Z"),
        ).text,
      ).toBe("10:00");
    } finally {
      await db.delete();
    }
  });
});
