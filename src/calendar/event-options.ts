import { z } from "zod";

// Google event color IDs; bundled swatches also work while offline.
export const EVENT_COLORS = [
  ["1", "Lavender", "#7986cb"],
  ["2", "Sage", "#33b679"],
  ["3", "Grape", "#8e24aa"],
  ["4", "Flamingo", "#e67c73"],
  ["5", "Banana", "#f6bf26"],
  ["6", "Tangerine", "#f4511e"],
  ["7", "Peacock", "#039be5"],
  ["8", "Graphite", "#616161"],
  ["9", "Blueberry", "#3f51b5"],
  ["10", "Basil", "#0b8043"],
  ["11", "Tomato", "#d50000"],
] as const;
export const eventColorSchema = z.string().regex(/^(|[1-9]|10|11)$/);
export const googleReminderSchema = z.object({
  method: z.enum(["popup", "email"]),
  minutes: z.number().int().min(0).max(40320),
});
export const eventRemindersSchema = z
  .object({
    useDefault: z.boolean(),
    overrides: z.array(googleReminderSchema).max(5).optional(),
  })
  .refine((r) => !r.useDefault || !r.overrides?.length, {
    message: "Use calendar defaults or custom reminders, not both.",
  });
export const attendeeSchema = z.object({
  email: z.email().optional(),
  displayName: z.string().max(1024).optional(),
  id: z.string().optional(),
  self: z.boolean().optional(),
  organizer: z.boolean().optional(),
  resource: z.boolean().optional(),
  optional: z.boolean().optional(),
  responseStatus: z
    .enum(["needsAction", "declined", "tentative", "accepted"])
    .optional(),
  comment: z.string().optional(),
  additionalGuests: z.number().int().nonnegative().optional(),
});
export const draftAttendeesSchema = z
  .array(attendeeSchema.extend({ email: z.email() }))
  .max(200)
  .refine(
    (rows) =>
      new Set(rows.map((r) => r.email.toLowerCase())).size === rows.length,
    "Guest email addresses must be unique.",
  );
export const availabilitySchema = z.enum(["opaque", "transparent"]);
export const visibilitySchema = z.enum([
  "default",
  "public",
  "private",
  "confidential",
]);
export function eventColor(id: string | undefined, fallback: string) {
  return EVENT_COLORS.find(([key]) => key === id)?.[2] ?? fallback;
}
