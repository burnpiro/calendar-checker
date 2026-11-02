import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarDatabase } from "../calendar/database";
import { eventKey, type CalendarEvent } from "../calendar/model";
import { emptyStore, type Account } from "../shared/model";
import { eventBody, eventDraft } from "../calendar/write-model";
import { ReminderService } from "./service";
import { dndActive, reminderCandidates } from "./planning";
const databases: CalendarDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
const account = (id = "a"): Account => ({
  id,
  email: `${id}@example.test`,
  enabled: true,
  status: "connected",
  calendars: [
    { id: "calendar", summary: "Work", accessRole: "owner", primary: true },
  ],
  connectedAt: "2026-11-02T10:00:00Z",
  lastCheckedAt: null,
  lastSuccessfulAt: null,
});
function harness() {
  const db = new CalendarDatabase(`reminders-${crypto.randomUUID()}`);
  databases.push(db);
  const state = { ...emptyStore(), extensionId: "test", oauthConfigured: true };
  state.accounts = [account()];
  state.settings.primaryTimeZone = "UTC";
  state.settings.reminders.desktop = true;
  state.settings.reminders.sound = true;
  let now = new Date("2026-11-02T10:00:00Z");
  const event: CalendarEvent = {
    key: eventKey("a", "calendar", "event"),
    source: "google",
    accountId: "a",
    calendarId: "calendar",
    eventId: "event",
    title: "Planning",
    description: "",
    location: "Room",
    eventType: "default",
    color: "#348e81",
    calendarName: "Work",
    accountName: "a@example.test",
    timeZone: "UTC",
    etag: "v1",
    allDay: false,
    start: "2026-11-02T10:10:00Z",
    end: "2026-11-02T11:10:00Z",
    updatedAt: now.toISOString(),
  };
  const port = {
    desktop: vi.fn(async () => {}),
    sound: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    schedule: vi.fn(async (_when?: number) => {}),
  };
  const create = () =>
    new ReminderService(
      db,
      async () => structuredClone(state),
      port,
      () => now,
    );
  return {
    db,
    state,
    event,
    port,
    create,
    service: create(),
    advance: (minutes: number) => {
      now = new Date(now.getTime() + minutes * 60_000);
    },
  };
}
describe("durable local reminders", () => {
  it("delivers once per event/offset and survives a full database/service restart", async () => {
    const h = harness();
    await h.db.events.put(h.event);
    await h.service.run();
    await h.service.run();
    expect(h.port.desktop).toHaveBeenCalledTimes(1);
    expect(h.port.sound).toHaveBeenCalledTimes(1);
    h.db.close();
    await h.db.open();
    await h.create().run();
    expect(h.port.desktop).toHaveBeenCalledTimes(1);
    expect((await h.service.jobs())[0]?.status).toBe("delivered");
  });
  it("reconciles concurrently requested ticks without duplicate deliveries", async () => {
    const h = harness();
    await h.db.events.put(h.event);
    await Promise.all([h.service.run(), h.service.run(), h.service.run()]);
    expect(h.port.desktop).toHaveBeenCalledTimes(1);
    expect(h.port.sound).toHaveBeenCalledTimes(1);
  });
  it("recovers an uncertain desktop delivery with the same ID and never replays uncertain sound", async () => {
    const h = harness();
    h.state.settings.reminders.offsets = [0];
    await h.db.events.put(h.event);
    await h.service.run();
    const row = (await h.service.jobs())[0]!;
    await h.db.reminders.put({
      ...row,
      status: "delivering",
      soundAttempted: true,
    });
    h.advance(10);
    await h.create().run();
    expect(h.port.desktop).toHaveBeenCalledTimes(1);
    expect(h.port.sound).not.toHaveBeenCalled();
    expect(h.port.desktop.mock.calls[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: row.id })]),
    );
  });
  it("persists snoozes and rearms both channels only after the snoozed time", async () => {
    const h = harness();
    await h.db.events.put(h.event);
    await h.service.run();
    const row = (await h.service.jobs())[0]!;
    await h.service.action(row.id, "snooze", 5);
    await h.create().run();
    expect(h.port.desktop).toHaveBeenCalledTimes(1);
    h.advance(5);
    await h.create().run();
    expect(h.port.desktop).toHaveBeenCalledTimes(2);
    expect(h.port.sound).toHaveBeenCalledTimes(2);
    await h.service.action(row.id, "dismiss");
    h.advance(5);
    await h.service.run();
    expect(h.port.desktop).toHaveBeenCalledTimes(2);
  });
  it("rejects snoozes past the event end and invalid reminder IDs", async () => {
    const h = harness();
    await h.db.events.put(h.event);
    await h.service.run();
    const row = (await h.service.jobs())[0]!;
    await expect(h.service.action(row.id, "snooze", 120)).rejects.toMatchObject(
      { code: "reminder-ended" },
    );
    await expect(
      h.service.action(crypto.randomUUID(), "dismiss"),
    ).rejects.toMatchObject({ code: "invalid-request" });
  });
  it("does not apply display visibility/search/type filters and deduplicates shared calendar copies", async () => {
    const h = harness();
    h.state.accounts.push(account("b"));
    h.state.settings.calendarVisibility = {
      '["a","calendar"]': false,
      '["b","calendar"]': false,
    };
    await h.db.events.bulkPut([
      h.event,
      { ...h.event, key: eventKey("b", "calendar", "event"), accountId: "b" },
    ]);
    await h.service.run();
    expect(h.port.desktop).toHaveBeenCalledTimes(1);
    expect(await h.db.reminders.count()).toBe(1);
  });
  it("skips paused accounts, declined events and disabled reminder calendars", async () => {
    const h = harness();
    await h.db.events.put(h.event);
    h.state.accounts[0]!.enabled = false;
    await h.service.run();
    expect(await h.db.reminders.count()).toBe(0);
    h.state.accounts[0]!.enabled = true;
    await h.db.events.put({ ...h.event, responseStatus: "declined" });
    await h.service.run();
    expect(await h.db.reminders.count()).toBe(0);
    await h.db.events.put(h.event);
    h.state.settings.notificationCalendars.calendar = { enabled: false };
    await h.service.run();
    expect(h.port.desktop).not.toHaveBeenCalled();
  });
  it("respects global channel switches even if calendar overrides allow them", async () => {
    const h = harness();
    h.state.settings.reminders.desktop = false;
    h.state.settings.reminders.sound = false;
    h.state.settings.notificationCalendars.calendar = {
      enabled: true,
      desktop: true,
      sound: true,
    };
    await h.db.events.put(h.event);
    await h.service.run();
    expect(h.port.desktop).not.toHaveBeenCalled();
    expect(h.port.sound).not.toHaveBeenCalled();
  });
  it("applies calendar-specific offsets and sounds", async () => {
    const h = harness();
    const soundId = crypto.randomUUID();
    h.state.settings.notificationCalendars.calendar = {
      enabled: true,
      offsets: [0],
      soundId,
    };
    await h.db.events.put(h.event);
    await h.service.run();
    expect(h.port.desktop).not.toHaveBeenCalled();
    h.advance(10);
    await h.service.run();
    expect(h.port.sound).toHaveBeenCalledWith(soundId, 0.6);
  });
  it("skips due alerts during DND without leaking into either channel", async () => {
    const h = harness();
    h.state.settings.dnd.manual = true;
    await h.db.events.put(h.event);
    await h.service.run();
    expect(h.port.desktop).not.toHaveBeenCalled();
    expect(h.port.sound).not.toHaveBeenCalled();
    expect((await h.service.jobs())[0]).toMatchObject({
      status: "missed",
      error: "Do not disturb",
    });
    h.state.settings.dnd.manual = false;
    await h.service.run();
    expect(h.port.desktop).not.toHaveBeenCalled();
  });
  it("can defer during DND and recover within the configured grace window", async () => {
    const h = harness();
    h.state.settings.dnd.manual = true;
    h.state.settings.dnd.policy = "defer";
    await h.db.events.put(h.event);
    await h.service.run();
    expect((await h.service.jobs())[0]?.status).toBe("scheduled");
    h.advance(10);
    h.state.settings.dnd.manual = false;
    await h.service.run();
    expect(h.port.desktop).toHaveBeenCalledTimes(1);
  });
  it("combines multiple missed offsets and honors a skip-on-delay policy", async () => {
    const h = harness();
    h.state.settings.reminders.offsets = [10, 15];
    await h.db.events.put(h.event);
    await h.service.run();
    expect(h.port.desktop).toHaveBeenCalledTimes(1);
    expect(
      (await h.service.jobs()).filter((j) => j.status === "missed"),
    ).toHaveLength(1);
    const h2 = harness();
    await h2.db.events.put(h2.event);
    h2.state.settings.reminders.missed = "skip";
    h2.advance(2);
    await h2.service.run();
    expect(h2.port.desktop).not.toHaveBeenCalled();
  });
  it("records old missed alarms after sleep and never notifies for an ended event", async () => {
    const h = harness();
    h.state.settings.reminders.offsets = [0];
    await h.db.events.put(h.event);
    await h.service.run();
    h.advance(150);
    await h.service.run();
    expect(h.port.desktop).not.toHaveBeenCalled();
    expect((await h.service.jobs())[0]?.status).toBe("missed");
  });
  it("cancels old schedules after rescheduling or remote deletion", async () => {
    const h = harness();
    h.state.settings.reminders.offsets = [0];
    await h.db.events.put(h.event);
    await h.service.run();
    await h.db.events.put({
      ...h.event,
      start: "2026-11-02T11:10:00Z",
      end: "2026-11-02T12:10:00Z",
    });
    await h.service.run();
    expect((await h.service.jobs()).map((j) => j.status).sort()).toEqual([
      "cancelled",
      "scheduled",
    ]);
    await h.db.events.clear();
    await h.service.run();
    expect(
      (await h.service.jobs()).every((j) => j.status === "cancelled"),
    ).toBe(true);
  });
  it("honors locally queued deletions without mutating or dropping the outbox", async () => {
    const h = harness();
    h.state.settings.reminders.offsets = [0];
    await h.db.events.put(h.event);
    await h.service.run();
    await h.db.outbox.put({
      id: crypto.randomUUID(),
      accountId: "a",
      calendarId: "calendar",
      eventId: "event",
      kind: "delete",
      scope: "event",
      base: h.event,
      event: h.event,
      patch: eventBody(eventDraft(h.event)),
      status: "queued",
      createdAt: "2026-11-02T10:00:00Z",
      attempted: false,
      attempts: 0,
      sendUpdates: "none",
    });
    await h.service.run();
    expect((await h.service.jobs())[0]?.status).toBe("cancelled");
    expect(await h.db.outbox.count()).toBe(1);
  });
  it("continues sound if desktop permission fails and keeps safe actionable history", async () => {
    const h = harness();
    h.port.desktop.mockRejectedValue(new Error("private-provider-error"));
    await h.db.events.put(h.event);
    await h.service.run();
    expect(h.port.sound).toHaveBeenCalledTimes(1);
    const row = (await h.service.jobs())[0]!;
    expect(row.status).toBe("delivered");
    expect(row.error).toContain("Desktop notification unavailable");
    expect(row.error).not.toContain("private-provider");
  });
  it("purges removed-account reminder contents while preserving enabled shared copies", async () => {
    const h = harness();
    await h.db.events.put(h.event);
    await h.service.run();
    h.state.accounts = [];
    await h.service.run();
    expect(await h.db.reminders.count()).toBe(0);
    expect(h.port.clear).toHaveBeenCalled();
    const h2 = harness();
    h2.state.accounts.push(account("b"));
    await h2.db.events.bulkPut([
      h2.event,
      { ...h2.event, accountId: "b", key: eventKey("b", "calendar", "event") },
    ]);
    await h2.service.run();
    h2.state.accounts = [account("b")];
    await h2.service.run();
    expect((await h2.service.jobs())[0]?.event.accountId).toBe("b");
    expect(h2.port.desktop).toHaveBeenCalledTimes(1);
  });
  it("plans large reminder offsets by due date rather than ignoring distant events", () => {
    const h = harness();
    h.state.settings.reminders.offsets = [40320];
    const candidates = reminderCandidates(
      [
        {
          ...h.event,
          start: "2026-11-30T10:00:00Z",
          end: "2026-11-30T11:00:00Z",
        },
      ],
      h.state.accounts,
      h.state.settings,
      new Date("2026-11-02T10:00:00Z"),
    );
    expect(candidates[0]?.dueAt).toBe("2026-11-02T10:00:00Z");
  });
  it("uses the primary-zone hour for opted-in all-day reminders and leaves dates unchanged", async () => {
    const h = harness();
    const event = {
      ...h.event,
      allDay: true as const,
      start: "2026-11-02",
      end: "2026-11-03",
    };
    expect(
      reminderCandidates(
        [event],
        h.state.accounts,
        h.state.settings,
        new Date("2026-11-02T08:50:00Z"),
      ),
    ).toEqual([]);
    h.state.settings.reminders.includeAllDay = true;
    const planned = reminderCandidates(
      [event],
      h.state.accounts,
      h.state.settings,
      new Date("2026-11-02T08:50:00Z"),
    );
    expect(planned[0]).toMatchObject({
      startAt: "2026-11-02T09:00:00Z",
      dueAt: "2026-11-02T08:50:00Z",
      event: { start: "2026-11-02" },
    });
  });
});
describe("named-zone DND schedules", () => {
  const prefs = () => ({
    ...emptyStore().settings.dnd,
    scheduleEnabled: true,
    timeZone: "Europe/Warsaw",
    rules: [{ days: [1], start: "22:00", end: "08:00" }],
  });
  it("uses the starting weekday for overnight periods and excludes the end boundary", () => {
    const p = prefs();
    expect(dndActive(p, new Date("2026-11-02T21:00:00Z"))).toBe(true);
    expect(dndActive(p, new Date("2026-11-03T06:59:00Z"))).toBe(true);
    expect(dndActive(p, new Date("2026-11-03T07:00:00Z"))).toBe(false);
    expect(dndActive(p, new Date("2026-11-04T06:00:00Z"))).toBe(false);
  });
  it("handles Sunday-to-Monday wrapping, all-day rules and manual expiry", () => {
    const p = prefs();
    p.rules[0]!.days = [7];
    expect(dndActive(p, new Date("2026-11-02T06:00:00Z"))).toBe(true);
    p.rules[0] = { days: [1], start: "00:00", end: "00:00" };
    expect(dndActive(p, new Date("2026-11-02T12:00:00Z"))).toBe(true);
    p.scheduleEnabled = false;
    p.manual = true;
    p.until = "2026-11-02T12:00:00Z";
    expect(dndActive(p, new Date("2026-11-02T12:00:00Z"))).toBe(false);
  });
  it("matches both instances of a repeated DST hour in the selected schedule zone", () => {
    const p = prefs();
    p.rules[0] = { days: [7], start: "02:00", end: "03:00" };
    expect(dndActive(p, new Date("2026-10-25T00:30:00Z"))).toBe(true);
    expect(dndActive(p, new Date("2026-10-25T01:30:00Z"))).toBe(true);
    expect(dndActive(p, new Date("2026-10-25T02:00:00Z"))).toBe(false);
  });
});
