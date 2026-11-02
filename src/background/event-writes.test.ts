import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarDatabase } from "../calendar/database";
import { EventRepository } from "../calendar/event-repository";
import {
  normalizeGoogleEvent,
  type GoogleEvent,
} from "../calendar/google-events";
import { eventKey } from "../calendar/model";
import {
  changedBody,
  draftSchema,
  eventBody,
  eventDraft,
  overlayWrites,
  type EventBody,
  type SaveEvent,
} from "../calendar/write-model";
import {
  emptyStore,
  commandSchema,
  type Account,
  type Store,
} from "../shared/model";
import { AppError } from "../shared/errors";
import { AuthService } from "./auth-service";
import { EventWriteService } from "./event-writes";
import { EventSyncService } from "./event-sync";
import { GoogleHttpError } from "./google";
import { routeCommand } from "./message-router";
import type { TokenRequest } from "./ports";

const at = "2026-11-02T12:00:00Z";
const raw: GoogleEvent = {
  id: "original",
  summary: "Original title",
  description: "Original notes",
  location: "Office",
  start: { dateTime: "2026-11-03T09:00:00Z", timeZone: "Europe/Warsaw" },
  end: { dateTime: "2026-11-03T10:00:00Z" },
  eventType: "default",
  etag: '"v1"',
  organizer: { self: true },
};
const account = (id = "a"): Account => ({
  id,
  email: `${id}@example.test`,
  enabled: true,
  status: "connected",
  calendars: [
    {
      id: `${id}-calendar`,
      summary: `${id} calendar`,
      accessRole: "owner",
      primary: true,
      timeZone: "Europe/Warsaw",
    },
  ],
  connectedAt: at,
  lastCheckedAt: at,
  lastSuccessfulAt: at,
});
const databases: CalendarDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
function harness(accounts = [account()]) {
  const db = new CalendarDatabase(`write-test-${crypto.randomUUID()}`);
  databases.push(db);
  let stored = { ...emptyStore(), accounts };
  let now = new Date(at);
  const remote = new Map<string, GoogleEvent>([[raw.id, structuredClone(raw)]]);
  const repository = {
    read: async () => structuredClone(stored),
    write: async (value: Store) => {
      stored = structuredClone(value);
    },
  };
  const identity = {
    getToken: vi.fn(
      async (request: TokenRequest) => `private-${request.accountId}`,
    ),
    invalidateToken: vi.fn(async () => {}),
  };
  const google = {
    getProfile: vi.fn(async (token: string) => ({
      id: token.slice(8),
      email: `${token.slice(8)}@example.test`,
    })),
    listCalendars: vi.fn(async () => stored.accounts[0]!.calendars),
    getEvent: vi.fn(async (_token: string, _calendar: string, id: string) => {
      const event = remote.get(id);
      if (!event) throw new GoogleHttpError(404, "calendar-unavailable");
      return structuredClone(event);
    }),
    insertEvent: vi.fn(
      async (
        _token: string,
        _calendar: string,
        body: EventBody,
        _send: "all" | "none",
      ) => {
        if (remote.has(body.id!))
          throw new GoogleHttpError(409, "event-conflict");
        const value = {
          ...body,
          etag: '"created"',
          eventType: "default",
          organizer: { self: true },
        } as unknown as GoogleEvent;
        remote.set(value.id, value);
        return structuredClone(value);
      },
    ),
    patchEvent: vi.fn(
      async (
        _token: string,
        _calendar: string,
        id: string,
        body: EventBody,
        etag: string,
        _send: "all" | "none",
      ) => {
        const before = remote.get(id)!;
        if (before.etag !== etag)
          throw new GoogleHttpError(412, "event-conflict");
        const value = { ...before, ...body, etag: '"patched"' } as GoogleEvent;
        remote.set(id, value);
        return structuredClone(value);
      },
    ),
    deleteEvent: vi.fn(
      async (
        _token: string,
        _calendar: string,
        id: string,
        etag: string,
        _send: "all" | "none",
      ) => {
        if (remote.get(id)?.etag !== etag)
          throw new GoogleHttpError(412, "event-conflict");
        remote.delete(id);
      },
    ),
    getChanges: vi.fn(async () => ({ syncToken: "cursor", changed: true })),
    getInstances: vi.fn(async () => ({
      events: [...remote.values()],
      timeZone: "Europe/Warsaw",
    })),
  };
  const auth = new AuthService({
    identity,
    google,
    repository,
    badge: { update: async () => {} },
    configuration: { oauthConfigured: true, extensionId: "test" },
    now: () => now,
  });
  const cache = new EventRepository(db);
  const writes = new EventWriteService(auth, google, cache, () => now);
  const sync = new EventSyncService(auth, google, cache, () => now);
  const event = normalizeGoogleEvent(
    raw,
    accounts[0]!,
    accounts[0]!.calendars[0]!,
    "UTC",
    at,
  )!;
  const command = (edit = false): SaveEvent => ({
    type: "SAVE_EVENT",
    id: crypto.randomUUID(),
    accountId: event.accountId,
    calendarId: event.calendarId,
    scope: "event",
    ...(edit ? { base: structuredClone(event) } : {}),
    draft: { ...eventDraft(event), title: "My change" },
    sendUpdates: "all",
  });
  return {
    db,
    remote,
    auth,
    cache,
    writes,
    sync,
    google,
    identity,
    event,
    command,
    stored: () => stored,
    advance: () => {
      now = new Date(now.getTime() + 3600_000);
    },
  };
}

