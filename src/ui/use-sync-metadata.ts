import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getCalendarDatabase } from "../calendar/database";
import type { SyncMetadata } from "../calendar/sync-model";
export function useSyncMetadata() {
  return useLiveQuery(async (): Promise<SyncMetadata> => {
    try {
      const db = getCalendarDatabase();
      return await db.transaction("r", db.syncStates, db.ranges, async () => ({
        states: (await db.syncStates.toArray()).map(
          ({ syncToken: _cursor, ...state }) => state,
        ),
        ranges: (await db.ranges.toArray()).map(
          ({ eventKeys: _keys, ...range }) => range,
        ),
        failed: false,
      }));
    } catch {
      return { states: [], ranges: [], failed: true };
    }
  }, []);
}
export function useConnectionClock() {
  const [value, setValue] = useState({
    online: navigator.onLine,
    now: Date.now(),
  });
  useEffect(() => {
    const update = () =>
      setValue({ online: navigator.onLine, now: Date.now() });
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const timer = window.setInterval(update, 30_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.clearInterval(timer);
    };
  }, []);
  return value;
}
