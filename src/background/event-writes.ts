import { Temporal } from "temporal-polyfill";
import { AppError, asAppError, isReconnectError } from "../shared/errors";
import type { CalendarEvent } from "../calendar/model";
import { eventKey, eventSchema } from "../calendar/model";
import {
  normalizeGoogleEvent,
  type GoogleEvent,
} from "../calendar/google-events";
import { EventRepository } from "../calendar/event-repository";
import {
  canEditEvent,
  changedBody,
  eventBody,
  sameWriteTarget,
  writableCalendar,
  type PendingWrite,
  type SaveEvent,
  type EditScope,
} from "../calendar/write-model";
import type { AuthService } from "./auth-service";
import type { EventWriteGateway } from "./ports";
import { GoogleHttpError } from "./google";

const MARKER = "calendarCheckerMutation";

/** Called only by the worker's serial queue. Local mutations commit before I/O. */
export class EventWriteService {
  constructor(
    private readonly auth: AuthService,
    private readonly google: EventWriteGateway,
    readonly repository = new EventRepository(),
    private readonly now = () => new Date(),
  ) {}
  get db() {
    return this.repository.db;
  }

  async assertNoPending(accountId: string): Promise<void> {
    if (await this.db.outbox.where("accountId").equals(accountId).count())
      throw new AppError("pending-writes");
  }
  private async validateBase(
    base: CalendarEvent,
    scope: EditScope,
  ): Promise<void> {
    const snapshot = await this.auth.snapshot();
    if (
      !canEditEvent(base, snapshot.accounts) ||
      !base.etag ||
      base.key !== eventKey(base.accountId, base.calendarId, base.eventId)
    )
      throw new AppError("event-readonly");
    if (
      scope === "series" &&
      (!base.recurrence?.length || base.recurringEventId)
    )
      throw new AppError("invalid-request");
    if (scope === "event" && base.recurrence?.length)
      throw new AppError("invalid-request");
  }
  async prepare(key: string, scope: EditScope): Promise<CalendarEvent> {
    const base = await this.db.events.get(key);
    if (!base) throw new AppError("event-gone");
    const snapshot = await this.auth.snapshot();
    if (!canEditEvent(base, snapshot.accounts))
      throw new AppError("event-readonly");
    if (scope === "event") {
      await this.validateBase(base, scope);
      return base;
    }
    const target = base.recurringEventId ?? base.eventId;
    const masterKey = eventKey(base.accountId, base.calendarId, target);
    try {
      const event = await this.auth.withVerifiedToken(
        base.accountId,
        async (token, account) => {
          const calendar = account.calendars.find(
            (c) => c.id === base.calendarId,
          )!;
          const raw = await this.google.getEvent(
            token,
            base.calendarId,
            target,
          );
          const normalized = normalizeGoogleEvent(
            raw,
            account,
            calendar,
            base.timeZone,
            this.now().toISOString(),
          );
          if (!normalized) throw new AppError("event-gone");
          return normalized;
        },
      );
      await this.validateBase(event, scope);
      // Bound detached edit bases; queued work retains its own immutable snapshot.
      await this.db.editBases.put({ key: masterKey, event });
      const keys = await this.db.editBases.toCollection().primaryKeys();
      if (keys.length > 50)
        await this.db.editBases.bulkDelete(
          keys.filter((k) => k !== masterKey).slice(0, keys.length - 50),
        );
      return event;
    } catch (error) {
      if (
        asAppError(error).code !== "network" &&
        !isReconnectError(asAppError(error).code)
      )
        throw error;
      const cached = await this.db.editBases.get(masterKey);
      if (!cached) throw new AppError("network");
      await this.validateBase(cached.event, scope);
      return cached.event;
    }
  }
  private async fingerprint(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(value)),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  private async accepted(id: string, fingerprint: string): Promise<boolean> {
    const receipt = await this.db.meta.get(`write-receipt:${id}`);
    if (!receipt) return false;
    if (!receipt.value.endsWith(`|${fingerprint}`))
      throw new AppError("pending-writes");
    return true;
  }
  private async insert(row: PendingWrite, fingerprint: string): Promise<void> {
    await this.db.transaction("rw", this.db.outbox, this.db.meta, async () => {
      if (await this.accepted(row.id, fingerprint)) return;
      if ((await this.db.outbox.count()) >= 200)
        throw new AppError("pending-writes");
      const existing = await this.db.outbox
        .where("[accountId+calendarId]")
        .equals([row.accountId, row.calendarId])
        .toArray();
      if (existing.some((item) => sameWriteTarget(item, row.event)))
        throw new AppError("pending-writes");
      await this.db.outbox.add(row);
      await this.db.meta.put({
        key: `write-receipt:${row.id}`,
        value: `${row.createdAt}|${fingerprint}`,
      });
      // Retain bounded, content-free receipts after snapshot cleanup, so a repeated
      // message can't silently reuse an accepted request ID with a different body.
      const receipts = await this.db.meta
        .where("key")
        .startsWith("write-receipt:")
        .toArray();
      if (receipts.length > 1000) {
        const pending = new Set(
          await this.db.outbox.toCollection().primaryKeys(),
        );
        await this.db.meta.bulkDelete(
          receipts
            .filter((r) => !pending.has(r.key.slice("write-receipt:".length)))
            .sort((a, b) => a.value.localeCompare(b.value))
            .slice(0, receipts.length - 1000)
            .map((r) => r.key),
        );
      }
    });
  }
  async save(command: SaveEvent): Promise<void> {
    const fingerprint = await this.fingerprint(command);
    if (await this.accepted(command.id, fingerprint)) return;
    const snapshot = await this.auth.snapshot();
    const account = snapshot.accounts.find(
      (a) => a.id === command.accountId && a.enabled,
    );
    const calendar = account?.calendars.find(
      (c) => c.id === command.calendarId && writableCalendar(c.accessRole),
    );
    if (!account || !calendar) throw new AppError("event-readonly");
    const base = command.base;
    if (base) {
      if (base.accountId !== account.id || base.calendarId !== calendar.id)
        throw new AppError("invalid-request");
      await this.validateBase(base, command.scope);
      // Only masters can change a series rule. An instance stays an exception.
      if (base.recurringEventId && command.draft.recurrence.length)
        throw new AppError("invalid-request");
    } else if (command.scope === "series")
      throw new AppError("invalid-request");
    const recurrence = command.draft.recurrence;
    if (
      JSON.stringify(recurrence) !== JSON.stringify(base?.recurrence ?? []) &&
      recurrence.length
    ) {
      const match =
        recurrence.length === 1 &&
        recurrence[0]!.match(
          /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY);COUNT=([1-9][0-9]{0,3})$/,
        );
      if (!match || Number(match[2]) > 1000)
        throw new AppError("invalid-request");
    }
    const patch = base
      ? changedBody(base, command.draft)
      : eventBody(command.draft);
    if (base && !Object.keys(patch).length) return;
    const at = this.now().toISOString();
    const eventId = base?.eventId ?? command.id.replaceAll("-", "");
    const event = eventSchema.parse({
      ...base,
      ...command.draft,
      source: "google",
      key: eventKey(account.id, calendar.id, eventId),
      accountId: account.id,
      calendarId: calendar.id,
      eventId,
      calendarName: calendar.summary,
      accountName: account.email,
      color: base?.color ?? calendar.backgroundColor ?? "#7765d8",
      eventType: "default",
      organizerSelf: base?.organizerSelf ?? true,
      updatedAt: at,
    });
    await this.insert(
      {
        id: command.id,
        accountId: account.id,
        calendarId: calendar.id,
        eventId,
        kind: base ? "update" : "create",
        scope: command.scope,
        base,
        event,
        patch,
        sendUpdates: command.sendUpdates,
        status: "queued",
        createdAt: at,
        attempted: false,
        attempts: 0,
      },
      fingerprint,
    );
  }
  async delete(
    id: string,
    base: CalendarEvent,
    scope: EditScope,
    sendUpdates: "all" | "none",
  ): Promise<void> {
    const fingerprint = await this.fingerprint({
      type: "DELETE_EVENT",
      id,
      base,
      scope,
      sendUpdates,
    });
    if (await this.accepted(id, fingerprint)) return;
    await this.validateBase(base, scope);
    await this.insert(
      {
        id,
        accountId: base.accountId,
        calendarId: base.calendarId,
        eventId: base.eventId,
        kind: "delete",
        scope,
        base,
        event: base,
        patch: {},
        sendUpdates,
        status: "queued",
        createdAt: this.now().toISOString(),
        attempted: false,
        attempts: 0,
      },
      fingerprint,
    );
  }
  private async invalidate(row: PendingWrite): Promise<void> {
    const state = await this.repository.state(row.accountId, row.calendarId);
    await this.repository.putState({
      ...state,
      invalidated: true,
      retryAt: undefined,
    });
  }
  async recover(): Promise<void> {
    await this.db.outbox
      .where("status")
      .equals("sending")
      .modify({ status: "retry", retryAt: undefined });
  }
  async retry(id: string): Promise<void> {
    const row = await this.db.outbox.get(id);
    if (!row || row.status === "conflict")
      throw new AppError("invalid-request");
    await this.db.outbox.put({
      ...row,
      status: row.status === "awaiting-sync" ? "awaiting-sync" : "queued",
      retryAt: undefined,
      error: undefined,
    });
    if (row.status === "awaiting-sync") await this.invalidate(row);
  }
  async discard(id: string): Promise<void> {
    const row = await this.db.outbox.get(id);
    if (!row) return;
    if (row.status === "awaiting-sync") throw new AppError("invalid-request");
    await this.invalidate(row);
    await this.db.outbox.delete(id);
  }
  async resolve(id: string, choice: "google" | "mine"): Promise<void> {
    const row = await this.db.outbox.get(id);
    if (!row || row.status !== "conflict")
      throw new AppError("invalid-request");
    if (choice === "google") {
      await this.discard(id);
      return;
    }
    // A missing remote event is never recreated implicitly. A colliding create ID cannot be overwritten.
    if (!row.remote?.etag || row.kind === "create")
      throw new AppError("event-gone");
    await this.validateBase(row.remote, row.scope);
    await this.db.outbox.put({
      ...row,
      base: row.remote,
      remote: undefined,
      status: "queued",
      retryAt: undefined,
      error: undefined,
    });
  }
  private async complete(
    row: PendingWrite,
    remote?: CalendarEvent,
  ): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.outbox,
      this.db.syncStates,
      async () => {
        await this.invalidate(row);
        await this.db.outbox.put({
          ...row,
          ...(remote ? { event: remote } : {}),
          status: "awaiting-sync",
          retryAt: undefined,
          error: undefined,
          remote: undefined,
        });
      },
    );
  }
  private async attempt(
    row: PendingWrite,
    token: string,
    account: Parameters<typeof normalizeGoogleEvent>[1],
    calendar: Parameters<typeof normalizeGoogleEvent>[2],
  ): Promise<void> {
    let raw: GoogleEvent | undefined;
    const normalize = (value: GoogleEvent) =>
      normalizeGoogleEvent(
        value,
        account,
        calendar,
        row.event.timeZone,
        this.now().toISOString(),
      );
    if (row.kind !== "create" || row.attempted) {
      try {
        raw = await this.google.getEvent(token, row.calendarId, row.eventId);
      } catch (error) {
        if (
          !(error instanceof GoogleHttpError) ||
          ![404, 410].includes(error.status)
        )
          throw error;
      }
    }
    const remote =
      raw && raw.status !== "cancelled"
        ? (normalize(raw) ?? undefined)
        : undefined;
    if (row.kind === "delete" && !remote) {
      await this.complete(row);
      return;
    }
    if (
      row.kind !== "delete" &&
      raw?.extendedProperties?.private?.[MARKER] === row.id
    ) {
      // The previous response may have been lost. The marker acknowledges our exact operation.
      if (remote) {
        await this.complete(row, remote);
        return;
      }
    }
    if (
      (row.kind === "create" && raw) ||
      (row.kind !== "create" && (!remote || remote.etag !== row.base?.etag))
    ) {
      await this.db.outbox.put({
        ...row,
        status: "conflict",
        remote,
        error: new AppError(remote ? "event-conflict" : "event-gone").message,
      });
      return;
    }
    if (remote && !canEditEvent(remote, (await this.auth.snapshot()).accounts))
      throw new AppError("event-readonly");
    const sending: PendingWrite = {
      ...row,
      status: "sending",
      attempted: true,
      attempts: row.attempts + 1,
    };
    await this.db.outbox.put(sending);
    const body = {
      ...row.patch,
      extendedProperties: {
        private: { ...raw?.extendedProperties?.private, [MARKER]: row.id },
      },
    };
    if (row.kind === "delete") {
      await this.google.deleteEvent(
        token,
        row.calendarId,
        row.eventId,
        row.base!.etag!,
        row.sendUpdates,
      );
      await this.complete(sending);
    } else {
      const result =
        row.kind === "create"
          ? await this.google.insertEvent(
              token,
              row.calendarId,
              { ...body, id: row.eventId },
              row.sendUpdates,
            )
          : await this.google.patchEvent(
              token,
              row.calendarId,
              row.eventId,
              body,
              row.base!.etag!,
              row.sendUpdates,
            );
      if (result.id !== row.eventId) throw new AppError("invalid-response");
      const saved = normalize(result);
      if (!saved) throw new AppError("invalid-response");
      await this.complete(sending, saved);
    }
  }
  async run(): Promise<void> {
    const snapshot = await this.auth.snapshot();
    if (!snapshot.oauthConfigured) return;
    const rows = (await this.repository.pending()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    for (const initial of rows) {
      if (!["queued", "retry", "sending"].includes(initial.status)) continue;
      if (initial.retryAt && Date.parse(initial.retryAt) > this.now().getTime())
        continue;
      const account = snapshot.accounts.find((a) => a.id === initial.accountId);
      if (!account?.enabled || account.status === "reconnect") continue;
      try {
        await this.auth.withVerifiedToken(
          initial.accountId,
          async (token, verified) => {
            // Refresh ACLs immediately before writes; cached writer rights may have been revoked.
            const calendars = await this.google.listCalendars(token);
            const calendar = calendars.find((c) => c.id === initial.calendarId);
            if (!calendar || !writableCalendar(calendar.accessRole))
              throw new AppError("event-readonly");
            const current = await this.db.outbox.get(initial.id);
            if (current) await this.attempt(current, token, verified, calendar);
          },
          "event-write",
        );
      } catch (error) {
        const safe = asAppError(error);
        if (safe.code === "storage-error") throw error;
        const row = (await this.db.outbox.get(initial.id))!;
        if (!row) continue;
        if (safe.code === "event-conflict") {
          // A race after GET is caught by If-Match; a new GET on the next attempt captures the conflict.
          await this.db.outbox.put({
            ...row,
            status: "retry",
            retryAt: undefined,
            error: safe.message,
          });
          continue;
        }
        const retryable =
          safe.code === "network" ||
          safe.code === "rate-limited" ||
          (error instanceof GoogleHttpError && error.status >= 500) ||
          isReconnectError(safe.code);
        const delay = Math.max(
          safe.details.retryAfterSeconds ?? 0,
          Math.min(1800, 30 * 2 ** Math.min(row.attempts, 6)),
        );
        await this.db.outbox.put({
          ...row,
          status: retryable ? "retry" : "failed",
          error: safe.message,
          attempts: Math.max(row.attempts, initial.attempts + 1),
          retryAt: retryable
            ? Temporal.Instant.from(this.now().toISOString())
                .add({ seconds: delay })
                .toString()
            : undefined,
        });
      }
    }
    await this.auth.refreshBadge().catch(() => undefined);
  }
}
