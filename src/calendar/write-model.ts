import { z } from "zod";
import {
  eventColorSchema,
  eventRemindersSchema,
  draftAttendeesSchema,
  attendeeSchema,
  availabilitySchema,
  visibilitySchema,
} from "./event-options";
import { Temporal } from "temporal-polyfill";
import { isTimeZone } from "../shared/preferences";
import { eventSchema, type CalendarEvent } from "./model";
import type { Account } from "../shared/model";

export const draftSchema = z
  .object({
    title: z.string().trim().min(1).max(1024),
    description: z.string().max(20000),
    location: z.string().max(2048),
    allDay: z.boolean(),
    start: z.string().max(64),
    end: z.string().max(64),
    timeZone: z
      .string()
      .refine((zone) => zone !== "device" && isTimeZone(zone)),
    colorId: eventColorSchema.optional(),
    transparency: availabilitySchema.optional(),
    visibility: visibilitySchema.optional(),
    reminders: eventRemindersSchema.optional(),
    attendees: draftAttendeesSchema.optional(),
    guestsCanModify: z.boolean().optional(),
    guestsCanInviteOthers: z.boolean().optional(),
    guestsCanSeeOtherGuests: z.boolean().optional(),
    conference: z.enum(["keep", "create", "remove"]).optional(),
    recurrence: z.array(z.string().max(2048)).max(20).default([]),
  })
  .superRefine((draft, ctx) => {
    try {
      if (draft.allDay) {
        for (const point of [draft.start, draft.end]) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(point)) throw new Error();
          Temporal.PlainDate.from(point, { overflow: "reject" });
        }
        if (draft.end <= draft.start) throw new Error();
      } else if (Temporal.Instant.compare(draft.end, draft.start) <= 0)
        throw new Error();
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Choose valid dates with the end after the start.",
        path: ["end"],
      });
    }
    if (
      draft.recurrence.some(
        (rule) =>
          !/^(RRULE|EXRULE|RDATE|EXDATE)[:;]/.test(rule) || /[\r\n]/.test(rule),
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid recurrence rule.",
        path: ["recurrence"],
      });
    }
  });
