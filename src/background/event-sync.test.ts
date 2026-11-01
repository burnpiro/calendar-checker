import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CalendarDatabase,
  LocalCalendarRepository,
} from "../calendar/database";
import { EventRepository } from "../calendar/event-repository";
import {
  normalizeGoogleEvent,
  type GoogleEvent,
} from "../calendar/google-events";
import {
  coverageStatus,
  preferredCalendarAccounts,
} from "../calendar/coverage";
import { visibleEvents } from "../calendar/presentation";
import { emptyStore, type Account, type Store } from "../shared/model";
import { AppError } from "../shared/errors";
import { AuthService } from "./auth-service";
import { EventSyncService } from "./event-sync";
import { GoogleHttpError } from "./google";
import type { TokenRequest } from "./ports";

const at = "2026-11-01T12:00:00.000Z";
const raw: GoogleEvent = {
  id: "series_20261102T090000Z",
  summary: "Weekly review",
  eventType: "focusTime",
  start: { dateTime: "2026-11-02T10:00:00+01:00", timeZone: "Europe/Warsaw" },
  end: { dateTime: "2026-11-02T11:00:00+01:00" },
  recurringEventId: "series",
  originalStartTime: { dateTime: "2026-11-02T09:00:00Z" },
  etag: "etag-1",
  updated: at,
};
function account(id: string): Account {
  return {
    id,
    email: `${id}@example.test`,
    enabled: true,
    eventsReadGranted: true,
    status: "connected",
    connectedAt: at,
    lastCheckedAt: at,
    lastSuccessfulAt: at,
    calendars: [
      {
        id: `${id}-calendar`,
        summary: `${id} calendar`,
        accessRole: "owner",
        primary: true,
        timeZone: "Europe/Warsaw",
        backgroundColor: "#348e81",
      },
    ],
  };
}
const databases: CalendarDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
function harness(accounts = [account("a")]) {
  const db = new CalendarDatabase(`sync-test-${crypto.randomUUID()}`);
  databases.push(db);
  let stored = { ...emptyStore(), accounts };
  let now = new Date(at);
  let cursor = 0;
  const repository = {
    read: vi.fn(async () => structuredClone(stored)),
    write: vi.fn(async (value: Store) => {
      stored = structuredClone(value);
    }),
  };
  const identity = {
    getToken: vi.fn(
      async (request: TokenRequest) => `private-token-${request.accountId}`,
    ),
    invalidateToken: vi.fn(async () => undefined),
  };
  const google = {
    getProfile: vi.fn(async (token: string) => ({
      id: token.replace("private-token-", ""),
      email: token.replace("private-token-", "") + "@example.test",
    })),
    listCalendars: vi.fn(async () => accounts[0]!.calendars),
    getChanges: vi.fn(
      async (_token: string, _calendar: string, _cursor?: string) => ({
        syncToken: `cursor-${++cursor}`,
        changed: false,
      }),
    ),
    getInstances: vi.fn(
      async (
        _token: string,
        _calendar: string,
        _start: string,
        _end: string,
      ) => ({ events: [structuredClone(raw)], timeZone: "Europe/Warsaw" }),
    ),
  };
  const badge = { update: vi.fn(async () => undefined) };
  const auth = new AuthService({
    identity,
    google,
    repository,
    badge,
    configuration: { oauthConfigured: true, extensionId: "test-extension" },
    now: () => now,
  });
  const cache = new EventRepository(db);
  const sync = new EventSyncService(
    auth,
    google,
    cache,
    () => now,
    () => 0.5,
  );
  return {
    db,
    cache,
    sync,
    auth,
    google,
    identity,
    badge,
    stored: () => stored,
    advance: (ms = 60_000) => {
      now = new Date(now.getTime() + ms);
    },
    now: () => now,
  };
}

