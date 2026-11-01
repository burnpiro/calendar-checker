import { Temporal } from "temporal-polyfill";
import type { CalendarEvent } from "./model";
import { calendarKey, type Settings } from "../shared/preferences";
import type { Account } from "../shared/model";

export function dateKey(date: Date, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .toString();
}
export function eventWhen(
  event: CalendarEvent,
  timeZone: string,
  format: Settings["timeFormat"],
): string {
  if (event.allDay) {
    const start = Temporal.PlainDate.from(event.start);
    const last = Temporal.PlainDate.from(event.end).subtract({ days: 1 });
    return `${start.toLocaleString("en", { month: "long", day: "numeric" })}${last.equals(start) ? "" : ` – ${last.toLocaleString("en", { month: "long", day: "numeric" })}`} · All day`;
  }
  const dayFormatter = new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const start = new Date(event.start);
  const end = new Date(event.end);
  const day = dayFormatter.format(start);
  const time = new Intl.DateTimeFormat("en", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h",
  });
  return dateKey(start, timeZone) === dateKey(end, timeZone)
    ? `${day} · ${time.format(start)} – ${time.format(end)}`
    : `${day} · ${time.format(start)} – ${dayFormatter.format(end)} · ${time.format(end)}`;
}
export function visibleEvents(
  events: CalendarEvent[],
  settings: Settings,
  accounts: Account[],
  query: string,
  hiddenTypes: string[],
  preferred?: Map<string, string>,
): CalendarEvent[] {
  const enabled = new Set(
    accounts.filter((account) => account.enabled).map((account) => account.id),
  );
  const needle = query.trim().toLocaleLowerCase();
  return events.filter(
    (event) =>
      event.source === "google" &&
      enabled.has(event.accountId) &&
      (!preferred || preferred.get(event.calendarId) === event.accountId) &&
      settings.calendarVisibility[
        calendarKey(event.accountId, event.calendarId)
      ] !== false &&
      !hiddenTypes.includes(event.eventType) &&
      (!needle ||
        `${event.title} ${event.description} ${event.location} ${event.calendarName}`
          .toLocaleLowerCase()
          .includes(needle)),
  );
}
