import { describe, expect, it } from "vitest";
import { storeSchema, type Account } from "./model";
import {
  DEFAULT_SETTINGS,
  calendarKey,
  settingsPatchSchema,
  settingsSchema,
} from "./preferences";
import { makeFixtureMonth } from "../../tests/fixtures/calendar";
import { dateKey, eventWhen, visibleEvents } from "../calendar/presentation";

const accounts = ["fixture-work-account", "fixture-personal-account"].map(
  (id) => ({ id, enabled: true }) as Account,
);

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
      weekLayout: "scroll",
      weekHourHeight: 48,
    });
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });
  it.each(["demo", "google"])(
    "ignores the retired %s preference while preserving existing settings",
    (dataSource) => {
      const settings = settingsSchema.parse({
        ...DEFAULT_SETTINGS,
        dataSource,
        theme: "dark",
        syncIntervalMinutes: 9,
      });
      expect(settings).not.toHaveProperty("dataSource");
      expect(settings).toMatchObject({ theme: "dark", syncIntervalMinutes: 9 });
      expect(settingsPatchSchema.safeParse({ dataSource }).success).toBe(false);
    },
  );
  it("partial updates contain only requested keys, without injecting unrelated defaults", () => {
    expect(settingsPatchSchema.parse({ theme: "dark" })).toEqual({
      theme: "dark",
    });
    expect(
      settingsPatchSchema.safeParse({ unknownSetting: true }).success,
    ).toBe(false);
  });
  it.each([0, 31, 121, 48.5])(
    "rejects an invalid minimum hour height of %s",
    (weekHourHeight) => {
      expect(settingsPatchSchema.safeParse({ weekHourHeight }).success).toBe(
        false,
      );
    },
  );
  it("accepts a fit-layout patch without resetting the saved hour height or other preferences", () => {
    const previous = { ...DEFAULT_SETTINGS, theme: "dark", weekHourHeight: 72 };
    const patch = settingsPatchSchema.parse({ weekLayout: "fit" });
    expect(patch).toEqual({ weekLayout: "fit" });
    expect(settingsSchema.parse({ ...previous, ...patch })).toMatchObject({
      weekLayout: "fit",
      weekHourHeight: 72,
      theme: "dark",
    });
    expect(
      settingsPatchSchema.safeParse({ weekLayout: "invalid" }).success,
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
  it("hides disconnected accounts and independently hidden calendars", () => {
    const events = makeFixtureMonth("2026-11-01", "UTC");
    expect(visibleEvents(events, DEFAULT_SETTINGS, [], "", [])).toEqual([]);
    const hidden = {
      ...DEFAULT_SETTINGS,
      calendarVisibility: {
        [calendarKey("fixture-work-account", "fixture-work")]: false,
      },
    };
    expect(
      visibleEvents(events, hidden, accounts, "", []).every(
        (event) => event.calendarId !== "fixture-work",
      ),
    ).toBe(true);
    expect(events.some((event) => event.calendarId === "fixture-work")).toBe(
      true,
    );
  });
  it("filters independently by text and Google event type without modifying stored events", () => {
    const events = makeFixtureMonth("2026-11-01", "UTC");
    const birthday = visibleEvents(
      events,
      DEFAULT_SETTINGS,
      accounts,
      "birthday",
      [],
    );
    expect(birthday.length).toBe(1);
    expect(
      visibleEvents(events, DEFAULT_SETTINGS, accounts, "birthday", [
        "birthday",
      ]),
    ).toEqual([]);
    expect(events.some((event) => event.eventType === "birthday")).toBe(true);
  });
  it("keeps fixture wall times stable across DST and labels overnight event dates", () => {
    const month = makeFixtureMonth("2026-03-01", "Europe/Warsaw");
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
    const birthday = makeFixtureMonth("2026-11-01", "Europe/Warsaw").find(
      (event) => event.eventType === "birthday",
    )!;
    expect(eventWhen(birthday, "America/Los_Angeles", "12h")).toBe(
      "November 5 · All day",
    );
  });
});
