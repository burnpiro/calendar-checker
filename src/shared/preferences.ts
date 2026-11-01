import { z } from "zod";

export function isTimeZone(value: string): boolean {
  if (value === "device") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const appearanceDefaults = {
  webOAuthClientId: import.meta.env?.WXT_GOOGLE_WEB_CLIENT_ID?.trim() ?? "",
  syncIntervalMinutes: 5,
  refreshOnOpen: true,
  cachePastMonths: 2,
  cacheFutureMonths: 6,
  defaultView: "month" as const,
  weekStartsOn: 1,
  showWeekends: true,
  timeFormat: "24h" as const,
  theme: "system" as const,
  density: "comfortable" as const,
  weekStartHour: 7,
  weekEndHour: 22,
  primaryTimeZone: "device",
  calendarVisibility: {} as Record<string, boolean>,
};

const fields = {
  webOAuthClientId: z
    .string()
    .max(200)
    .refine(
      (value) =>
        value === "" ||
        /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value),
      "Use the public Web application client ID, not a client secret.",
    ),
  syncIntervalMinutes: z.number().int().min(1).max(1440),
  refreshOnOpen: z.boolean(),
  cachePastMonths: z.number().int().min(0).max(12),
  cacheFutureMonths: z.number().int().min(0).max(12),
  connectionCheckMinutes: z.number().int().min(1).max(1440),
  staleAfterMinutes: z.number().int().min(1).max(10080),
  defaultView: z.enum(["month", "week"]),
  weekStartsOn: z.number().int().min(0).max(6),
  showWeekends: z.boolean(),
  timeFormat: z.enum(["12h", "24h"]),
  theme: z.enum(["system", "light", "dark"]),
  density: z.enum(["comfortable", "compact"]),
  weekStartHour: z.number().int().min(0).max(23),
  weekEndHour: z.number().int().min(1).max(24),
  primaryTimeZone: z
    .string()
    .max(100)
    .refine(isTimeZone, "Choose a valid IANA time zone."),
  calendarVisibility: z.record(z.string().max(1000), z.boolean()),
};
const completeSettings = z
  .object(fields)
  .refine((settings) => settings.weekStartHour < settings.weekEndHour, {
    message: "Week view must end after it starts.",
    path: ["weekEndHour"],
  });

// Add new settings defaults to old records. Existing required auth timing settings
// remain required, and corrupt/unsupported stores are still rejected.
export const settingsSchema = z.preprocess(
  (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...appearanceDefaults, ...value }
      : value,
  completeSettings,
);
export const settingsPatchSchema = z.object(fields).partial().strict();
export type Settings = z.output<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export const DEFAULT_SETTINGS: Settings = {
  connectionCheckMinutes: 5,
  staleAfterMinutes: 15,
  ...appearanceDefaults,
};

export function calendarKey(accountId: string, calendarId: string): string {
  return JSON.stringify([accountId, calendarId]);
}

export function displayTimeZone(preference: string): string {
  return preference === "device"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : preference;
}
