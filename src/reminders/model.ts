import { z } from "zod";
import { eventSchema } from "../calendar/model";
export const REMINDER_ALARM = "calendar-checker.reminder-next";
export const REMINDER_TICK = "calendar-checker.reminder-tick";
export const jobSchema = z.object({
  key: z.string(),
  id: z.uuid(),
  event: eventSchema,
  offset: z.number().int().min(0).max(40320),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  dueAt: z.iso.datetime(),
  status: z.enum([
    "scheduled",
    "delivering",
    "delivered",
    "snoozed",
    "dismissed",
    "missed",
    "cancelled",
  ]),
  snoozedAt: z.iso.datetime().optional(),
  deliveredAt: z.iso.datetime().optional(),
  closed: z.boolean().optional(),
  soundAttempted: z.boolean().optional(),
  desktopDone: z.boolean().optional(),
  error: z.string().optional(),
});
export type ReminderJob = z.infer<typeof jobSchema>;
export interface LocalSound {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  duration: number;
  blob: Blob;
  createdAt: string;
}
export interface SoundInfo {
  id: string;
  name: string;
  bytes: number;
  duration: number;
}
