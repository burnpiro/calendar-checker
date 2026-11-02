import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import { initialEventRange, movedEventEnd } from "./editor-time";
import { makeFixtureMonth } from "../../../tests/fixtures/calendar";

const now = Temporal.Instant.from("2026-11-02T12:10:00Z");
describe("event editor time defaults", () => {
  it("starts date-cell creation as a timed one-hour event and keeps timed slot selections", () => {
    expect(
      initialEventRange(
        undefined,
        { start: "2026-11-05" },
        "Europe/Warsaw",
        now,
      ),
    ).toEqual({
      allDay: false,
      start: "2026-11-05T09:00",
      end: "2026-11-05T10:00:00",
    });
    expect(
      initialEventRange(
        undefined,
        { start: "2026-11-05T14:15:00Z" },
        "Europe/Warsaw",
        now,
      ),
    ).toEqual({
      allDay: false,
      start: "2026-11-05T15:15:00",
      end: "2026-11-05T16:15:00",
    });
  });
  it("uses the default zone for toolbar creation and rolls a one-hour event over midnight", () => {
    expect(initialEventRange(undefined, undefined, "Asia/Tokyo", now)).toEqual({
      allDay: false,
      start: "2026-11-02T22:00:00",
      end: "2026-11-02T23:00:00",
    });
    expect(
      initialEventRange(
        undefined,
        { start: "2026-11-05T23:30:00Z" },
        "UTC",
        now,
      ).end,
    ).toBe("2026-11-06T00:30:00");
  });
  it("preserves existing all-day mode, inclusive dates and exact timed seconds", () => {
    const events = makeFixtureMonth("2026-11-01", "UTC");
    const allDay = events.find((event) => event.allDay)!;
    const initial = initialEventRange(allDay, undefined, "UTC", now);
    expect(initial.allDay).toBe(true);
    expect(
      Temporal.PlainDate.from(initial.end).add({ days: 1 }).toString(),
    ).toBe(allDay.end);
    const timed = {
      ...events.find((event) => !event.allDay)!,
      allDay: false as const,
      start: "2026-11-05T09:03:20.123Z",
      end: "2026-11-05T10:03:20.123Z",
    };
    expect(initialEventRange(timed, undefined, "UTC", now).start).toBe(
      "2026-11-05T09:03:20.123",
    );
  });
  it("moves the end with the start while preserving duration and leaves incomplete input repairable", () => {
    expect(
      movedEventEnd(
        "2026-11-05T09:00",
        "2026-11-05T10:00",
        "2026-11-05T23:30",
        false,
      ),
    ).toBe("2026-11-06T00:30:00");
    expect(movedEventEnd("2026-11-05", "2026-11-07", "2026-12-01", true)).toBe(
      "2026-12-03",
    );
    expect(
      movedEventEnd("", "2026-11-05T10:00", "2026-11-05T09:00", false),
    ).toBe("2026-11-05T10:00");
  });
});