describe("durable event writing", () => {
  it("queues without networking, survives reopening and remote snapshot replacement, and blocks account removal", async () => {
    const h = harness();
    const command = h.command();
    await h.writes.save(command);
    await h.writes.save(command);
    expect(await h.db.outbox.count()).toBe(1);
    expect(h.identity.getToken).not.toHaveBeenCalled();
    h.db.close();
    await h.db.open();
    await h.sync.run();
    expect((await h.db.outbox.toArray())[0]?.status).toBe("queued");
    const result = await routeCommand(
      { type: "REMOVE", accountId: "a" },
      h.auth,
      async () => {},
      h.sync,
      h.writes,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "pending-writes" },
    });
    expect((await h.auth.snapshot()).accounts).toHaveLength(1);
    const rows = overlayWrites(
      await h.db.events.toArray(),
      await h.db.outbox.toArray(),
    );
    expect(rows.some((e) => e.title === "My change")).toBe(true);
  });
  it("recovers an interrupted insertion after a lost response without creating a duplicate", async () => {
    const h = harness();
    const command = h.command();
    await h.writes.save(command);
    const insert = h.google.insertEvent.getMockImplementation()!;
    h.google.insertEvent.mockImplementationOnce(async (...args) => {
      await insert(...args);
      throw new AppError("network");
    });
    await h.writes.run();
    expect((await h.db.outbox.get(command.id))?.status).toBe("retry");
    h.db.close();
    await h.db.open();
    await h.writes.recover();
    h.advance();
    await h.writes.run();
    expect(h.google.insertEvent).toHaveBeenCalledTimes(1);
    expect((await h.db.outbox.get(command.id))?.status).toBe("awaiting-sync");
    await h.sync.run();
    expect(await h.db.outbox.count()).toBe(0);
    expect(
      (await h.db.events.toArray()).filter((e) => e.title === "My change"),
    ).toHaveLength(1);
  });
  it("retains content-free receipts after successful sync and refuses a reused request ID with different data", async () => {
    const h = harness();
    const command = h.command();
    await h.writes.save(command);
    await h.writes.run();
    await h.sync.run();
    expect(await h.db.outbox.count()).toBe(0);
    await h.writes.save(command);
    expect(await h.db.outbox.count()).toBe(0);
    await expect(
      h.writes.save({
        ...command,
        draft: { ...command.draft, title: "Different submission" },
      }),
    ).rejects.toMatchObject({ code: "pending-writes" });
    const receipt = await h.db.meta.get(`write-receipt:${command.id}`);
    expect(receipt?.value).not.toContain(command.draft.title);
    expect(receipt?.value).toMatch(/\|[0-9a-f]{64}$/);
    expect(h.google.insertEvent).toHaveBeenCalledTimes(1);
  });
  it("rejects corrupt persisted queue state without deleting it or contacting Google", async () => {
    const h = harness();
    const command = h.command();
    await h.writes.save(command);
    await h.db.outbox.update(command.id, {
      status: "unknown-state" as "queued",
    });
    await expect(h.writes.run()).rejects.toMatchObject({
      code: "storage-error",
    });
    expect(await h.db.outbox.count()).toBe(1);
    expect(h.identity.getToken).not.toHaveBeenCalled();
  });
  it("uses stable Google-compatible UUID IDs and explicit guest policy", async () => {
    const h = harness();
    const command = h.command();
    await h.writes.save(command);
    await h.writes.run();
    const body = h.google.insertEvent.mock.calls[0]![2];
    expect(body.id).toBe(command.id.replaceAll("-", ""));
    expect(body.id).toMatch(/^[0-9a-v]{32}$/);
    expect(body.extendedProperties?.private.calendarCheckerMutation).toBe(
      command.id,
    );
    expect(h.google.insertEvent.mock.calls[0]![3]).toBe("all");
    expect(JSON.stringify(await h.db.outbox.toArray())).not.toContain(
      "private-a",
    );
    expect(JSON.stringify(await h.auth.diagnostics())).not.toContain(
      "My change",
    );
  });
  it("patches only changed fields and preserves guests, descriptions, and meeting data", async () => {
    const h = harness();
    const command = h.command(true);
    await h.writes.save(command);
    await h.writes.run();
    expect(h.google.patchEvent.mock.calls[0]![3]).toEqual({
      summary: "My change",
      extendedProperties: { private: { calendarCheckerMutation: command.id } },
    });
    expect(h.google.patchEvent.mock.calls[0]![4]).toBe('"v1"');
    expect(h.remote.get(raw.id)?.description).toBe("Original notes");
  });
  it("does not send a form with unchanged values", async () => {
    const h = harness();
    const command = h.command(true);
    command.draft = eventDraft(h.event);
    await h.writes.save(command);
    expect(await h.db.outbox.count()).toBe(0);
  });
  it("surfaces changed remote versions and only rebases after explicit resolution", async () => {
    const h = harness();
    const command = h.command(true);
    await h.writes.save(command);
    h.remote.set(raw.id, {
      ...raw,
      etag: '"v2"',
      summary: "Google change",
      location: "Remote room",
    });
    await h.writes.run();
    expect(h.google.patchEvent).not.toHaveBeenCalled();
    expect(await h.db.outbox.get(command.id)).toMatchObject({
      status: "conflict",
      remote: { title: "Google change" },
    });
    await h.writes.resolve(command.id, "mine");
    await h.writes.run();
    expect(h.google.patchEvent.mock.calls[0]![4]).toBe('"v2"');
    expect(h.remote.get(raw.id)).toMatchObject({
      summary: "My change",
      location: "Remote room",
    });
  });
  it("can keep Google's version without sending the local edit", async () => {
    const h = harness();
    const command = h.command(true);
    await h.writes.save(command);
    h.remote.set(raw.id, { ...raw, etag: '"v2"', summary: "Google change" });
    await h.writes.run();
    await h.writes.resolve(command.id, "google");
    await h.sync.run();
    expect(await h.db.outbox.count()).toBe(0);
    expect(h.google.patchEvent).not.toHaveBeenCalled();
    expect((await h.db.events.get(h.event.key))?.title).toBe("Google change");
  });
  it("catches a race between GET and PATCH through If-Match and retrieves the conflict on retry", async () => {
    const h = harness();
    const command = h.command(true);
    await h.writes.save(command);
    h.google.patchEvent.mockImplementationOnce(async () => {
      h.remote.set(raw.id, { ...raw, etag: '"raced"' });
      throw new GoogleHttpError(412, "event-conflict");
    });
    await h.writes.run();
    await h.writes.run();
    expect(h.google.patchEvent).toHaveBeenCalledTimes(1);
    expect((await h.db.outbox.get(command.id))?.status).toBe("conflict");
  });
  it("acknowledges a lost patch response by operation marker without sending twice", async () => {
    const h = harness();
    const command = h.command(true);
    await h.writes.save(command);
    const patch = h.google.patchEvent.getMockImplementation()!;
    h.google.patchEvent.mockImplementationOnce(async (...args) => {
      await patch(...args);
      throw new AppError("network");
    });
    await h.writes.run();
    h.advance();
    await h.writes.run();
    expect(h.google.patchEvent).toHaveBeenCalledTimes(1);
    expect((await h.db.outbox.get(command.id))?.status).toBe("awaiting-sync");
  });
  it("does not recreate a remotely deleted event or overwrite an unrelated ID collision", async () => {
    const h = harness();
    const command = h.command(true);
    await h.writes.save(command);
    h.remote.delete(raw.id);
    await h.writes.run();
    expect((await h.db.outbox.get(command.id))?.status).toBe("conflict");
    await expect(h.writes.resolve(command.id, "mine")).rejects.toMatchObject({
      code: "event-gone",
    });
    await h.writes.discard(command.id);
    const create = h.command();
    h.remote.set(create.id.replaceAll("-", ""), {
      ...raw,
      id: create.id.replaceAll("-", ""),
    });
    await h.writes.save(create);
    await h.writes.run();
    await h.writes.run();
    expect((await h.db.outbox.get(create.id))?.status).toBe("conflict");
    await expect(h.writes.resolve(create.id, "mine")).rejects.toMatchObject({
      code: "event-gone",
    });
  });
  it("retains offline edits through a failed read sync and honors durable retry timing", async () => {
    const h = harness();
    const command = h.command(true);
    await h.writes.save(command);
    h.google.getProfile.mockRejectedValue(new AppError("network"));
    await h.writes.run();
    expect((await h.db.outbox.get(command.id))?.status).toBe("retry");
    const attempts = h.google.getProfile.mock.calls.length;
    await h.writes.run();
    expect(h.google.getProfile).toHaveBeenCalledTimes(attempts);
    await h.cache.reconcile([]);
    expect(await h.db.outbox.count()).toBe(1);
    expect(overlayWrites([], await h.db.outbox.toArray())[0]?.title).toBe(
      "My change",
    );
  });
  it.each(["reader", "freeBusyReader"])(
    "rejects cached %s calendars before queueing",
    async (role) => {
      const h = harness();
      h.stored().accounts[0]!.calendars[0]!.accessRole = role;
      await expect(h.writes.save(h.command())).rejects.toMatchObject({
        code: "event-readonly",
      });
      expect(await h.db.outbox.count()).toBe(0);
    },
  );
  it("refreshes ACLs before sending and preserves work if writer access was revoked", async () => {
    const h = harness();
    await h.writes.save(h.command());
    h.google.listCalendars.mockResolvedValue([
      { ...h.stored().accounts[0]!.calendars[0]!, accessRole: "reader" },
    ]);
    await h.writes.run();
    expect(h.google.insertEvent).not.toHaveBeenCalled();
    expect((await h.db.outbox.toArray())[0]?.status).toBe("failed");
  });
  it.each([
    "birthday",
    "fromGmail",
    "focusTime",
    "outOfOffice",
    "workingLocation",
  ] as const)("rejects modifying specialized %s events", async (eventType) => {
    const h = harness();
    const command = h.command(true);
    command.base!.eventType = eventType;
    await expect(h.writes.save(command)).rejects.toMatchObject({
      code: "event-readonly",
    });
  });
  it("rejects locked events, guests without edit rights, and overlapping queued edits", async () => {
    const h = harness();
    const locked = h.command(true);
    locked.base!.locked = true;
    await expect(h.writes.save(locked)).rejects.toMatchObject({
      code: "event-readonly",
    });
    const guest = h.command(true);
    guest.base = { ...h.event, organizerSelf: false };
    await expect(h.writes.save(guest)).rejects.toMatchObject({
      code: "event-readonly",
    });
    await h.writes.save(h.command(true));
    await expect(h.writes.save(h.command(true))).rejects.toMatchObject({
      code: "pending-writes",
    });
  });
  it("never sends for a disabled account or a mismatched Google identity", async () => {
    const h = harness();
    const command = h.command();
    await h.writes.save(command);
    h.stored().accounts[0]!.enabled = false;
    await h.writes.run();
    expect(h.identity.getToken).not.toHaveBeenCalled();
    h.stored().accounts[0]!.enabled = true;
    h.google.getProfile.mockResolvedValue({
      id: "wrong",
      email: "wrong@example.test",
    });
    await h.writes.run();
    expect(h.google.listCalendars).not.toHaveBeenCalled();
    expect(h.google.insertEvent).not.toHaveBeenCalled();
    expect((await h.auth.snapshot()).accounts[0]?.status).toBe("reconnect");
  });
  it("retries HTTP 401 once for the pinned account, then preserves the operation", async () => {
    const h = harness();
    await h.writes.save(h.command());
    h.google.insertEvent.mockRejectedValue(
      new GoogleHttpError(401, "reconnect-required"),
    );
    await h.writes.run();
    expect(h.identity.invalidateToken).toHaveBeenCalledTimes(1);
    expect(h.identity.getToken.mock.calls.map(([r]) => r.accountId)).toEqual([
      "a",
      "a",
    ]);
    expect((await h.db.outbox.toArray())[0]?.status).toBe("retry");
  });
  it("recovers sending jobs after worker termination and doesn't lose acknowledged rows during failed refresh", async () => {
    const h = harness();
    const command = h.command();
    await h.writes.save(command);
    await h.db.outbox.update(command.id, {
      status: "sending",
      attempted: true,
    });
    await h.writes.recover();
    expect((await h.db.outbox.get(command.id))?.status).toBe("retry");
    await h.writes.run();
    h.google.getInstances.mockRejectedValue(new AppError("network"));
    await h.sync.run();
    expect((await h.db.outbox.get(command.id))?.status).toBe("awaiting-sync");
  });
  it("edits a single recurring occurrence by its ID, preserving the series", async () => {
    const h = harness();
    const instance = {
      ...h.event,
      eventId: "instance",
      key: eventKey("a", "a-calendar", "instance"),
      recurringEventId: "master",
      originalStart: h.event.start,
    };
    h.remote.set("instance", {
      ...raw,
      id: "instance",
      recurringEventId: "master",
    });
    await h.db.events.put(instance);
    expect(await h.writes.prepare(instance.key, "event")).toEqual(instance);
    const command = { ...h.command(true), base: instance };
    await h.writes.save(command);
    await h.writes.run();
    expect(h.google.patchEvent.mock.calls[0]![2]).toBe("instance");
    expect(h.google.patchEvent.mock.calls[0]![3].recurrence).toBeUndefined();
  });
  it("loads the original series master and uses its ETag and first occurrence, including an offline cached base", async () => {
    const h = harness();
    const instance = { ...h.event, recurringEventId: "master" };
    await h.db.events.put(instance);
    h.remote.set("master", {
      ...raw,
      id: "master",
      start: { dateTime: "2026-01-01T09:00:00Z", timeZone: "Europe/Warsaw" },
      etag: '"master-v1"',
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "EXDATE:20261104T090000Z"],
    });
    const master = await h.writes.prepare(instance.key, "series");
    expect(master.eventId).toBe("master");
    expect(master.start).toBe("2026-01-01T09:00:00Z");
    h.google.getProfile.mockRejectedValueOnce(new AppError("network"));
    expect(await h.writes.prepare(instance.key, "series")).toEqual(master);
    await h.writes.save({
      ...h.command(true),
      base: master,
      scope: "series",
      draft: { ...eventDraft(master), title: "New series title" },
    });
    await h.writes.run();
    expect(h.google.patchEvent.mock.calls[0]![2]).toBe("master");
    expect(h.google.patchEvent.mock.calls[0]![4]).toBe('"master-v1"');
    expect(h.remote.get("master")?.recurrence).toEqual(master.recurrence);
  });
  it("deletes one occurrence conditionally and treats a lost delete response as already applied", async () => {
    const h = harness();
    const id = crypto.randomUUID();
    await h.writes.delete(id, h.event, "event", "none");
    const remove = h.google.deleteEvent.getMockImplementation()!;
    h.google.deleteEvent.mockImplementationOnce(async (...args) => {
      await remove(...args);
      throw new AppError("network");
    });
    await h.writes.run();
    h.advance();
    await h.writes.run();
    expect(h.google.deleteEvent).toHaveBeenCalledTimes(1);
    expect((await h.db.outbox.get(id))?.status).toBe("awaiting-sync");
    expect(overlayWrites([h.event], await h.db.outbox.toArray())).toEqual([]);
  });
});

