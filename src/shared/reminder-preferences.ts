import { z } from "zod";
import { isTimeZone } from "./time-zones";
const minutes = z
  .array(z.number().int().min(0).max(40320))
  .min(1)
  .max(5)
  .refine(
    (a) => new Set(a).size === a.length,
    "Choose distinct reminder times.",
  );
const soundId = z.union([z.literal("builtin"), z.uuid()]);
export const reminderSchema = z.object({
  desktop: z.boolean(),
  sound: z.boolean(),
  volume: z.number().min(0).max(1),
  soundId,
  offsets: minutes,
  snoozePresets: z
    .array(z.number().int().min(1).max(1440))
    .min(1)
    .max(5)
    .refine((a) => new Set(a).size === a.length),
  privacy: z.enum(["details", "title", "private"]),
  missed: z.enum(["deliver", "skip"]),
  graceMinutes: z.number().int().min(1).max(1440),
  includeAllDay: z.boolean(),
  allDayHour: z.number().int().min(0).max(23),
});
export const dndSchema = z.object({
  manual: z.boolean(),
  until: z.iso.datetime().nullable(),
  scheduleEnabled: z.boolean(),
  timeZone: z.string().max(100).refine(isTimeZone),
  policy: z.enum(["skip", "defer"]),
  rules: z
    .array(
      z.object({
        days: z
          .array(z.number().int().min(1).max(7))
          .min(1)
          .max(7)
          .refine((a) => new Set(a).size === a.length),
        start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      }),
    )
    .max(7),
});
export const notificationCalendarsSchema = z.record(
  z.string().min(1).max(1000),
  z.object({
    enabled: z.boolean(),
    offsets: minutes.optional(),
    soundId: soundId.optional(),
    desktop: z.boolean().optional(),
    sound: z.boolean().optional(),
  }),
);
export const reminderDefaults: z.infer<typeof reminderSchema> = {
  desktop: false,
  sound: false,
  volume: 0.6,
  soundId: "builtin",
  offsets: [10],
  snoozePresets: [5, 10, 15],
  privacy: "details",
  missed: "deliver",
  graceMinutes: 60,
  includeAllDay: false,
  allDayHour: 9,
};
export const dndDefaults: z.infer<typeof dndSchema> = {
  manual: false,
  until: null,
  scheduleEnabled: false,
  timeZone: "device",
  policy: "skip",
  rules: [{ days: [1, 2, 3, 4, 5, 6, 7], start: "22:00", end: "08:00" }],
};
export type ReminderPreferences = z.infer<typeof reminderSchema>;
export type DndPreferences = z.infer<typeof dndSchema>;
