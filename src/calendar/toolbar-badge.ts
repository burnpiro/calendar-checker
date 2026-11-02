import { Temporal } from "temporal-polyfill";
import type { Account, Settings } from "../shared/model";
import { displayTimeZone } from "../shared/preferences";
import type { CalendarEvent } from "./model";
import type { SyncMetadata } from "./sync-model";
import { preferredCalendarAccounts } from "./coverage";
import { dateKey, eventWhen, visibleEvents } from "./presentation";

export interface ToolbarBadge {
  text: string;
  color: string;
  title: string;
}
/** Choose the more readable black/white foreground using relative luminance. */
export function badgeTextColor(background: string): string {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((offset) => {
    const channel = parseInt(background.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return blackContrast > whiteContrast ? "#000000" : "#ffffff";
}
export const emptyToolbarBadge: ToolbarBadge = {
  text: "",
  color: "#7765d8",
  title: "Calendar Checker",
};
export function reconnectToolbarBadge(count: number): ToolbarBadge {
  return {
    text: "!",
    color: "#b42335",
    title: `Calendar Checker — ${count} account${count === 1 ? " needs" : "s need"} reconnecting`,
  };
}

/** Uses saved events only; temporary per-window searches/type filters do not apply. */
export function nextEventBadge(
  accounts: Account[],
  settings: Settings,
  events: CalendarEvent[],
  metadata: SyncMetadata,
  now: Date,
): ToolbarBadge {
  if (!settings.showEventBadge) return emptyToolbarBadge;
  const zone = displayTimeZone(settings.primaryTimeZone);
  const today = Temporal.PlainDate.from(dateKey(now, zone));
  const candidates = visibleEvents(events, settings, accounts, "", [])
    .filter(
      (event) =>
        !event.allDay &&
        !event.availabilityOnly &&
        event.responseStatus !== "declined" &&
        Date.parse(event.start) >= now.getTime(),
    )
    .sort(
      (a, b) =>
        Date.parse(a.start) - Date.parse(b.start) || a.key.localeCompare(b.key),
    );
  const preferredByDay = new Map<string, Map<string, string>>();
  for (const event of candidates) {
    const date = dateKey(new Date(event.start), zone);
    let preferred = preferredByDay.get(date);
    if (!preferred) {
      preferred = preferredCalendarAccounts(accounts, settings, metadata, {
        start: date,
        end: Temporal.PlainDate.from(date).add({ days: 1 }).toString(),
      });
      preferredByDay.set(date, preferred);
    }
    if (preferred.get(event.calendarId) !== event.accountId) continue;
    const days = today.until(Temporal.PlainDate.from(date), {
      largestUnit: "days",
    }).days;
    const time = Temporal.Instant.from(event.start).toZonedDateTimeISO(zone);
    return {
      text:
        days === 0
          ? `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`
          : `+${days}d`,
      color: event.color,
      title: `Calendar Checker — Next saved event: ${event.title.slice(0, 160)}\n${eventWhen(event, zone, settings.timeFormat)}\n${zone}`,
    };
  }
  return emptyToolbarBadge;
}