describe("event draft boundaries", () => {
  it("uses exclusive all-day ends, validates dates and prevents recurrence line injection", () => {
    const draft = {
      title: "Day off",
      description: "",
      location: "",
      allDay: true,
      start: "2026-11-03",
      end: "2026-11-04",
      timeZone: "UTC",
      recurrence: [],
    };
    expect(draftSchema.safeParse(draft).success).toBe(true);
    for (const patch of [
      { end: draft.start },
      { start: "2026-02-30" },
      { timeZone: "device" },
      { recurrence: ["RRULE:FREQ=DAILY\nDTSTART:20261101"] },
    ])
      expect(draftSchema.safeParse({ ...draft, ...patch }).success).toBe(false);
    expect(eventBody(draft).start).toEqual({
      date: draft.start,
      dateTime: null,
      timeZone: null,
    });
  });
  it("groups both time endpoints in date/type changes and leaves untouched fields out of patches", () => {
    const h = harness();
    const draft = {
      ...eventDraft(h.event),
      allDay: true,
      start: "2026-11-03",
      end: "2026-11-04",
    };
    expect(Object.keys(changedBody(h.event, draft))).toEqual(["start", "end"]);
    expect(commandSchema.safeParse({ ...h.command(), id: "bad" }).success).toBe(
      false,
    );
  });
});
