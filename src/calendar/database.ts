import { Dexie, type EntityTable } from "dexie";
import type { CalendarEvent } from "./model";
import type { CalendarSyncState, CachedRange } from "./sync-model";

import type { PendingWrite, EditBase } from "./write-model";

interface Meta {
  key: string;
  value: string;
}
export class CalendarDatabase extends Dexie {
  events!: EntityTable<CalendarEvent, "key">;
  meta!: EntityTable<Meta, "key">;
  outbox!: EntityTable<PendingWrite, "id">;
  editBases!: EntityTable<EditBase, "key">;
  syncStates!: EntityTable<CalendarSyncState, "key">;
  ranges!: EntityTable<CachedRange, "key">;
  constructor(name = "calendar-checker-events") {
    super(name);
    this.version(1).stores({
      events: "&key, [accountId+calendarId], start, end, eventType",
      demoEvents: "&key, [accountId+calendarId], start, end, eventType",
      meta: "&key",
    });
    this.version(2).stores({
      syncStates: "&key, accountId, [accountId+calendarId]",
      ranges: "&key, accountId, [accountId+calendarId]",
    });
    this.version(3)
      .stores({ demoEvents: null })
      .upgrade(async (transaction) => {
        await transaction
          .table("meta")
          .where("key")
          .startsWith("demo-v1:")
          .delete();
      });
    this.version(4).stores({
      outbox: "&id, accountId, [accountId+calendarId], status",
      editBases: "&key",
    });
  }
}
let database: CalendarDatabase | undefined;
export function getCalendarDatabase(): CalendarDatabase {
  return (database ??= new CalendarDatabase());
}