export type EventDraft = z.infer<typeof draftSchema>;
export type EditScope = "event" | "series";
export const saveEventSchema = z.object({
  type: z.literal("SAVE_EVENT"),
  accountId: z.string().min(1),
  calendarId: z.string().min(1),
  // This stable request ID makes a repeated message safe after a lost reply.
  id: z.uuid(),
  scope: z.enum(["event", "series"]),
  base: eventSchema.optional(),
  draft: draftSchema,
  openAfterSave: z.boolean().optional(),
  sendUpdates: z.enum(["all", "none"]),
});
export type SaveEvent = z.infer<typeof saveEventSchema>;
export interface PendingWrite {
  id: string;
  accountId: string;
  calendarId: string;
  eventId: string;
  scope: EditScope;
  kind: "create" | "update" | "delete";
  base?: CalendarEvent;
  event: CalendarEvent;
  patch: EventBody;
  openAfterSave?: boolean;
  sendUpdates: "all" | "none";
  status:
    "queued" | "sending" | "retry" | "conflict" | "failed" | "awaiting-sync";
  createdAt: string;
  attempted: boolean;
  attempts: number;
  retryAt?: string;
  error?: string;
  remote?: CalendarEvent;
}
export interface EditBase {
  key: string;
  event: CalendarEvent;
}
export interface EventBody {
  colorId?: string | null;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  reminders?: z.infer<typeof eventRemindersSchema>;
  attendees?: z.infer<typeof attendeeSchema>[];
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: { type: "hangoutsMeet" };
    };
  } | null;
  summary?: string;
  description?: string;
  location?: string;
  start?: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  };
  end?: {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
  };
  recurrence?: string[];
  id?: string;
  extendedProperties?: { private: Record<string, string> };
}
const bodyPointSchema = z.object({
  date: z.string().nullable().optional(),
  dateTime: z.string().nullable().optional(),
  timeZone: z.string().nullable().optional(),
});
export const pendingWriteSchema: z.ZodType<PendingWrite> = z
  .object({
    id: z.uuid(),
    accountId: z.string().min(1),
    calendarId: z.string().min(1),
    eventId: z.string().min(1),
    scope: z.enum(["event", "series"]),
    kind: z.enum(["create", "update", "delete"]),
    base: eventSchema.optional(),
    event: eventSchema,
    patch: z.object({
      colorId: z.string().nullable().optional(),
      transparency: availabilitySchema.optional(),
      visibility: visibilitySchema.optional(),
      reminders: eventRemindersSchema.optional(),
      attendees: z.array(attendeeSchema).optional(),
      guestsCanModify: z.boolean().optional(),
      guestsCanInviteOthers: z.boolean().optional(),
      guestsCanSeeOtherGuests: z.boolean().optional(),
      conferenceData: z
        .object({
          createRequest: z.object({
            requestId: z.string().min(1),
            conferenceSolutionKey: z.object({
              type: z.literal("hangoutsMeet"),
            }),
          }),
        })
        .nullable()
        .optional(),
      summary: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      start: bodyPointSchema.optional(),
      end: bodyPointSchema.optional(),
      recurrence: z.array(z.string()).optional(),
      id: z.string().optional(),
      extendedProperties: z
        .object({ private: z.record(z.string(), z.string()) })
        .optional(),
    }),
    openAfterSave: z.boolean().optional(),
    sendUpdates: z.enum(["all", "none"]),
    status: z.enum([
      "queued",
      "sending",
      "retry",
      "conflict",
      "failed",
      "awaiting-sync",
    ]),
    createdAt: z.iso.datetime(),
    attempted: z.boolean(),
    attempts: z.number().int().nonnegative(),
    retryAt: z.iso.datetime().optional(),
    error: z.string().max(4096).optional(),
    remote: eventSchema.optional(),
  })
  .refine(
    (row) =>
      row.event.accountId === row.accountId &&
      row.event.calendarId === row.calendarId &&
      row.event.eventId === row.eventId &&
      (row.kind === "create" ||
        Boolean(
          row.base?.etag &&
          row.base.accountId === row.accountId &&
          row.base.calendarId === row.calendarId &&
          row.base.eventId === row.eventId,
        )),
  );

export function eventDraft(event: CalendarEvent): EventDraft {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    allDay: event.allDay,
    start: event.start,
    end: event.end,
    timeZone: event.timeZone,
    recurrence: event.recurrence ?? [],
    colorId: event.colorId ?? "",
    transparency: event.transparency ?? "opaque",
    visibility: event.visibility ?? "default",
    reminders: event.reminders ?? { useDefault: true },
    ...(event.attendees &&
    !event.attendeesOmitted &&
    event.attendees.length <= 200 &&
    event.attendees.every((a) => a.email)
      ? { attendees: event.attendees as z.infer<typeof draftAttendeesSchema> }
      : {}),
    guestsCanModify: event.guestsCanModify ?? false,
    guestsCanInviteOthers: event.guestsCanInviteOthers ?? true,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests ?? true,
    conference: "keep",
  };
}
export function eventBody(draft: EventDraft): EventBody {
  return {
    summary: draft.title,
    description: draft.description,
    location: draft.location,
    start: draft.allDay
      ? { date: draft.start, dateTime: null, timeZone: null }
      : { date: null, dateTime: draft.start, timeZone: draft.timeZone },
    end: draft.allDay
      ? { date: draft.end, dateTime: null, timeZone: null }
      : { date: null, dateTime: draft.end, timeZone: draft.timeZone },
    recurrence: draft.recurrence,
    ...(draft.colorId !== undefined ? { colorId: draft.colorId || null } : {}),
    ...(draft.transparency !== undefined
      ? { transparency: draft.transparency }
      : {}),
    ...(draft.visibility !== undefined ? { visibility: draft.visibility } : {}),
    ...(draft.reminders ? { reminders: draft.reminders } : {}),
    ...(draft.attendees ? { attendees: draft.attendees } : {}),
    ...(draft.guestsCanModify !== undefined
      ? { guestsCanModify: draft.guestsCanModify }
      : {}),
    ...(draft.guestsCanInviteOthers !== undefined
      ? { guestsCanInviteOthers: draft.guestsCanInviteOthers }
      : {}),
    ...(draft.guestsCanSeeOtherGuests !== undefined
      ? { guestsCanSeeOtherGuests: draft.guestsCanSeeOtherGuests }
      : {}),
  };
}
export function changedBody(base: CalendarEvent, draft: EventDraft): EventBody {
  const before = eventBody(eventDraft(base));
  const after = eventBody(draft);
  const patch: EventBody = {};
  for (const key of [
    "summary",
    "description",
    "location",
    "recurrence",
    "colorId",
    "transparency",
    "visibility",
    "reminders",
    "attendees",
    "guestsCanModify",
    "guestsCanInviteOthers",
    "guestsCanSeeOtherGuests",
  ] as const) {
    if (
      after[key] !== undefined &&
      JSON.stringify(before[key]) !== JSON.stringify(after[key])
    )
      Object.assign(patch, { [key]: after[key] });
  }
  if (
    JSON.stringify(before.start) !== JSON.stringify(after.start) ||
    JSON.stringify(before.end) !== JSON.stringify(after.end)
  ) {
    patch.start = after.start;
    patch.end = after.end;
  }
  return patch;
}
export const writableCalendar = (role: string) =>
  role === "owner" || role === "writer";
