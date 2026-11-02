import { z } from "zod";
import { Temporal } from "temporal-polyfill";
import { isTimeZone } from "../shared/preferences";

export const EVENT_TYPES = [
  "default",
  "birthday",
  "fromGmail",
  "focusTime",
  "outOfOffice",
  "workingLocation",
] as const;
export const EVENT_TYPE_NAMES: Record<(typeof EVENT_TYPES)[number], string> = {
  default: "Events",
  birthday: "Birthdays",
  fromGmail: "From Gmail",
  focusTime: "Focus time",
  outOfOffice: "Out of office",
  workingLocation: "Working location",
};
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    try {
      Temporal.PlainDate.from(value);
      return true;
    } catch {
      return false;
    }
  });
const identity = {
  key: z.string(),
  source: z.literal("google"),
  accountId: z.string().min(1),
  calendarId: z.string().min(1),
  eventId: z.string().min(1),
  availabilityOnly: z.literal(true).optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  location: z.string().default(""),
  eventType: z.enum(EVENT_TYPES),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  calendarName: z.string(),
  accountName: z.string(),
  timeZone: z.string().refine((zone) => zone !== "device" && isTimeZone(zone)),
  etag: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  organizerSelf: z.boolean().optional(),
  guestsCanModify: z.boolean().optional(),
  locked: z.boolean().optional(),
  recurringEventId: z.string().optional(),
  originalStart: z.string().optional(),
  iCalUID: z.string().optional(),
  htmlLink: z.url({ protocol: /^https$/ }).optional(),
  meetingLink: z.url({ protocol: /^https$/ }).optional(),
  organizer: z.string().optional(),
  attendeeCount: z.number().int().nonnegative().optional(),
  responseStatus: z.string().optional(),
  updatedAt: z.iso.datetime(),
};
export const eventSchema = z.discriminatedUnion("allDay", [
  z
    .object({
      ...identity,
      allDay: z.literal(true),
      start: dateOnly,
      end: dateOnly,
    })
    .refine((event) => event.end > event.start, {
      message: "All-day end dates are exclusive and must follow the start.",
    }),
  z
    .object({
      ...identity,
      allDay: z.literal(false),
      start: z.iso.datetime(),
      end: z.iso.datetime(),
    })
    .refine(
      (event) => {
        try {
          return Temporal.Instant.compare(event.end, event.start) > 0;
        } catch {
          return false;
        }
      },
      { message: "The event must end after it starts." },
    ),
]);
export type CalendarEvent = z.infer<typeof eventSchema>;
export type EventType = CalendarEvent["eventType"];

export function eventKey(
  accountId: string,
  calendarId: string,
  eventId: string,
): string {
  return JSON.stringify([accountId, calendarId, eventId]);
}
