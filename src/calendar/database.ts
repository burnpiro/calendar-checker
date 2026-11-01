import { Dexie, type EntityTable } from "dexie";
import { Temporal } from "temporal-polyfill";
import { AppError } from "../shared/errors";
import { isTimeZone } from "../shared/preferences";
import { eventSchema, type CalendarEvent } from "./model";
import { makeDemoMonth } from "./demo";

interface Meta {
  key: string;
  value: string;
}
export class CalendarDatabase extends Dexie {
  events!: EntityTable<CalendarEvent, "key">;
  demoEvents!: EntityTable<CalendarEvent, "key">;
  meta!: EntityTable<Meta, "key">;
  constructor(name = "calendar-checker-events") {
    super(name);
    this.version(1).stores({
      events: "&key, [accountId+calendarId], start, end, eventType",
      demoEvents: "&key, [accountId+calendarId], start, end, eventType",
      meta: "&key",
    });
  }
}
let database: CalendarDatabase | undefined;
export function getCalendarDatabase(): CalendarDatabase {
  return (database ??= new CalendarDatabase());
}

export interface LocalCalendarPort {
  prepareDemo(month: string, timeZone: string): Promise<void>;
  resetDemo(): Promise<void>;
}
export class LocalCalendarRepository implements LocalCalendarPort {
  constructor(private readonly db = getCalendarDatabase()) {}
  async prepareDemo(month: string, timeZone: string): Promise<void> {
    if (!isTimeZone(timeZone) || timeZone === "device")
      throw new AppError("invalid-request");
    let anchor: Temporal.PlainDate;
    try {
      anchor = Temporal.PlainDate.from(month);
      if (anchor.day !== 1) throw new Error();
    } catch {
      throw new AppError("invalid-request");
    }
    try {
      // A month on either side covers six-row month grids and weeks across boundaries.
      for (const offset of [-1, 0, 1]) {
        const date = anchor.add({ months: offset }).toString();
        const marker = `demo-v1:${date}`;
        if (await this.db.meta.get(marker)) continue;
        const events = makeDemoMonth(date, timeZone);
        await this.db.transaction(
          "rw",
          this.db.demoEvents,
          this.db.meta,
          async () => {
            if (await this.db.meta.get(marker)) return;
            await this.db.demoEvents.bulkPut(
              events.map((event) => eventSchema.parse(event)),
            );
            await this.db.meta.put({ key: marker, value: timeZone });
          },
        );
      }
    } catch {
      throw new AppError("storage-error");
    }
  }
  async resetDemo(): Promise<void> {
    try {
      await this.db.transaction(
        "rw",
        this.db.demoEvents,
        this.db.meta,
        async () => {
          await this.db.demoEvents.clear();
          await this.db.meta.where("key").startsWith("demo-v1:").delete();
        },
      );
    } catch {
      throw new AppError("storage-error");
    }
  }
}
