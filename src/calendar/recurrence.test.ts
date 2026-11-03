import { describe, expect, it } from "vitest";
import { repeatRule, validNewRecurrence, type RepeatRule } from "./recurrence";
const input: RepeatRule = {
  frequency: "WEEKLY",
  interval: 2,
  ends: "count",
  count: 8,
  until: "2026-11-30",
  weekdays: ["WE", "MO"],
  allDay: false,
  timeZone: "Europe/Warsaw",
  start: "2026-11-02T08:00:00Z",
};
describe("editor recurrence", () => {
  it("builds canonical weekday intervals, finite counts and open-ended repeats", () => {
    expect(repeatRule(input)).toEqual([
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=8",
    ]);
    expect(
      repeatRule({ ...input, frequency: "MONTHLY", ends: "never" }),
    ).toEqual(["RRULE:FREQ=MONTHLY;INTERVAL=2"]);
    expect(validNewRecurrence(repeatRule(input))).toBe(true);
  });
  it("uses an inclusive named-zone final day and date-only UNTIL for all-day events", () => {
    expect(repeatRule({ ...input, ends: "until" })[0]).toContain(
      "UNTIL=20261130T225959Z",
    );
    expect(
      repeatRule({
        ...input,
        ends: "until",
        allDay: true,
        start: "2026-11-02",
      })[0],
    ).toContain("UNTIL=20261130");
    expect(() =>
      repeatRule({ ...input, ends: "until", until: "2026-11-01" }),
    ).toThrow();
  });
  it("rejects malformed new rules while permitting the legacy count grammar", () => {
    expect(validNewRecurrence(["RRULE:FREQ=DAILY;COUNT=10"])).toBe(true);
    for (const rule of [
      "RRULE:FREQ=DAILY;COUNT=1001",
      "RRULE:FREQ=WEEKLY;BYDAY=MO,MO",
      "RRULE:FREQ=MONTHLY;BYDAY=MO",
      "RRULE:FREQ=DAILY;UNTIL=20260230",
      "RRULE:FREQ=DAILY;INTERVAL=0",
      "RRULE:FREQ=DAILY\nDTSTART:20261103",
    ])
      expect(validNewRecurrence([rule])).toBe(false);
    expect(() => repeatRule({ ...input, interval: NaN })).toThrow();
  });
});
