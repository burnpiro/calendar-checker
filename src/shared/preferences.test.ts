import { describe, expect, it } from "vitest";
import { storeSchema } from "./model";
import {
  DEFAULT_SETTINGS,
  calendarKey,
  settingsPatchSchema,
  settingsSchema,
} from "./preferences";
import { makeDemoMonth } from "../calendar/demo";
import { dateKey, eventWhen, visibleEvents } from "../calendar/presentation";

describe("preference compatibility and event presentation", () => {
  it("upgrades stage 1 settings in memory without losing auth timing or accounts", () => {
    const value = storeSchema.parse({
      schemaVersion: 1,
      accounts: [],
      diagnostics: [],
      settings: { connectionCheckMinutes: 9, staleAfterMinutes: 27 },
    });
    expect(value.settings).toMatchObject({
      connectionCheckMinutes: 9,
      staleAfterMinutes: 27,
      defaultView: "month",
      theme: "system",
    });
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });
  it("partial updates contain only requested keys, without injecting unrelated defaults", () => {
    expect(settingsPatchSchema.parse({ theme: "dark" })).toEqual({
      theme: "dark",
    });
    expect(
      settingsPatchSchema.safeParse({ unknownSetting: true }).success,
    ).toBe(false);
  });
  it("rejects invalid visible hours and unknown time zones", () => {
    expect(
      settingsSchema.safeParse({
        ...DEFAULT_SETTINGS,
        weekStartHour: 20,
        weekEndHour: 8,
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...DEFAULT_SETTINGS,
        primaryTimeZone: "Not/AZone",
      }).success,
    ).toBe(false);
  });
  it("does not mix samples into a real account calendar", () => {
    const events = makeDemoMonth("2026-11-01", "UTC");
    expect(
      visibleEvents(
        events,
        { ...DEFAULT_SETTINGS, dataSource: "google" },
        [],
        "",
        [],
      ),
    ).toEqual([]);
    const hidden = {
      ...DEFAULT_SETTINGS,
      calendarVisibility: {
        [calendarKey("demo-work-account", "demo-work")]: false,
      },
    };
    expect(
      visibleEvents(events, hidden, [], "", []).every(
        (event) => event.calendarId !== "demo-work",
      ),
    ).toBe(true);
    expect(events.some((event) => event.calendarId === "demo-work")).toBe(true);
  });
  it("filters independently by text and Google event type without modifying stored events", () => {
    const events = makeDemoMonth("2026-11-01", "UTC");
    const birthday = visibleEvents(
      events,
      DEFAULT_SETTINGS,
      [],
      "birthday",
      [],
    );
    expect(birthday.length).toBe(1);
    expect(
      visibleEvents(events, DEFAULT_SETTINGS, [], "birthday", ["birthday"]),
    ).toEqual([]);
    expect(events.some((event) => event.eventType === "birthday")).toBe(true);
  });
  it("keeps sample wall times stable across DST and labels overnight event dates", () => {
    const month = makeDemoMonth("2026-03-01", "Europe/Warsaw");
    expect(
      month.find((event) => event.title === "Weekly planning")?.start,
    ).toBe("2026-03-02T08:00:00Z");
    expect(
      month.filter((event) => event.title === "Weekly planning").at(-1)?.start,
    ).toBe("2026-03-30T07:00:00Z");
    const overnight = {
      ...month.find((event) => !event.allDay)!,
      allDay: false as const,
      start: "2026-11-01T22:30:00Z",
      end: "2026-11-02T02:00:00Z",
    };
    expect(eventWhen(overnight, "Europe/Warsaw", "24h")).toContain(
      "Sunday, November 1 · 23:30 – Monday, November 2 · 03:00",
    );
  });

  it("converts instants across dates and DST without moving all-day dates", () => {
    expect(dateKey(new Date("2026-11-01T23:30:00Z"), "Europe/Warsaw")).toBe(
      "2026-11-02",
    );
    const birthday = makeDemoMonth("2026-11-01", "Europe/Warsaw").find(
      (event) => event.eventType === "birthday",
    )!;
    expect(eventWhen(birthday, "America/Los_Angeles", "12h")).toBe(
      "November 5 · All day",
    );
  });
});
