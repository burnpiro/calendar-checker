import { z } from "zod";
import { saveEventSchema } from "../calendar/write-model";
import { eventSchema, type CalendarEvent } from "../calendar/model";
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
  "https://www.googleapis.com/auth/calendar.events",
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
  "account-already-connected",
  "chooser-setup-required",
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
  "event-conflict",
  "event-readonly",
  "pending-writes",
  "event-gone",
  "notification-denied",
  "sound-invalid",
  "sound-in-use",
  "reminder-ended",
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
  eventsWriteGranted: z.boolean().optional(),
  authMethod: z.literal("web").optional(),
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
    "event-write",
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
  z.object({ type: z.literal("REFRESH_REMINDERS") }),
  z.object({
    type: z.literal("REMINDER_ACTION"),
    id: z.uuid(),
    action: z.enum(["dismiss", "snooze"]),
    minutes: z.number().int().min(1).max(1440).optional(),
  }),
  z.object({ type: z.literal("TEST_NOTIFICATION") }),
  z.object({
    type: z.literal("PREVIEW_SOUND"),
    id: z.union([z.literal("builtin"), z.uuid()]),
    volume: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("IMPORT_SOUND"),
    name: z.string().trim().min(1).max(100),
    mime: z.enum([
      "audio/wav",
      "audio/mpeg",
      "audio/ogg",
      "audio/mp4",
      "audio/webm",
    ]),
    data: z.string().min(1).max(7_000_000),
  }),
  z.object({ type: z.literal("REMOVE_SOUND"), id: z.uuid() }),
  saveEventSchema,
  z.object({
    type: z.literal("PREPARE_EDIT"),
    key: z.string().min(1),
    scope: z.enum(["event", "series"]),
  }),
  z.object({
    type: z.literal("DELETE_EVENT"),
    id: z.uuid(),
    base: eventSchema,
    scope: z.enum(["event", "series"]),
    sendUpdates: z.enum(["all", "none"]),
  }),
  z.object({ type: z.literal("RETRY_WRITE"), id: z.uuid() }),
  z.object({ type: z.literal("DISCARD_WRITE"), id: z.uuid() }),
  z.object({
    type: z.literal("RESOLVE_WRITE"),
    id: z.uuid(),
    choice: z.enum(["google", "mine"]),
  }),
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
  | {
      ok: true;
      state: Snapshot;
      diagnostics?: DiagnosticsReport;
      edit?: CalendarEvent;
    }
  | { ok: false; error: { code: ErrorCode; message: string } };

export function needsReconnect(account: Account): boolean {
  return account.enabled && account.status === "reconnect";
}
