import { Dexie, type EntityTable } from "dexie";
import type { CalendarEvent } from "./model";
import type { CalendarSyncState, CachedRange } from "./sync-model";

interface Meta {
  key: string;
  value: string;
}
export class CalendarDatabase extends Dexie {
  events!: EntityTable<CalendarEvent, "key">;
  meta!: EntityTable<Meta, "key">;
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
  }
}
let database: CalendarDatabase | undefined;
export function getCalendarDatabase(): CalendarDatabase {
  return (database ??= new CalendarDatabase());
}
