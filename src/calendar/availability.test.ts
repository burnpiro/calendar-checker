import { describe, expect, it } from "vitest";
import {
  availabilityWindows,
  busyEvents,
  busyIntervalSchema,
} from "./availability";
import { preferredCalendarAccounts } from "./coverage";
import { canEditEvent } from "./write-model";
import { reminderCandidates } from "../reminders/planning";
import { emptyStore, type Account } from "../shared/model";

const at = "2026-11-02T00:00:00Z";
const account: Account = {
  id: "a",
  email: "a@example.test",
  enabled: true,
  status: "connected",
  connectedAt: at,
  lastCheckedAt: at,
  lastSuccessfulAt: at,
  calendars: [
    {
      id: "shared",
      summary: "Shared",
      primary: false,
      accessRole: "freeBusyReader",
    },
  ],
};
describe("Google availability blocks", () => {
  it("bounds each request and merges clipped intervals across query/day boundaries with stable keys", () => {
    const bounds = {
      start: "2026-09-01T00:00:00Z",
      end: "2027-06-01T00:00:00Z",
    };
    const windows = availabilityWindows(bounds);
    expect(windows[0]!.start).toBe(bounds.start);
    expect(windows.at(-1)!.end).toBe(bounds.end);
    for (const [i, window] of windows.entries()) {
      expect(
        Date.parse(window.end) - Date.parse(window.start),
      ).toBeLessThanOrEqual(31 * 86400000);
      if (i) expect(window.start).toBe(windows[i - 1]!.end);
    }
    const first = {
      start: "2026-11-02T23:00:00Z",
      end: "2026-11-03T00:00:00Z",
    };
    const second = { start: first.end, end: "2026-11-03T02:00:00Z" };
    const split = busyEvents(
      [second, first, first],
      account,
      account.calendars[0]!,
      at,
    );
    const whole = busyEvents(
      [{ start: first.start, end: second.end }],
      account,
      account.calendars[0]!,
      at,
    );
    expect(split).toEqual(whole);
    expect(split).toHaveLength(2);
    expect(
      split.every(
        (e) =>
          e.title === "Busy" && e.availabilityOnly && !e.etag && !e.organizer,
      ),
    ).toBe(true);
  });
  it("rejects invalid dates and reversed intervals and normalizes offsets", () => {
    expect(
      busyIntervalSchema.parse({
        start: "2026-11-02T10:00:00+01:00",
        end: "2026-11-02T11:00:00+01:00",
      }),
    ).toEqual({ start: "2026-11-02T09:00:00Z", end: "2026-11-02T10:00:00Z" });
    expect(busyIntervalSchema.safeParse({ start: at, end: at }).success).toBe(
      false,
    );
    expect(
      busyIntervalSchema.safeParse({ start: "invalid", end: at }).success,
    ).toBe(false);
  });
  it("prefers an equally covered detailed copy, never edits or schedules reminders for availability", () => {
    const full: Account = {
      ...account,
      id: "b",
      email: "b@example.test",
      calendars: [{ ...account.calendars[0]!, accessRole: "owner" }],
    };
    const store = emptyStore();
    store.settings.reminders.desktop = true;
    const view = { start: "2026-11-01", end: "2026-12-01" };
    const ranges = [account, full].map((a) => ({
      ...view,
      key: a.id,
      accountId: a.id,
      calendarId: "shared",
      kind: "home" as const,
      fetchedAt: at,
      validatedAt: a.id === "a" ? "2026-11-02T01:00:00Z" : at,
    }));
    const preferred = preferredCalendarAccounts(
      [account, full],
      store.settings,
      {
        ranges,
        states: [
          {
            key: '["a","shared"]',
            accountId: "a",
            calendarId: "shared",
            dataKind: "freebusy",
            running: false,
            invalidated: false,
            failures: 0,
          },
        ],
        failed: false,
      },
      view,
    );
    expect(preferred.get("shared")).toBe("b");
    const blocks = busyEvents(
      [{ start: "2026-11-02T00:10:00Z", end: "2026-11-02T01:00:00Z" }],
      full,
      full.calendars[0]!,
      at,
    );
    expect(canEditEvent({ ...blocks[0]!, locked: false }, [full])).toBe(false);
    expect(
      reminderCandidates(blocks, [full], store.settings, new Date(at)),
    ).toEqual([]);
  });
});
