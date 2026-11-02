import { AppError, asAppError, isReconnectError } from "../shared/errors";
import type { Account, CalendarSummary, Settings } from "../shared/model";
import {
  availabilityWindows,
  busyEvents,
  type BusyInterval,
} from "../calendar/availability";
import { normalizeGoogleEvent } from "../calendar/google-events";
import type { CalendarEvent } from "../calendar/model";
import { EventRepository } from "../calendar/event-repository";
import {
  containsRange,
  homeRange,
  monthRange,
  viewableCalendar,
  requestBounds,
  type CachedRange,
  type CalendarSyncState,
  type DateRange,
} from "../calendar/sync-model";
import type { AuthService } from "./auth-service";
import type { EventGateway } from "./ports";

export interface SyncRequest {
  month?: string;
  reason?: "view" | "open" | "manual" | "background";
  accountId?: string;
}
export class EventSyncService {
  constructor(
    private readonly auth: AuthService,
    private readonly google: EventGateway,
    readonly repository = new EventRepository(),
    private readonly now = () => new Date(),
    private readonly random = Math.random,
  ) {}

  private desired(
    ranges: CachedRange[],
    home: DateRange,
    month?: string,
  ): Array<DateRange & { kind: "home" | "browse" }> {
    const previous = ranges.find((range) => range.kind === "browse");
    const requested = month ? monthRange(month, 1, 1) : undefined;
    const browse =
      requested && !containsRange(home, requested) ? requested : previous;
    return [
      { ...home, kind: "home" },
      ...(browse && !containsRange(home, browse)
        ? [{ start: browse.start, end: browse.end, kind: "browse" as const }]
        : []),
    ];
  }
  private due(
    state: CalendarSyncState,
    ranges: CachedRange[],
    desired: Array<DateRange & { kind: string }>,
    settings: Settings,
    reason: SyncRequest["reason"],
    availability = false,
  ): boolean {
    const now = this.now().getTime();
    if (state.retryAt && Date.parse(state.retryAt) > now) return false;
    const age = state.lastCheckedAt
      ? now - Date.parse(state.lastCheckedAt)
      : Infinity;
    const missing = desired.some(
      (range) =>
        !ranges.some(
          (cached) =>
            cached.kind === range.kind &&
            cached.start === range.start &&
            cached.end === range.end,
        ),
    );
    if (
      (state.dataKind === "freebusy") !== availability ||
      (availability ? !state.lastCheckedAt : !state.syncToken) ||
      reason === "manual" ||
      missing
    )
      return true;
    if (reason === "open")
      return (
        settings.refreshOnOpen &&
        (state.invalidated || Boolean(state.errorCode) || age >= 60_000)
      );
    return (
      state.invalidated ||
      Boolean(state.errorCode) ||
      age >= settings.syncIntervalMinutes * 60_000
    );
  }
  private async fail(state: CalendarSyncState, error: unknown): Promise<void> {
    const safe = asAppError(error);
    const failures = state.failures + 1;
    const base = safe.code === "network" ? 30 : 60;
    const seconds = Math.max(
      safe.details.retryAfterSeconds ?? 0,
      Math.min(
        1800,
        base * 2 ** Math.min(failures - 1, 6) * (0.75 + this.random() * 0.5),
      ),
    );
    await this.repository.putState({
      ...state,
      running: false,
      failures,
      errorCode: safe.code,
      errorDetails: safe.details,
      lastAttemptAt: this.now().toISOString(),
      retryAt: new Date(this.now().getTime() + seconds * 1000).toISOString(),
    });
  }
  private async syncAvailability(
    token: string,
    account: Account,
    calendar: CalendarSummary,
    state: CalendarSyncState,
    desired: Array<DateRange & { kind: "home" | "browse" }>,
  ): Promise<void> {
    const at = this.now().toISOString();
    const ranges: CachedRange[] = [];
    const events = new Map<string, CalendarEvent>();
    for (const range of desired) {
      const intervals: BusyInterval[] = [];
      for (const window of availabilityWindows(requestBounds(range))) {
        intervals.push(
          ...(await this.google.getBusy(
            token,
            calendar.id,
            window.start,
            window.end,
          )),
        );
      }
      const normalized = busyEvents(intervals, account, calendar, at);
      for (const event of normalized) events.set(event.key, event);
      ranges.push({
        ...range,
        key: JSON.stringify([account.id, calendar.id, range.kind]),
        accountId: account.id,
        calendarId: calendar.id,
        eventKeys: normalized.map((event) => event.key),
        fetchedAt: at,
        validatedAt: at,
      });
    }
    await this.repository.commit(
      {
        ...state,
        dataKind: "freebusy",
        syncToken: undefined,
        running: false,
        invalidated: false,
        failures: 0,
        lastCheckedAt: at,
        errorCode: undefined,
        errorDetails: undefined,
        retryAt: undefined,
      },
      ranges,
      [...events.values()],
    );
  }
  async run(request: SyncRequest = {}): Promise<void> {
    if (request.month) {
      try {
        monthRange(request.month, 0, 0);
      } catch {
        throw new AppError("invalid-request");
      }
    }
    const snapshot = await this.auth.snapshot();
    await this.repository.reconcile(snapshot.accounts);
    if (!snapshot.oauthConfigured) return;
    const home = homeRange(this.now(), snapshot.settings);
    for (const account of snapshot.accounts.filter(
      (item) =>
        item.enabled &&
        item.status !== "reconnect" &&
        (!request.accountId || item.id === request.accountId),
    )) {
      const pending: CalendarSummary[] = [];
      for (const calendar of account.calendars.filter((item) =>
        viewableCalendar(item.accessRole),
      )) {
        const state = await this.repository.state(account.id, calendar.id);
        const ranges = await this.repository.ranges(account.id, calendar.id);
        if (
          this.due(
            state,
            ranges,
            this.desired(ranges, home, request.month),
            snapshot.settings,
            request.reason,
            calendar.accessRole === "freeBusyReader",
          )
        )
          pending.push(calendar);
      }
      if (!pending.length) continue;
      for (const calendar of pending)
        await this.repository.putState({
          ...(await this.repository.state(account.id, calendar.id)),
          running: true,
          lastAttemptAt: this.now().toISOString(),
        });
      const completed = new Set<string>();
      try {
        await this.auth.withVerifiedToken(
          account.id,
          async (token, verified) => {
            for (const calendar of pending) {
              if (completed.has(calendar.id)) continue;
              let state = await this.repository.state(account.id, calendar.id);
              state = {
                ...state,
                running: true,
                lastAttemptAt: this.now().toISOString(),
              };
              await this.repository.putState(state);
              try {
                const previous = await this.repository.ranges(
                  account.id,
                  calendar.id,
                );
                if (calendar.accessRole === "freeBusyReader") {
                  state = { ...state, invalidated: true, syncToken: undefined };
                  await this.repository.putState(state);
                  await this.syncAvailability(
                    token,
                    verified,
                    calendar,
                    state,
                    this.desired(previous, home, request.month),
                  );
                  completed.add(calendar.id);
                  continue;
                }
                if (state.dataKind === "freebusy") {
                  state = { ...state, invalidated: true, syncToken: undefined };
                }
                let changes: { syncToken: string; changed: boolean };
                try {
                  changes = await this.google.getChanges(
                    token,
                    calendar.id,
                    state.syncToken,
                  );
                } catch (error) {
                  if (asAppError(error).code !== "sync-expired") throw error;
                  state = { ...state, syncToken: undefined, invalidated: true };
                  await this.repository.putState(state);
                  changes = await this.google.getChanges(token, calendar.id);
                }
                if (changes.changed || !state.syncToken) {
                  state = { ...state, invalidated: true };
                  await this.repository.putState(state);
                }
                const at = this.now().toISOString();
                const ranges: CachedRange[] = [];
                const events: CalendarEvent[] = [];
                for (const range of this.desired(
                  previous,
                  home,
                  request.month,
                )) {
                  const cached = previous.find(
                    (item) =>
                      item.kind === range.kind &&
                      item.start === range.start &&
                      item.end === range.end,
                  );
                  if (!state.invalidated && cached) {
                    ranges.push({ ...cached, validatedAt: at });
                    continue;
                  }
                  const bounds = requestBounds(range);
                  const result = await this.google.getInstances(
                    token,
                    calendar.id,
                    bounds.start,
                    bounds.end,
                  );
                  const normalized = result.events
                    .map((raw) =>
                      normalizeGoogleEvent(
                        raw,
                        verified,
                        calendar,
                        result.timeZone,
                        at,
                      ),
                    )
                    .filter((event): event is CalendarEvent => event !== null);
                  events.push(...normalized);
                  ranges.push({
                    ...range,
                    key: JSON.stringify([account.id, calendar.id, range.kind]),
                    accountId: account.id,
                    calendarId: calendar.id,
                    eventKeys: normalized.map((event) => event.key),
                    fetchedAt: at,
                    validatedAt: at,
                  });
                }
                await this.repository.commit(
                  {
                    ...state,
                    dataKind: "events",
                    syncToken: changes.syncToken,
                    running: false,
                    invalidated: false,
                    failures: 0,
                    lastCheckedAt: at,
                    errorCode: undefined,
                    errorDetails: undefined,
                    retryAt: undefined,
                  },
                  ranges,
                  events,
                  {
                    calendarName: calendar.summary,
                    accountName: verified.email,
                    color: calendar.backgroundColor ?? "#7765d8",
                  },
                );
                completed.add(calendar.id);
              } catch (error) {
                const safe = asAppError(error);
                // Let the auth adapter renew a 401 once, pinned to this account.
                if (
                  isReconnectError(safe.code) ||
                  safe.code === "storage-error"
                )
                  throw error;
                await this.fail(state, error);
                completed.add(calendar.id);
              }
            }
          },
        );
      } catch (error) {
        if (asAppError(error).code === "storage-error") {
          for (const calendar of pending.filter(
            (item) => !completed.has(item.id),
          )) {
            try {
              await this.repository.putState({
                ...(await this.repository.state(account.id, calendar.id)),
                running: false,
                errorCode: "storage-error",
              });
            } catch {
              /* Storage may be unavailable; startup recovery will retry. */
            }
          }
          throw error;
        }
        for (const calendar of pending.filter(
          (item) => !completed.has(item.id),
        ))
          await this.fail(
            await this.repository.state(account.id, calendar.id),
            error,
          );
      }
    }
  }
}