describe("Google event synchronization", () => {
  it("honors refresh-on-open independently of periodic cadence, while fetching uncached dates", async () => {
    const h = harness();
    await h.sync.run();
    h.stored().settings.refreshOnOpen = false;
    h.advance(10 * 60_000);
    await h.sync.run({ reason: "open" });
    expect(h.google.getChanges).toHaveBeenCalledTimes(1);
    await h.sync.run({ reason: "background" });
    expect(h.google.getChanges).toHaveBeenCalledTimes(2);
    h.stored().settings.refreshOnOpen = true;
    h.advance();
    await h.sync.run({ reason: "open" });
    expect(h.google.getChanges).toHaveBeenCalledTimes(3);
    h.stored().settings.refreshOnOpen = false;
    await h.sync.run({ reason: "open", month: "2030-01-01" });
    expect(h.google.getInstances).toHaveBeenCalledTimes(2);
  });
  it("rolls back a failed cache replacement without advancing the cursor or leaving a running status", async () => {
    const h = harness();
    await h.sync.run();
    const before = await h.db.events.toArray();
    const ranges = await h.cache.ranges("a", "a-calendar");
    h.google.getChanges.mockResolvedValue({
      syncToken: "uncommitted",
      changed: true,
    });
    h.google.getInstances.mockResolvedValue({
      events: [{ ...raw, id: "replacement" }],
      timeZone: "UTC",
    });
    const reject = () => {
      throw new Error("Synthetic storage failure");
    };
    h.db.events.hook("creating", reject);
    try {
      await expect(h.sync.run({ reason: "manual" })).rejects.toMatchObject({
        code: "storage-error",
      });
    } finally {
      h.db.events.hook("creating").unsubscribe(reject);
    }
    expect(await h.db.events.toArray()).toEqual(before);
    expect(await h.cache.ranges("a", "a-calendar")).toEqual(ranges);
    expect(await h.cache.state("a", "a-calendar")).toMatchObject({
      syncToken: "cursor-1",
      running: false,
      errorCode: "storage-error",
    });
  });
  it("normalizes recurring instances with provenance, creates coverage, and never persists OAuth tokens", async () => {
    const h = harness();
    await new LocalCalendarRepository(h.db).prepareDemo("2026-11-01", "UTC");
    const demoCount = await h.db.demoEvents.count();
    await h.sync.run({ reason: "manual" });
    expect(await h.db.events.toArray()).toMatchObject([
      {
        source: "google",
        accountId: "a",
        calendarId: "a-calendar",
        recurringEventId: "series",
        start: "2026-11-02T09:00:00Z",
        eventType: "focusTime",
      },
    ]);
    expect(await h.cache.ranges("a", "a-calendar")).toMatchObject([
      {
        kind: "home",
        start: "2026-09-01",
        end: "2027-06-01",
        eventKeys: expect.any(Array),
      },
    ]);
    expect(h.google.getInstances).toHaveBeenCalledWith(
      "private-token-a",
      "a-calendar",
      "2026-08-30T00:00:00Z",
      "2027-06-03T00:00:00Z",
    );
    expect(await h.db.demoEvents.count()).toBe(demoCount);
    expect(
      JSON.stringify([
        h.stored(),
        await h.db.syncStates.toArray(),
        await h.db.events.toArray(),
      ]),
    ).not.toContain("private-token");
    expect(JSON.stringify(await h.auth.diagnostics())).not.toContain("cursor-");
  });
  it("advances a no-change cursor without downloading unchanged occurrence ranges", async () => {
    const h = harness();
    await h.sync.run();
    h.advance();
    const previous = (await h.cache.ranges("a", "a-calendar"))[0]!;
    h.stored().accounts[0]!.calendars[0]!.summary = "Renamed calendar";
    await h.sync.run({ reason: "manual" });
    expect(h.google.getChanges).toHaveBeenLastCalledWith(
      "private-token-a",
      "a-calendar",
      "cursor-1",
    );
    expect(h.google.getInstances).toHaveBeenCalledTimes(1);
    const next = (await h.cache.ranges("a", "a-calendar"))[0]!;
    expect(next.fetchedAt).toBe(previous.fetchedAt);
    expect(next.validatedAt).not.toBe(previous.validatedAt);
    expect((await h.db.events.toArray())[0]!.calendarName).toBe(
      "Renamed calendar",
    );
  });
  it("replaces changed ranges and removes cancelled or deleted events", async () => {
    const h = harness();
    await h.sync.run();
    h.google.getChanges.mockResolvedValue({
      syncToken: "after-delete",
      changed: true,
    });
    h.google.getInstances.mockResolvedValue({
      events: [{ id: raw.id, status: "cancelled" }],
      timeZone: "UTC",
    });
    await h.sync.run({ reason: "manual" });
    expect(await h.db.events.count()).toBe(0);
    expect((await h.cache.state("a", "a-calendar")).syncToken).toBe(
      "after-delete",
    );
    expect((await h.cache.ranges("a", "a-calendar"))[0]!.eventKeys).toEqual([]);
  });
  it("keeps cached events and the previous cursor after a failed refresh, with durable backoff", async () => {
    const h = harness();
    await h.sync.run();
    const before = await h.db.events.toArray();
    h.google.getChanges.mockResolvedValue({
      syncToken: "not-committed",
      changed: true,
    });
    h.google.getInstances.mockRejectedValueOnce(
      new AppError("network", { stage: "calendar-events" }),
    );
    await h.sync.run({ reason: "manual" });
    expect(await h.db.events.toArray()).toEqual(before);
    expect(await h.cache.state("a", "a-calendar")).toMatchObject({
      syncToken: "cursor-1",
      invalidated: true,
      running: false,
      errorCode: "network",
      failures: 1,
    });
    await h.sync.run({ reason: "manual" });
    expect(h.google.getChanges).toHaveBeenCalledTimes(2);
    h.advance();
    await h.sync.run({ reason: "manual" });
    expect(await h.cache.state("a", "a-calendar")).toMatchObject({
      syncToken: "not-committed",
      invalidated: false,
      failures: 0,
    });
  });
  it("rebuilds an expired cursor and preserves stale data if the rebuild fails", async () => {
    const h = harness();
    await h.sync.run();
    h.google.getChanges.mockRejectedValueOnce(
      new GoogleHttpError(410, "sync-expired"),
    );
    h.google.getInstances.mockRejectedValueOnce(new AppError("network"));
    await h.sync.run({ reason: "manual" });
    expect(h.google.getChanges).toHaveBeenLastCalledWith(
      "private-token-a",
      "a-calendar",
    );
    expect(await h.db.events.count()).toBe(1);
    expect(await h.cache.state("a", "a-calendar")).toMatchObject({
      invalidated: true,
      errorCode: "network",
    });
    expect((await h.cache.state("a", "a-calendar")).syncToken).toBeUndefined();
    h.advance();
    await h.sync.run({ reason: "manual" });
    expect((await h.cache.state("a", "a-calendar")).invalidated).toBe(false);
  });
  it("isolates account failures and ignores disabled and busy-only calendars", async () => {
    const paused = account("paused");
    paused.enabled = false;
    const h = harness([account("a"), account("b"), paused]);
    h.stored().accounts[1]!.calendars.push({
      id: "busy-only",
      summary: "Busy",
      accessRole: "freeBusyReader",
      primary: false,
    });
    h.google.getChanges.mockImplementation(async (_token, calendar) => {
      if (calendar === "a-calendar") throw new AppError("network");
      return { syncToken: "b-cursor", changed: false };
    });
    await h.sync.run();
    expect(
      (await h.db.events.toArray()).map((event) => event.accountId),
    ).toEqual(["b"]);
    expect(
      h.identity.getToken.mock.calls.map(([request]) => request.accountId),
    ).toEqual(["a", "b"]);
    expect(
      h.google.getChanges.mock.calls.some(
        ([, calendar]) => calendar === "busy-only",
      ),
    ).toBe(false);
  });
  it("retries one 401 with pinned identity, and keeps cache when consent then fails", async () => {
    const h = harness();
    h.google.getChanges.mockRejectedValueOnce(
      new GoogleHttpError(401, "reconnect-required"),
    );
    await h.sync.run();
    expect(h.identity.invalidateToken).toHaveBeenCalledTimes(1);
    expect(h.google.getProfile).toHaveBeenCalledTimes(2);
    expect(
      h.identity.getToken.mock.calls.every(
        ([request]) => request.accountId === "a" && !request.interactive,
      ),
    ).toBe(true);
    h.google.getChanges.mockRejectedValue(
      new GoogleHttpError(401, "reconnect-required"),
    );
    await h.sync.run({ reason: "manual" });
    expect(h.google.getChanges).toHaveBeenCalledTimes(4);
    expect(h.stored().accounts[0]!.status).toBe("reconnect");
    expect(h.badge.update).toHaveBeenLastCalledWith(1);
    expect(await h.db.events.count()).toBe(1);
    expect((await h.cache.state("a", "a-calendar")).running).toBe(false);
    await h.auth.check("a", { interactive: true });
    await h.cache.resumeAccount("a");
    h.google.getChanges.mockResolvedValue({
      syncToken: "reconnected-cursor",
      changed: false,
    });
    await h.sync.run({ reason: "manual", accountId: "a" });
    expect((await h.cache.state("a", "a-calendar")).syncToken).toBe(
      "reconnected-cursor",
    );
    expect(h.badge.update).toHaveBeenLastCalledWith(0);
  });
  it("rejects a different account before requesting any events", async () => {
    const h = harness();
    h.google.getProfile.mockResolvedValue({
      id: "other",
      email: "other@example.test",
    });
    await h.sync.run();
    expect(h.google.getChanges).not.toHaveBeenCalled();
    expect(h.google.getInstances).not.toHaveBeenCalled();
    expect(h.stored().accounts[0]!.errorCode).toBe("account-mismatch");
  });
  it("bounds a separate browsing cache and prunes orphaned events without deleting home coverage", async () => {
    const h = harness();
    h.google.getInstances.mockImplementation(async (_t, _c, start) => ({
      events: [
        {
          ...raw,
          id: start.startsWith("2026") ? "home" : start.slice(0, 4) + "-browse",
        },
      ],
      timeZone: "UTC",
    }));
    await h.sync.run({ month: "2024-11-01" });
    expect(await h.db.events.count()).toBe(2);
    expect(await h.cache.ranges("a", "a-calendar")).toHaveLength(2);
    await h.sync.run({ month: "2023-11-01" });
    expect((await h.db.events.toArray()).map((e) => e.eventId).sort()).toEqual([
      "2023-browse",
      "home",
    ]);
    expect(h.google.getInstances).toHaveBeenCalledTimes(3);
  });
  it("recovers interrupted work and removes disconnected account data without touching samples", async () => {
    const h = harness([account("a"), account("b")]);
    await h.sync.run();
    await new LocalCalendarRepository(h.db).prepareDemo("2026-11-01", "UTC");
    const state = await h.cache.state("a", "a-calendar");
    await h.cache.putState({ ...state, running: true });
    await h.cache.recover();
    expect(await h.cache.state("a", "a-calendar")).toMatchObject({
      running: false,
      invalidated: true,
    });
    h.stored().accounts = [h.stored().accounts[1]!];
    await h.cache.reconcile(h.stored().accounts);
    expect((await h.db.events.toArray()).map((e) => e.accountId)).toEqual([
      "b",
    ]);
    expect(await h.db.demoEvents.count()).toBeGreaterThan(0);
  });
  it("distinguishes uncached dates, stale coverage and offline use, preferring a fresher shared-calendar copy", async () => {
    const h = harness([account("a"), account("b")]);
    await h.sync.run();
    const settings = { ...h.stored().settings, dataSource: "google" as const };
    const view = { start: "2026-11-01", end: "2026-12-01" };
    const metadata = {
      states: await h.db.syncStates.toArray(),
      ranges: await h.db.ranges.toArray(),
      failed: false,
    };
    expect(
      coverageStatus(
        h.stored().accounts,
        settings,
        metadata,
        view,
        true,
        h.now().getTime(),
      ).warning,
    ).toBe(false);
    expect(
      coverageStatus(
        h.stored().accounts,
        settings,
        metadata,
        { start: "2030-01-01", end: "2030-02-01" },
        true,
        h.now().getTime(),
      ).short,
    ).toContain("not fully cached");
    expect(
      coverageStatus(
        h.stored().accounts,
        settings,
        metadata,
        view,
        false,
        h.now().getTime(),
      ).short,
    ).toContain("Offline");
    h.advance(20 * 60_000);
    expect(
      coverageStatus(
        h.stored().accounts,
        settings,
        metadata,
        view,
        true,
        h.now().getTime(),
      ).short,
    ).toContain("stale");
    const shared = account("b");
    shared.calendars = h.stored().accounts[0]!.calendars;
    const newer = {
      ...metadata.ranges[0]!,
      key: "shared",
      accountId: "b",
      validatedAt: h.now().toISOString(),
    };
    const preferences = preferredCalendarAccounts(
      [account("a"), shared],
      settings,
      { ...metadata, ranges: [...metadata.ranges, newer] },
      view,
    );
    expect(preferences.get("a-calendar")).toBe("b");
    const invalidated = {
      ...metadata,
      states: metadata.states.map((state) => ({
        ...state,
        invalidated: state.accountId === "a",
      })),
    };
    expect(
      preferredCalendarAccounts(
        [account("a"), shared],
        settings,
        invalidated,
        view,
      ).get("a-calendar"),
    ).toBe("a");
    const copy = normalizeGoogleEvent(
      raw,
      shared,
      shared.calendars[0]!,
      "UTC",
      at,
    )!;
    expect(
      visibleEvents(
        [...(await h.db.events.toArray()), copy],
        settings,
        [account("a"), shared],
        "",
        [],
        preferences,
      )
        .filter((e) => e.calendarId === "a-calendar")
        .map((e) => e.accountId),
    ).toEqual(["b"]);
  });
});