export function canEditEvent(
  event: CalendarEvent,
  accounts: Account[],
): boolean {
  const account = accounts.find((a) => a.id === event.accountId && a.enabled);
  return (
    Boolean(
      account?.calendars.some(
        (c) => c.id === event.calendarId && writableCalendar(c.accessRole),
      ),
    ) &&
    !event.availabilityOnly &&
    event.eventType === "default" &&
    !event.locked &&
    (event.organizerSelf !== false || event.guestsCanModify === true)
  );
}
export function sameWriteTarget(
  row: PendingWrite,
  event: CalendarEvent,
): boolean {
  return (
    row.accountId === event.accountId &&
    row.calendarId === event.calendarId &&
    (row.eventId === event.eventId ||
      row.eventId === event.recurringEventId ||
      row.base?.recurringEventId === event.eventId ||
      Boolean(
        row.base?.recurringEventId &&
        row.base.recurringEventId === event.recurringEventId,
      ))
  );
}
/** Pending work is an overlay, never part of a replaceable remote snapshot. */
export function overlayWrites(
  events: CalendarEvent[],
  writes: PendingWrite[],
): CalendarEvent[] {
  const result = new Map(events.map((event) => [event.key, event]));
  for (const row of writes) {
    if (row.kind === "delete") {
      for (const event of result.values())
        if (
          sameWriteTarget(row, event) &&
          (row.scope === "series" || row.eventId === event.eventId)
        )
          result.delete(event.key);
    } else if (row.scope === "series" && row.kind === "update") {
      for (const event of result.values()) {
        if (sameWriteTarget(row, event))
          result.set(event.key, {
            ...event,
            ...Object.fromEntries(
              [
                "colorId",
                "transparency",
                "visibility",
                "reminders",
                "attendees",
                "guestsCanModify",
                "guestsCanInviteOthers",
                "guestsCanSeeOtherGuests",
              ]
                .filter((key) => key in row.patch)
                .map((key) => [key, row.event[key as keyof CalendarEvent]]),
            ),
            ...(row.patch.attendees
              ? { attendeeCount: row.event.attendeeCount }
              : {}),
            ...("conferenceData" in row.patch
              ? {
                  meetingLink: row.event.meetingLink,
                  conferenceType: row.event.conferenceType,
                  conferenceStatus: row.event.conferenceStatus,
                }
              : {}),
            ...(row.patch.colorId !== undefined
              ? { color: row.event.color }
              : {}),
            ...(row.patch.summary !== undefined
              ? { title: row.event.title }
              : {}),
            ...(row.patch.description !== undefined
              ? {
                  description: row.event.description,
                  descriptionOmitted: row.event.descriptionOmitted,
                }
              : {}),
            ...(row.patch.location !== undefined
              ? { location: row.event.location }
              : {}),
          });
      }
    } else result.set(row.event.key, row.event);
  }
  return [...result.values()];
}
