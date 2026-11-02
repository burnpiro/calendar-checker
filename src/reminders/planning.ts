import { Temporal } from "temporal-polyfill";
import type { CalendarEvent } from "../calendar/model";
import type { Account, Settings } from "../shared/model";
import { displayTimeZone } from "../shared/time-zones";
import { readableCalendar } from "../calendar/sync-model";
import type { ReminderJob } from "./model";

export function dndActive(settings: Settings["dnd"], now: Date): boolean {
  if (
    settings.manual &&
    (!settings.until || Date.parse(settings.until) > now.getTime())
  )
    return true;
  if (!settings.scheduleEnabled) return false;
  const local = Temporal.Instant.fromEpochMilliseconds(
    now.getTime(),
  ).toZonedDateTimeISO(displayTimeZone(settings.timeZone));
  const minute = local.hour * 60 + local.minute;
  const point = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return settings.rules.some((rule) => {
    const start = point(rule.start),
      end = point(rule.end);
    if (start === end) return rule.days.includes(local.dayOfWeek);
    if (start < end)
      return (
        rule.days.includes(local.dayOfWeek) && minute >= start && minute < end
      );
    return (
      (rule.days.includes(local.dayOfWeek) && minute >= start) ||
      (rule.days.includes(local.dayOfWeek === 1 ? 7 : local.dayOfWeek - 1) &&
        minute < end)
    );
  });
}
export function reminderPolicy(settings: Settings, calendarId: string) {
  const rule = settings.notificationCalendars[calendarId];
  return {
    ...settings.reminders,
    ...rule,
    offsets: rule?.offsets ?? settings.reminders.offsets,
    soundId: rule?.soundId ?? settings.reminders.soundId,
    desktop: settings.reminders.desktop && rule?.desktop !== false,
    sound: settings.reminders.sound && rule?.sound !== false,
  };
}
export function reminderCandidates(
  events: CalendarEvent[],
  accounts: Account[],
  settings: Settings,
  now: Date,
): Omit<ReminderJob, "id" | "status">[] {
  if (!settings.reminders.desktop && !settings.reminders.sound) return [];
  const allowed = new Set(
    accounts
      .filter((a) => a.enabled)
      .flatMap((a) =>
        a.calendars
          .filter((c) => readableCalendar(c.accessRole))
          .map((c) => JSON.stringify([a.id, c.id])),
      ),
  );
  const chosen = new Map<string, CalendarEvent>();
  for (const event of events) {
    if (
      event.availabilityOnly ||
      !allowed.has(JSON.stringify([event.accountId, event.calendarId])) ||
      event.responseStatus === "declined"
    )
      continue;
    if (
      settings.notificationCalendars[event.calendarId]?.enabled === false ||
      (event.allDay && !settings.reminders.includeAllDay)
    )
      continue;
    const identity = JSON.stringify([
      event.calendarId,
      event.eventId,
      event.start,
    ]);
    const previous = chosen.get(identity);
    if (
      !previous ||
      Date.parse(event.updatedAt) > Date.parse(previous.updatedAt)
    )
      chosen.set(identity, event);
  }
  const result: Omit<ReminderJob, "id" | "status">[] = [];
  for (const event of chosen.values()) {
    const policy = reminderPolicy(settings, event.calendarId);
    const zone = displayTimeZone(settings.primaryTimeZone);
    const start = event.allDay
      ? Temporal.PlainDate.from(event.start)
          .toZonedDateTime({
            timeZone: zone,
            plainTime: `${String(settings.reminders.allDayHour).padStart(2, "0")}:00`,
          })
          .toInstant()
      : Temporal.Instant.from(event.start);
    const end = event.allDay
      ? Temporal.PlainDate.from(event.end).toZonedDateTime(zone).toInstant()
      : Temporal.Instant.from(event.end);
    if (
      end.epochMilliseconds <= now.getTime() ||
      start.epochMilliseconds >
        now.getTime() + 14 * 86400_000 + Math.max(...policy.offsets) * 60_000
    )
      continue;
    for (const offset of policy.offsets) {
      const due = start.subtract({ minutes: offset });
      if (due.epochMilliseconds > now.getTime() + 14 * 86400_000) continue;
      if (
        due.epochMilliseconds <
        now.getTime() - settings.reminders.graceMinutes * 60_000
      )
        continue;
      result.push({
        key: JSON.stringify([
          event.calendarId,
          event.eventId,
          start.toString(),
          offset,
        ]),
        event,
        offset,
        startAt: start.toString(),
        endAt: end.toString(),
        dueAt: due.toString(),
      });
    }
  }
  return result
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
    .slice(0, 5000);
}
