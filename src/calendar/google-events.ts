import { z } from "zod";
import {
  attendeeSchema,
  eventRemindersSchema,
  availabilitySchema,
  visibilitySchema,
  eventColor,
} from "./event-options";
import { Temporal } from "temporal-polyfill";
import type { Account, CalendarSummary } from "../shared/model";
import { AppError } from "../shared/errors";
import { isTimeZone } from "../shared/preferences";
import {
  EVENT_TYPES,
  eventKey,
  eventSchema,
  type CalendarEvent,
} from "./model";

const point = z.object({
  date: z.string().optional(),
  dateTime: z.string().optional(),
  timeZone: z.string().optional(),
});
export const googleEventSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: point.optional(),
  end: point.optional(),
  eventType: z.string().optional(),
  etag: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  guestsCanModify: z.boolean().optional(),
  locked: z.boolean().optional(),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
  updated: z.string().optional(),
  recurringEventId: z.string().optional(),
  originalStartTime: point.optional(),
  iCalUID: z.string().optional(),
  htmlLink: z.string().optional(),
  hangoutLink: z.string().optional(),
  organizer: z
    .object({
      self: z.boolean().optional(),
      email: z.string().optional(),
      displayName: z.string().optional(),
    })
    .optional(),
  colorId: z.string().nullable().optional(),
  transparency: availabilitySchema.optional(),
  visibility: visibilitySchema.optional(),
  reminders: eventRemindersSchema.optional(),
  attendees: z.array(attendeeSchema).optional(),
  attendeesOmitted: z.boolean().optional(),
  guestsCanInviteOthers: z.boolean().optional(),
  guestsCanSeeOtherGuests: z.boolean().optional(),
  conferenceData: z
    .object({
      conferenceSolution: z
        .object({ key: z.object({ type: z.string().optional() }).optional() })
        .optional(),
      createRequest: z
        .object({
          status: z
            .object({ statusCode: z.enum(["pending", "success", "failure"]) })
            .optional(),
        })
        .optional(),
      entryPoints: z
        .array(
          z.object({ entryPointType: z.string(), uri: z.string().optional() }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;

function safeLink(value?: string): string | undefined {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function normalizeGoogleEvent(
  raw: GoogleEvent,
  account: Pick<Account, "id" | "email">,
  calendar: CalendarSummary,
  fallbackZone: string,
  at: string,
  excludeDescription = false,
): CalendarEvent | null {
  if (raw.status === "cancelled") return null;
  try {
    if (!raw.start || !raw.end) throw new Error();
    const zone = [
      raw.start.timeZone,
      calendar.timeZone,
      fallbackZone,
      "UTC",
    ].find((value) => value && value !== "device" && isTimeZone(value))!;
    const allDay = Boolean(raw.start.date);
    const instant = (value: z.infer<typeof point>) => {
      if (!value.dateTime) throw new Error();
      try {
        return Temporal.Instant.from(value.dateTime).toString();
      } catch {
        return Temporal.PlainDateTime.from(value.dateTime)
          .toZonedDateTime(zone)
          .toInstant()
          .toString();
      }
    };
    return eventSchema.parse({
      key: eventKey(account.id, calendar.id, raw.id),
      source: "google",
      accountId: account.id,
      calendarId: calendar.id,
      eventId: raw.id,
      title: raw.summary || "Busy",
      description: excludeDescription ? "" : (raw.description ?? ""),
      ...(excludeDescription ? { descriptionOmitted: true } : {}),
      location: raw.location ?? "",
      calendarName: calendar.summary,
      accountName: account.email,
      color: eventColor(
        raw.colorId ?? undefined,
        calendar.backgroundColor ?? "#7765d8",
      ),
      colorId: raw.colorId ?? undefined,
      transparency: raw.transparency,
      visibility: raw.visibility,
      reminders: raw.reminders,
      attendees: raw.attendees ?? [],
      attendeesOmitted: raw.attendeesOmitted,
      guestsCanInviteOthers: raw.guestsCanInviteOthers,
      guestsCanSeeOtherGuests: raw.guestsCanSeeOtherGuests,
      conferenceType: raw.conferenceData?.conferenceSolution?.key?.type,
      conferenceStatus: raw.conferenceData?.createRequest?.status?.statusCode,
      timeZone: zone,
      eventType: EVENT_TYPES.includes(
        raw.eventType as (typeof EVENT_TYPES)[number],
      )
        ? raw.eventType
        : "default",
      allDay,
      start: allDay ? raw.start.date : instant(raw.start),
      end: allDay ? raw.end.date : instant(raw.end),
      etag: raw.etag,
      recurrence: raw.recurrence,
      organizerSelf: raw.organizer?.self,
      guestsCanModify: raw.guestsCanModify,
      locked: raw.locked,
      updatedAt: raw.updated
        ? Temporal.Instant.from(raw.updated).toString()
        : at,
      recurringEventId: raw.recurringEventId,
      originalStart:
        raw.originalStartTime?.date ?? raw.originalStartTime?.dateTime,
      iCalUID: raw.iCalUID,
      htmlLink: safeLink(raw.htmlLink),
      meetingLink: safeLink(
        raw.hangoutLink ??
          raw.conferenceData?.entryPoints?.find(
            (p) => p.entryPointType === "video",
          )?.uri,
      ),
      organizer: raw.organizer?.displayName ?? raw.organizer?.email,
      attendeeCount: raw.attendees?.length,
      responseStatus: raw.attendees?.find((attendee) => attendee.self)
        ?.responseStatus,
    });
  } catch {
    throw new AppError("invalid-response", { stage: "calendar-events" });
  }
}
