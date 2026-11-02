import { SerialQueue } from "../background/serial-queue";
import type { CalendarDatabase } from "../calendar/database";
import { EventRepository } from "../calendar/event-repository";
import { overlayWrites } from "../calendar/write-model";
import type { Snapshot } from "../shared/model";
import { AppError } from "../shared/errors";
import { jobSchema, type ReminderJob } from "./model";
import { dndActive, reminderCandidates, reminderPolicy } from "./planning";

export interface ReminderDelivery {
  desktop(job: ReminderJob, snapshot: Snapshot): Promise<void>;
  sound(id: string, volume: number): Promise<void>;
  clear(id: string): Promise<void>;
  stop?(): Promise<void>;
  schedule(when?: number): Promise<void>;
}
/** Own serial queue: no network sync or authorization prompt can block a due alert. */
export class ReminderService {
  private readonly queue = new SerialQueue();
  constructor(
    readonly db: CalendarDatabase,
    private readonly snapshot: () => Promise<Snapshot>,
    private readonly port: ReminderDelivery,
    private readonly now = () => new Date(),
  ) {}
  async jobs(): Promise<ReminderJob[]> {
    try {
      return (await this.db.reminders.toArray()).map((r) => jobSchema.parse(r));
    } catch {
      throw new AppError("storage-error");
    }
  }
  run(): Promise<void> {
    return this.queue.run(() => this.reconcileAndDeliver());
  }
  private async reconcileAndDeliver(): Promise<void> {
    const snapshot = await this.snapshot(),
      now = this.now(),
      ms = now.getTime();
    const events = await this.db.transaction(
      "r",
      this.db.events,
      this.db.outbox,
      async () =>
        overlayWrites(
          await this.db.events.toArray(),
          await new EventRepository(this.db).pending(),
        ),
    );
    if (
      !snapshot.settings.reminders.sound ||
      dndActive(snapshot.settings.dnd, now)
    )
      await this.port.stop?.().catch(() => undefined);
    const candidates = reminderCandidates(
      events,
      snapshot.accounts,
      snapshot.settings,
      now,
    );
    const wanted = new Set(candidates.map((c) => c.key));
    const sources = new Set(
      snapshot.accounts.flatMap((a) =>
        a.calendars.map((c) => JSON.stringify([a.id, c.id])),
      ),
    );
    const previous = await this.jobs(),
      byKey = new Map(previous.map((j) => [j.key, j]));
    const clear: string[] = [];
    const previousPrivacy = await this.db.meta.get("reminder-privacy");
    if (
      previousPrivacy &&
      previousPrivacy.value !== snapshot.settings.reminders.privacy
    )
      clear.push(
        ...previous.filter((j) => j.status === "delivered").map((j) => j.id),
      );
    await this.db.meta.put({
      key: "reminder-privacy",
      value: snapshot.settings.reminders.privacy,
    });
    await this.db.transaction("rw", this.db.reminders, async () => {
      for (const candidate of candidates) {
        const old = byKey.get(candidate.key);
        const revive =
          old?.status === "cancelled" && Date.parse(candidate.dueAt) > ms;
        await this.db.reminders.put(
          old
            ? {
                ...old,
                event: candidate.event,
                ...(revive
                  ? { status: "scheduled" as const, error: undefined }
                  : {}),
              }
            : { ...candidate, id: crypto.randomUUID(), status: "scheduled" },
        );
      }
      for (const old of previous) {
        if (
          !wanted.has(old.key) &&
          !sources.has(
            JSON.stringify([old.event.accountId, old.event.calendarId]),
          )
        ) {
          await this.db.reminders.delete(old.key);
          clear.push(old.id);
          continue;
        }
        if (
          !wanted.has(old.key) &&
          !["dismissed", "missed", "cancelled"].includes(old.status)
        ) {
          const expired =
            Date.parse(old.dueAt) <= ms &&
            (Date.parse(old.endAt) <= ms ||
              ms - Date.parse(old.dueAt) >
                snapshot.settings.reminders.graceMinutes * 60_000);
          const exists = events.some(
            (event) =>
              event.calendarId === old.event.calendarId &&
              event.eventId === old.event.eventId &&
              event.start === old.event.start,
          );
          if (old.status === "delivered") {
            if (!old.closed) {
              clear.push(old.id);
              await this.db.reminders.put({ ...old, closed: true });
            }
          } else {
            await this.db.reminders.put({
              ...old,
              status: expired && exists ? "missed" : "cancelled",
              error:
                expired && exists
                  ? "Missed reminder window or event ended"
                  : old.error,
            });
            clear.push(old.id);
          }
        }
      }
      await this.db.reminders
        .filter((j) => Date.parse(j.endAt) < ms - 7 * 86400_000)
        .delete();
    });
    for (const id of new Set(clear))
      await this.port.clear(id).catch(() => undefined);
    const due = (await this.jobs())
      .filter(
        (j) =>
          ["scheduled", "snoozed", "delivering"].includes(j.status) &&
          Date.parse(j.dueAt) <= ms,
      )
      .sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt));
    const seen = new Set<string>();
    for (const row of due) {
      const policy = reminderPolicy(snapshot.settings, row.event.calendarId);
      const group = JSON.stringify([
        row.event.calendarId,
        row.event.eventId,
        row.startAt,
      ]);
      let reason: string | undefined;
      if (Date.parse(row.endAt) <= ms) reason = "Event has ended";
      else if (
        ms - Date.parse(row.dueAt) >
          snapshot.settings.reminders.graceMinutes * 60_000 ||
        (snapshot.settings.reminders.missed === "skip" &&
          ms - Date.parse(row.dueAt) > 60_000)
      )
        reason = "Missed reminder window";
      else if (!policy.desktop && !policy.sound) reason = "Reminders disabled";
      else if (seen.has(group))
        reason = "Combined with a newer reminder for this event";
      if (!reason && dndActive(snapshot.settings.dnd, now)) {
        if (snapshot.settings.dnd.policy === "defer") continue;
        reason = "Do not disturb";
      }
      if (reason) {
        await this.db.reminders.put({
          ...row,
          status: "missed",
          error: reason,
        });
        continue;
      }
      seen.add(group);
      let job: ReminderJob = { ...row, status: "delivering" };
      await this.db.reminders.put(job);
      const errors: string[] = [];
      if (policy.desktop && !job.desktopDone) {
        try {
          await this.port.desktop(job, snapshot);
          job.desktopDone = true;
        } catch {
          errors.push(
            "Desktop notification unavailable. Check Chrome and operating-system notification settings.",
          );
        }
      }
      if (policy.sound && !job.soundAttempted) {
        // Persist before audio: recovery may replace the same desktop ID but never replay uncertain sound.
        job = { ...job, soundAttempted: true };
        await this.db.reminders.put(job);
        try {
          await this.port.sound(policy.soundId, policy.volume);
        } catch {
          errors.push(
            "Sound could not play. Preview the selected sound in Settings.",
          );
        }
      }
      await this.db.reminders.put({
        ...job,
        status: "delivered",
        deliveredAt: now.toISOString(),
        error: errors.join(" ") || undefined,
      });
    }
    const next = (await this.jobs()).filter((j) =>
      ["scheduled", "snoozed", "delivering"].includes(j.status),
    );
    await this.port.schedule(
      next.length
        ? Math.max(
            ms + 1000,
            Math.min(
              ...next.map((j) =>
                Date.parse(j.dueAt) <= ms ? ms + 60_000 : Date.parse(j.dueAt),
              ),
            ),
          )
        : undefined,
    );
  }
  action(
    id: string,
    action: "dismiss" | "snooze",
    minutes?: number,
  ): Promise<void> {
    return this.queue.run(() => this.performAction(id, action, minutes));
  }
  private async performAction(
    id: string,
    action: "dismiss" | "snooze",
    minutes?: number,
  ): Promise<void> {
    const row = await this.db.reminders.where("id").equals(id).first();
    if (!row || !["delivered", "delivering", "snoozed"].includes(row.status))
      throw new AppError("invalid-request");
    if (action === "dismiss")
      await this.db.reminders.put({ ...row, status: "dismissed" });
    else {
      const snapshot = await this.snapshot();
      const delay = minutes ?? snapshot.settings.reminders.snoozePresets[0]!;
      if (!Number.isInteger(delay) || delay < 1 || delay > 1440)
        throw new AppError("invalid-request");
      const due = new Date(this.now().getTime() + delay * 60_000);
      if (due.getTime() >= Date.parse(row.endAt))
        throw new AppError("reminder-ended");
      await this.db.reminders.put({
        ...row,
        status: "snoozed",
        snoozedAt: this.now().toISOString(),
        dueAt: due.toISOString(),
        desktopDone: false,
        soundAttempted: false,
        closed: false,
        error: undefined,
      });
    }
    await this.port.clear(row.id).catch(() => undefined);
  }
}
