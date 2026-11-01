import { z } from "zod";
import { Temporal } from "temporal-polyfill";
import {
  errorCodeSchema,
  failureDetailsSchema,
  type Settings,
} from "../shared/model";
import { calendarKey } from "../shared/preferences";

export const syncStateSchema = z.object({
  key: z.string(),
  accountId: z.string(),
  calendarId: z.string(),
  syncToken: z.string().optional(),
  running: z.boolean(),
  invalidated: z.boolean(),
  failures: z.number().int().nonnegative(),
  lastAttemptAt: z.iso.datetime().optional(),
  lastCheckedAt: z.iso.datetime().optional(),
  retryAt: z.iso.datetime().optional(),
  errorCode: errorCodeSchema.optional(),
  errorDetails: failureDetailsSchema.optional(),
});
export type CalendarSyncState = z.infer<typeof syncStateSchema>;
export const cachedRangeSchema = z.object({
  key: z.string(),
  accountId: z.string(),
  calendarId: z.string(),
  kind: z.enum(["home", "browse"]),
  start: z.string(),
  end: z.string(),
  eventKeys: z.array(z.string()),
  fetchedAt: z.iso.datetime(),
  validatedAt: z.iso.datetime(),
});
export type CachedRange = z.infer<typeof cachedRangeSchema>;
export type PublicSyncState = Omit<CalendarSyncState, "syncToken">;
export type Coverage = Omit<CachedRange, "eventKeys">;
export interface SyncMetadata {
  states: PublicSyncState[];
  ranges: Coverage[];
  failed: boolean;
}
export interface DateRange {
  start: string;
  end: string;
}
export function emptySyncState(
  accountId: string,
  calendarId: string,
): CalendarSyncState {
  return {
    key: calendarKey(accountId, calendarId),
    accountId,
    calendarId,
    running: false,
    invalidated: false,
    failures: 0,
  };
}
export function monthRange(
  month: string,
  before: number,
  after: number,
): DateRange {
  const first = Temporal.PlainDate.from(month);
  if (first.day !== 1) throw new Error("Expected month boundary");
  return {
    start: first.subtract({ months: before }).toString(),
    end: first.add({ months: after + 1 }).toString(),
  };
}
export function homeRange(now: Date, settings: Settings): DateRange {
  return monthRange(
    now.toISOString().slice(0, 7) + "-01",
    settings.cachePastMonths,
    settings.cacheFutureMonths,
  );
}
export function containsRange(outer: DateRange, inner: DateRange): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}
export function requestBounds(range: DateRange): DateRange {
  // UTC padding covers every civil time zone and all-day boundary semantics.
  return {
    start:
      Temporal.PlainDate.from(range.start).subtract({ days: 2 }).toString() +
      "T00:00:00Z",
    end:
      Temporal.PlainDate.from(range.end).add({ days: 2 }).toString() +
      "T00:00:00Z",
  };
}
export function readableCalendar(role: string): boolean {
  return ["reader", "writer", "writerWithoutPrivateAccess", "owner"].includes(
    role,
  );
}
