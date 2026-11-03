import {
  DESCRIPTION_PRIVACY_KEY,
  omitDescription,
  omitWriteDescriptions,
} from "./description-privacy";
import { eventColor } from "./event-options";
import { overlayWrites, pendingWriteSchema } from "./write-model";
import { AppError } from "../shared/errors";
import type { Account } from "../shared/model";
import { calendarKey } from "../shared/preferences";
import { getCalendarDatabase, type CalendarDatabase } from "./database";
import { eventSchema, type CalendarEvent } from "./model";
import {
  cachedRangeSchema,
  emptySyncState,
  syncStateSchema,
  type CachedRange,
  type CalendarSyncState,
  type SyncMetadata,
} from "./sync-model";

export class EventRepository {
  constructor(readonly db: CalendarDatabase = getCalendarDatabase()) {}
  async applyDescriptionPrivacy(exclude: boolean): Promise<void> {
    try {
      await this.db.transaction(
        "rw",
        [
          this.db.events,
          this.db.editBases,
          this.db.outbox,
          this.db.syncStates,
          this.db.meta,
        ],
        async () => {
          const value = exclude ? "excluded" : "included";
          const previous = await this.db.meta.get(DESCRIPTION_PRIVACY_KEY);
          if (previous?.value === value) return;
          if (exclude) {
            await this.db.events.toCollection().modify((event) => {
              Object.assign(event, omitDescription(event));
            });
            await this.db.editBases.toCollection().modify((row) => {
              row.event = omitDescription(row.event);
            });
            await this.db.outbox.toCollection().modify((row) => {
              Object.assign(row, omitWriteDescriptions(row));
            });
          }
          // Re-enable descriptions even if Google's change feed reports no changes.
          // Keep cursors/coverage and the last usable offline snapshot intact.
          if (previous || exclude)
            await this.db.syncStates
              .toCollection()
              .modify({ invalidated: true });
          await this.db.meta.put({ key: DESCRIPTION_PRIVACY_KEY, value });
        },
      );
    } catch {
      throw new AppError("storage-error");
    }
  }
  async pending() {
    try {
      return (await this.db.outbox.toArray()).map((row) =>
        pendingWriteSchema.parse(row),
      );
    } catch {
      throw new AppError("storage-error");
    }
  }
  async state(
    accountId: string,
    calendarId: string,
  ): Promise<CalendarSyncState> {
    try {
      return syncStateSchema.parse(
        (await this.db.syncStates.get(calendarKey(accountId, calendarId))) ??
          emptySyncState(accountId, calendarId),
      );
    } catch {
      throw new AppError("storage-error");
    }
  }
  async ranges(accountId: string, calendarId: string): Promise<CachedRange[]> {
    try {
      return (
        await this.db.ranges
          .where("[accountId+calendarId]")
          .equals([accountId, calendarId])
          .toArray()
      ).map((row) => cachedRangeSchema.parse(row));
    } catch {
      throw new AppError("storage-error");
    }
  }
  async putState(state: CalendarSyncState): Promise<void> {
    try {
      await this.db.syncStates.put(syncStateSchema.parse(state));
    } catch {
      throw new AppError("storage-error");
    }
  }
  async commit(
    state: CalendarSyncState,
    ranges: CachedRange[],
    events: CalendarEvent[],
    labels?: Pick<CalendarEvent, "calendarName" | "accountName" | "color">,
  ): Promise<void> {
    try {
      const next = syncStateSchema.parse(state);
      const snapshots = ranges.map((range) => cachedRangeSchema.parse(range));
      const normalized = events.map((event) => eventSchema.parse(event));
      if (
        snapshots.some(
          (r) =>
            r.accountId !== next.accountId || r.calendarId !== next.calendarId,
        ) ||
        normalized.some(
          (e) =>
            e.source !== "google" ||
            e.accountId !== next.accountId ||
            e.calendarId !== next.calendarId,
        )
      )
        throw new Error();
      await this.db.transaction(
        "rw",
        this.db.events,
        this.db.ranges,
        this.db.syncStates,
        this.db.outbox,
        this.db.meta,
        async () => {
          const keep = new Set(snapshots.flatMap((range) => range.eventKeys));
          await this.db.events
            .where("[accountId+calendarId]")
            .equals([next.accountId, next.calendarId])
            .filter((event) => !keep.has(event.key))
            .delete();
          const exclude =
            (await this.db.meta.get(DESCRIPTION_PRIVACY_KEY))?.value ===
            "excluded";
          await this.db.events.bulkPut(
            exclude ? normalized.map(omitDescription) : normalized,
          );
          if (labels)
            await this.db.events
              .where("[accountId+calendarId]")
              .equals([next.accountId, next.calendarId])
              .modify((event) => {
                event.calendarName = labels.calendarName;
                event.accountName = labels.accountName;
                event.color = eventColor(event.colorId, labels.color);
              });
          await this.db.ranges
            .where("[accountId+calendarId]")
            .equals([next.accountId, next.calendarId])
            .delete();
          await this.db.ranges.bulkPut(snapshots);
          await this.db.syncStates.put(next);
          if (!next.invalidated && next.dataKind !== "freebusy")
            await this.db.outbox
              .where("[accountId+calendarId]")
              .equals([next.accountId, next.calendarId])
              .filter((row) => row.status === "awaiting-sync")
              .delete();
        },
      );
    } catch {
      throw new AppError("storage-error");
    }
  }
  async reconcile(accounts: Account[]): Promise<void> {
    const keep = new Set(
      accounts.flatMap((account) =>
        account.calendars.map((calendar) =>
          calendarKey(account.id, calendar.id),
        ),
      ),
    );
    try {
      await this.db.transaction(
        "rw",
        this.db.events,
        this.db.ranges,
        this.db.syncStates,
        this.db.editBases,
        async () => {
          await this.db.editBases
            .filter(
              (row) =>
                !keep.has(
                  calendarKey(row.event.accountId, row.event.calendarId),
                ),
            )
            .delete();
          for (const table of [
            this.db.events,
            this.db.ranges,
            this.db.syncStates,
          ]) {
            await table
              .filter(
                (row) => !keep.has(calendarKey(row.accountId, row.calendarId)),
              )
              .delete();
          }
        },
      );
    } catch {
      throw new AppError("storage-error");
    }
  }
  async recover(): Promise<void> {
    const interrupted = await this.db.syncStates
      .filter((state) => state.running)
      .toArray();
    for (const state of interrupted)
      await this.putState({
        ...state,
        running: false,
        invalidated: true,
        errorCode: "unexpected",
      });
  }
  async resumeAccount(accountId: string): Promise<void> {
    const states = await this.db.syncStates
      .where("accountId")
      .equals(accountId)
      .toArray();
    for (const state of states.filter((item) =>
      [
        "permission-required",
        "reconnect-required",
        "account-mismatch",
      ].includes(item.errorCode ?? ""),
    )) {
      await this.putState({
        ...state,
        running: false,
        failures: 0,
        retryAt: undefined,
        errorCode: undefined,
        errorDetails: undefined,
      });
    }
  }
  async toolbarData(
    now: Date,
  ): Promise<{ events: CalendarEvent[]; metadata: SyncMetadata }> {
    try {
      return await this.db.transaction(
        "r",
        this.db.events,
        this.db.ranges,
        this.db.syncStates,
        this.db.outbox,
        async () => ({
          // Use a whole-second lower bound because normalized instants can omit
          // fractional seconds. Include ongoing availability to recognize its
          // future midnight segments as continuations, not new badge starts.
          events: overlayWrites(
            await this.db.events
              .where("end")
              .aboveOrEqual(now.toISOString().slice(0, 19))
              .filter(
                (event) =>
                  !event.allDay &&
                  event.responseStatus !== "declined" &&
                  (event.availabilityOnly === true ||
                    Date.parse(event.start) >= now.getTime()),
              )
              .toArray(),
            await this.pending(),
          ),
          metadata: {
            states: (await this.db.syncStates.toArray()).map(
              ({ syncToken: _cursor, ...state }) => state,
            ),
            ranges: (await this.db.ranges.toArray()).map(
              ({ eventKeys: _keys, ...range }) => range,
            ),
            failed: false,
          },
        }),
      );
    } catch {
      throw new AppError("storage-error");
    }
  }
  async summary() {
    try {
      return await this.db.transaction(
        "r",
        this.db.syncStates,
        this.db.ranges,
        async () => {
          const states = await this.db.syncStates.toArray();
          return {
            calendars: states.length,
            cachedRanges: await this.db.ranges.count(),
            failedCalendars: states.filter((state) => state.errorCode).length,
            runningCalendars: states.filter((state) => state.running).length,
          };
        },
      );
    } catch {
      throw new AppError("storage-error");
    }
  }
}
