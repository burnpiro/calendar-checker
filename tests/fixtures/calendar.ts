import { Temporal } from "temporal-polyfill";
import {
  eventKey,
  eventSchema,
  type CalendarEvent,
  type EventType,
} from "../../src/calendar/model";

export const FIXTURE_CALENDARS = [
  {
    id: "fixture-work",
    accountId: "fixture-work-account",
    name: "Work",
    color: "#7765d8",
    accountName: "Work · fixture account",
  },
  {
    id: "fixture-personal",
    accountId: "fixture-personal-account",
    name: "Personal",
    color: "#348e81",
    accountName: "Personal · fixture account",
  },
  {
    id: "fixture-birthdays",
    accountId: "fixture-personal-account",
    name: "Birthdays",
    color: "#c58a35",
    accountName: "Personal · fixture account",
  },
] as const;

export function makeFixtureMonth(
  month: string,
  timeZone: string,
): CalendarEvent[] {
  const first = Temporal.PlainDate.from(month);
  const rows: CalendarEvent[] = [];
  function add(
    day: Temporal.PlainDate,
    title: string,
    calendar: (typeof FIXTURE_CALENDARS)[number],
    hour: number,
    duration: number,
    eventType: EventType = "default",
    allDay = false,
    location = "",
  ) {
    const eventId = `${day}-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    const start = day.toZonedDateTime({
      timeZone,
      plainTime: Temporal.PlainTime.from({ hour }),
    });
    rows.push(
      eventSchema.parse({
        key: eventKey(calendar.accountId, calendar.id, eventId),
        source: "google",
        accountId: calendar.accountId,
        calendarId: calendar.id,
        eventId,
        title,
        calendarName: calendar.name,
        accountName: calendar.accountName,
        color: calendar.color,
        eventType,
        allDay,
        location,
        description: "Fictional provider event used only by automated tests.",
        start: allDay ? day.toString() : start.toInstant().toString(),
        end: allDay
          ? day.add({ days: Math.ceil(duration / 24) }).toString()
          : start
              .add({ minutes: duration * 60 })
              .toInstant()
              .toString(),
        timeZone,
        updatedAt: new Date().toISOString(),
      }),
    );
  }
  for (let index = 0; index < first.daysInMonth; index++) {
    const day = first.add({ days: index });
    if (day.dayOfWeek === 1) {
      add(
        day,
        "Weekly planning",
        FIXTURE_CALENDARS[0],
        9,
        1,
        "default",
        false,
        "Studio / video call",
      );
      add(day, "Deep work", FIXTURE_CALENDARS[0], 11, 2, "focusTime");
    }
    if (day.dayOfWeek === 2) {
      add(
        day,
        "Design review",
        FIXTURE_CALENDARS[0],
        10,
        1.5,
        "default",
        false,
        "Meeting room 02",
      );
      add(day, "Evening run", FIXTURE_CALENDARS[1], 18, 1);
    }
    if (day.dayOfWeek === 3) {
      add(day, "Project catch-up", FIXTURE_CALENDARS[0], 14, 1);
      if (day.day < 15)
        add(
          day,
          "Working from home",
          FIXTURE_CALENDARS[0],
          0,
          24,
          "workingLocation",
          true,
        );
    }
    if (day.dayOfWeek === 4) {
      add(
        day,
        "Team lunch",
        FIXTURE_CALENDARS[0],
        12,
        1,
        "default",
        false,
        "The corner café",
      );
      add(day, "Read & recharge", FIXTURE_CALENDARS[1], 19, 1);
    }
    if (day.dayOfWeek === 5)
      add(day, "Wrap-up & next steps", FIXTURE_CALENDARS[0], 15, 1);
    if (day.dayOfWeek === 6 && day.day < 22)
      add(
        day,
        "Coffee with friends",
        FIXTURE_CALENDARS[1],
        11,
        1.5,
        "default",
        false,
        "Neighbourhood café",
      );
    if (day.day === 5)
      add(
        day,
        "Maya’s birthday",
        FIXTURE_CALENDARS[2],
        0,
        24,
        "birthday",
        true,
      );
    if (day.day === 12)
      add(
        day,
        "Train to Kraków",
        FIXTURE_CALENDARS[1],
        8,
        2,
        "fromGmail",
        false,
        "Central station",
      );
    if (day.day === 23)
      add(
        day,
        "A day to unplug",
        FIXTURE_CALENDARS[1],
        0,
        24,
        "outOfOffice",
        true,
      );
  }
  return rows;
}
