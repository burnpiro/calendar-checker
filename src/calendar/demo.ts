import { Temporal } from "temporal-polyfill";
import {
  eventKey,
  eventSchema,
  type CalendarEvent,
  type EventType,
} from "./model";

export const DEMO_CALENDARS = [
  {
    id: "demo-work",
    accountId: "demo-work-account",
    name: "Work",
    color: "#7765d8",
    accountName: "Work · sample account",
  },
  {
    id: "demo-personal",
    accountId: "demo-personal-account",
    name: "Personal",
    color: "#348e81",
    accountName: "Personal · sample account",
  },
  {
    id: "demo-birthdays",
    accountId: "demo-personal-account",
    name: "Birthdays",
    color: "#c58a35",
    accountName: "Personal · sample account",
  },
] as const;

export function makeDemoMonth(
  month: string,
  timeZone: string,
): CalendarEvent[] {
  const first = Temporal.PlainDate.from(month);
  const rows: CalendarEvent[] = [];
  function add(
    day: Temporal.PlainDate,
    title: string,
    calendar: (typeof DEMO_CALENDARS)[number],
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
        source: "demo",
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
        description:
          "This is a sample event for exploring your calendar. It is stored only on this device and is never sent to Google.",
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
        DEMO_CALENDARS[0],
        9,
        1,
        "default",
        false,
        "Studio / video call",
      );
      add(day, "Deep work", DEMO_CALENDARS[0], 11, 2, "focusTime");
    }
    if (day.dayOfWeek === 2) {
      add(
        day,
        "Design review",
        DEMO_CALENDARS[0],
        10,
        1.5,
        "default",
        false,
        "Meeting room 02",
      );
      add(day, "Evening run", DEMO_CALENDARS[1], 18, 1);
    }
    if (day.dayOfWeek === 3) {
      add(day, "Project catch-up", DEMO_CALENDARS[0], 14, 1);
      if (day.day < 15)
        add(
          day,
          "Working from home",
          DEMO_CALENDARS[0],
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
        DEMO_CALENDARS[0],
        12,
        1,
        "default",
        false,
        "The corner café",
      );
      add(day, "Read & recharge", DEMO_CALENDARS[1], 19, 1);
    }
    if (day.dayOfWeek === 5)
      add(day, "Wrap-up & next steps", DEMO_CALENDARS[0], 15, 1);
    if (day.dayOfWeek === 6 && day.day < 22)
      add(
        day,
        "Coffee with friends",
        DEMO_CALENDARS[1],
        11,
        1.5,
        "default",
        false,
        "Neighbourhood café",
      );
    if (day.day === 5)
      add(day, "Maya’s birthday", DEMO_CALENDARS[2], 0, 24, "birthday", true);
    if (day.day === 12)
      add(
        day,
        "Train to Kraków",
        DEMO_CALENDARS[1],
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
        DEMO_CALENDARS[1],
        0,
        24,
        "outOfOffice",
        true,
      );
  }
  return rows;
}
