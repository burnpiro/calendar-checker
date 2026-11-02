import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import type { Account, CalendarSummary } from "../shared/model";
import { eventKey, eventSchema, type CalendarEvent } from "./model";
import type { DateRange } from "./sync-model";

export const busyIntervalSchema = z
  .object({ start: z.string(), end: z.string() })
  .transform((value, context) => {
    try {
      const start = Temporal.Instant.from(value.start);
      const end = Temporal.Instant.from(value.end);
      if (Temporal.Instant.compare(start, end) >= 0) throw new Error();
      return { start: start.toString(), end: end.toString() };
    } catch {
      context.addIssue({ code: "custom", message: "Invalid busy interval" });
      return z.NEVER;
    }
  });
export type BusyInterval = z.infer<typeof busyIntervalSchema>;

/** Bounded availability queries have no change-feed cursor. */
export function availabilityWindows(bounds: DateRange): DateRange[] {
  const result: DateRange[] = [];
  let start = Temporal.Instant.from(bounds.start);
  const end = Temporal.Instant.from(bounds.end);
  while (Temporal.Instant.compare(start, end) < 0) {
    const next = start.add({ hours: 31 * 24 });
    const stop = Temporal.Instant.compare(next, end) < 0 ? next : end;
    result.push({ start: start.toString(), end: stop.toString() });
    start = stop;
  }
  return result;
}

/** Stable UTC-day segments deduplicate overlapping home/browse snapshots. */
export function busyEvents(
  intervals: BusyInterval[],
  account: Pick<Account, "id" | "email">,
  calendar: CalendarSummary,
  at: string,
): CalendarEvent[] {
  const merged: Array<{ start: number; end: number }> = [];
  for (const value of [...intervals].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  )) {
    const start = Date.parse(value.start);
    const end = Date.parse(value.end);
    const previous = merged.at(-1);
    if (previous && start <= previous.end)
      previous.end = Math.max(previous.end, end);
    else merged.push({ start, end });
  }
  const events: CalendarEvent[] = [];
  for (const range of merged) {
    let start = range.start;
    while (start < range.end) {
      const dayEnd = new Date(start);
      dayEnd.setUTCHours(24, 0, 0, 0);
      const end = Math.min(dayEnd.getTime(), range.end);
      const from = new Date(start).toISOString();
      const to = new Date(end).toISOString();
      // This is a local availability key, never a Google event mutation ID.
      const id = `availability:${from}/${to}`;
      events.push(
        eventSchema.parse({
          key: eventKey(account.id, calendar.id, id),
          source: "google",
          accountId: account.id,
          calendarId: calendar.id,
          eventId: id,
          availabilityOnly: true,
          title: "Busy",
          eventType: "default",
          color: calendar.backgroundColor ?? "#7765d8",
          calendarName: calendar.summary,
          accountName: account.email,
          timeZone: "UTC",
          allDay: false,
          start: from,
          end: to,
          locked: true,
          updatedAt: at,
        }),
      );
      start = end;
    }
  }
  return events;
}
