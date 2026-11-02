import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getCalendarDatabase } from "../calendar/database";
import { jobSchema } from "../reminders/model";
import type { Settings } from "../shared/model";
import { displayTimeZone } from "../shared/preferences";
import { eventWhen } from "../calendar/presentation";
import { sendCommand } from "./client";
import "./reminders.css";
export function ReminderInbox({ settings }: { settings: Settings }) {
  const data = useLiveQuery(async () => {
    try {
      return {
        rows: (await getCalendarDatabase().reminders.toArray())
          .map((r) => jobSchema.parse(r))
          .filter((r) =>
            ["delivered", "delivering", "snoozed", "missed"].includes(r.status),
          )
          .sort(
            (a, b) =>
              Date.parse(b.deliveredAt ?? b.dueAt) -
              Date.parse(a.deliveredAt ?? a.dueAt),
          )
          .slice(0, 50),
        failed: false,
      };
    } catch {
      return { rows: [], failed: true };
    }
  }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (
    id: string,
    action: "dismiss" | "snooze",
    minutes?: number,
  ) => {
    setBusy(true);
    setError("");
    try {
      await sendCommand({ type: "REMINDER_ACTION", id, action, minutes });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update reminder.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="reminder-inbox">
      {error && (
        <p className="write-error" role="alert">
          {error}
        </p>
      )}
      {data?.failed && (
        <p role="alert">Saved reminder history could not be read.</p>
      )}
      {data && !data.failed && !data.rows.length && (
        <p>
          No recent reminders. Enable desktop or sound reminders in Settings.
        </p>
      )}
      {data?.rows.map((job) => (
        <article key={job.key} className="reminder-card">
          <strong>{job.event.title}</strong>
          <p>
            {eventWhen(
              job.event,
              displayTimeZone(settings.primaryTimeZone),
              settings.timeFormat,
            )}
          </p>
          <p>
            {job.event.calendarName} ·{" "}
            {job.status === "snoozed"
              ? `Snoozed until ${new Date(job.dueAt).toLocaleString()}`
              : job.status === "missed"
                ? "Not delivered"
                : "Reminder"}
          </p>
          {job.error && <p className="write-error">{job.error}</p>}
          {job.status !== "missed" && (
            <div className="reminder-actions">
              {settings.reminders.snoozePresets.map((minutes) => (
                <button
                  type="button"
                  className="write-button"
                  key={minutes}
                  disabled={
                    busy ||
                    Date.now() + minutes * 60_000 >= Date.parse(job.endAt)
                  }
                  onClick={() => void act(job.id, "snooze", minutes)}
                >
                  Snooze {minutes}m
                </button>
              ))}
              <button
                type="button"
                className="write-button"
                disabled={busy}
                onClick={() => void act(job.id, "dismiss")}
              >
                Dismiss
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
