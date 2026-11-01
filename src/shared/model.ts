import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  settingsSchema,
  settingsPatchSchema,
  type Settings,
} from "./preferences";
export { DEFAULT_SETTINGS, settingsSchema } from "./preferences";
export type { Settings, SettingsPatch } from "./preferences";

export const STORAGE_KEY = "calendar-checker.state.v1";
export const AUTH_ALARM = "calendar-checker.auth-check";
export const SYNC_ALARM = "calendar-checker.event-sync";
export const SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

export const calendarSchema = z.object({
  id: z.string().min(1),
  summary: z.string(),
  accessRole: z.string(),
  primary: z.boolean(),
  timeZone: z.string().optional(),
  backgroundColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});
export type CalendarSummary = z.infer<typeof calendarSchema>;

export const errorCodeSchema = z.enum([
  "setup-required",
  "auth-cancelled",
  "reconnect-required",
  "permission-required",
  "account-mismatch",
  "network",
  "rate-limited",
  "api-disabled",
  "api-error",
  "invalid-response",
  "unknown-account",
  "invalid-request",
  "storage-error",
  "unexpected",
  "calendar-unavailable",
  "sync-expired",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

// Safe, fixed diagnostic fields only. Never store raw provider messages or request headers.
export const failureDetailsSchema = z.object({
  stage: z
    .enum([
      "authorization",
      "account-details",
      "calendar-list",
      "calendar-events",
    ])
    .optional(),
  networkFailure: z.enum(["timeout", "offline", "request-failed"]).optional(),
  browserNetworkCode: z.number().int().min(-999).max(-1).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  retryAfterSeconds: z.number().int().min(1).max(86400).optional(),
});
export type FailureDetails = z.infer<typeof failureDetailsSchema>;

export const accountSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  enabled: z.boolean(),
  status: z.enum(["connected", "reconnect", "offline", "error"]),
  calendars: z.array(calendarSchema),
  connectedAt: z.string(),
  lastCheckedAt: z.string().nullable(),
  lastSuccessfulAt: z.string().nullable(),
  errorCode: errorCodeSchema.optional(),
  errorDetails: failureDetailsSchema.optional(),
  eventsReadGranted: z.boolean().optional(),
});
export type Account = z.infer<typeof accountSchema>;

export const diagnosticSchema = z.object({
  at: z.string(),
  action: z.enum([
    "connect",
    "reconnect",
    "check",
    "fresh-token",
    "toggle",
    "remove",
    "settings",
    "event-sync",
  ]),
  outcome: z.enum(["success", "failure"]),
  code: errorCodeSchema.optional(),
  details: failureDetailsSchema.optional(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const storeSchema = z.object({
  schemaVersion: z.literal(1),
  accounts: z.array(accountSchema),
  settings: settingsSchema,
  diagnostics: z.array(diagnosticSchema).max(50),
});
export type Store = z.infer<typeof storeSchema>;
export function emptyStore(): Store {
  return {
    schemaVersion: 1,
    accounts: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    diagnostics: [],
  };
}

export interface Configuration {
  extensionId: string;
  oauthConfigured: boolean;
}
export interface Snapshot extends Configuration {
  accounts: Account[];
  settings: Settings;
}
export interface DiagnosticsReport {
  formatVersion: 1;
  generatedAt: string;
  extensionId: string;
  oauthConfigured: boolean;
  accounts: { total: number; enabled: number; reconnectRequired: number };
  settings: Pick<
    Settings,
    | "connectionCheckMinutes"
    | "staleAfterMinutes"
    | "syncIntervalMinutes"
    | "cachePastMonths"
    | "cacheFutureMonths"
    | "refreshOnOpen"
  >;
  eventSync?: {
    calendars: number;
    cachedRanges: number;
    failedCalendars: number;
    runningCalendars: number;
  };
  checks: Diagnostic[];
  liveMultiAccountVerification: "requires-manual-validation";
}

export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GET_STATE") }),
  z.object({ type: z.literal("CONNECT") }),
  z.object({ type: z.literal("CHECK_ALL") }),
  z.object({ type: z.literal("GET_DIAGNOSTICS") }),
  z.object({ type: z.literal("RECONNECT"), accountId: z.string().min(1) }),
  z.object({
    type: z.literal("CHECK"),
    accountId: z.string().min(1),
    freshToken: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("SET_ENABLED"),
    accountId: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal("REMOVE"), accountId: z.string().min(1) }),
  z.object({
    type: z.literal("UPDATE_SETTINGS"),
    settings: settingsPatchSchema,
  }),
  z.object({
    type: z.literal("SYNC_EVENTS"),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}-01$/)
      .optional(),
    reason: z.enum(["view", "open", "manual"]).default("manual"),
    accountId: z.string().min(1).optional(),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export type Reply =
  | { ok: true; state: Snapshot; diagnostics?: DiagnosticsReport }
  | { ok: false; error: { code: ErrorCode; message: string } };

export function needsReconnect(account: Account): boolean {
  return account.enabled && account.status === "reconnect";
}
