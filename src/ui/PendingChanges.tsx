import { EVENT_COLORS } from "../calendar/event-options";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { EventRepository } from "../calendar/event-repository";
import type { Account, Command } from "../shared/model";
import type { PendingWrite } from "../calendar/write-model";
import { sendCommand } from "./client";
import "./event-writing.css";

const labels: Record<PendingWrite["status"], string> = {
  queued: "Saved locally · waiting to send",
  sending: "Sending to Google…",
  retry: "Waiting to retry",
  conflict: "Conflict · review required",
  failed: "Action required",
  "awaiting-sync": "Saved to Google · refreshing calendar",
};
export function PendingChanges({ accounts }: { accounts: Account[] }) {
  const data = useLiveQuery(async () => {
    try {
      return { rows: await new EventRepository().pending(), failed: false };
    } catch {
      return { rows: [], failed: true };
    }
  }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (command: Command) => {
    setBusy(true);
    setError("");
    try {
      await sendCommand(command);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not update this change.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pending-changes">
      <p className="editor-note">
        Changes are stored only on this device. Enabled accounts retry
        automatically when access returns. Account removal is blocked while
        changes are pending.
      </p>
      {error && (
        <p className="write-error" role="alert">
          {error}
        </p>
      )}
      {data?.failed && (
        <p className="write-error" role="alert">
          Local pending changes could not be read. Existing data has been kept.
        </p>
      )}
      {data && !data.failed && data.rows.length === 0 && (
        <p>No pending event changes.</p>
      )}
      {data?.rows.map((row) => {
        const account = accounts.find((a) => a.id === row.accountId);
        return (
          <article className="pending-change" key={row.id}>
            <strong>{row.event.title}</strong>
            <p>
              {row.event.accountName} · {row.event.calendarName}
            </p>
            <p>
              {row.kind === "delete"
                ? "Delete"
                : row.kind === "create"
                  ? "Create"
                  : "Edit"}
              {row.scope === "series" ? " entire series" : " event"} ·{" "}
              {labels[row.status]}
            </p>
            {(!account || !account.enabled) && (
              <p className="write-error">
                {account
                  ? "Account is paused. Enable it to send this change."
                  : "Account is no longer connected. Your change is preserved."}
              </p>
            )}
            {row.error && <p className="write-error">{row.error}</p>}
            {row.openAfterSave && (
              <p>Google Calendar will open when this event is saved online.</p>
            )}
            {row.retryAt && (
              <p>Next retry after {new Date(row.retryAt).toLocaleString()}.</p>
            )}
            {row.scope === "series" && (
              <p>
                Series times and recurrence refresh after Google
                synchronization.
              </p>
            )}
            {row.status === "conflict" && (
              <p>
                Only fields you changed are applied; other Google fields are
                kept.
              </p>
            )}
            {row.status === "conflict" && (
              <div className="conflict-versions">
                {[
                  ["Your version", row.event],
                  ["Google version", row.remote],
                ].map(([label, value]) => {
                  const event = value as PendingWrite["event"] | undefined;
                  return (
                    <div key={String(label)}>
                      <b>{String(label)}</b>
                      {event ? (
                        <>
                          <p>{event.title}</p>
                          <p>
                            {event.start} → {event.end} ({event.timeZone})
                          </p>
                          <p>{event.location || "No location"}</p>
                          <p className="pending-description">
                            {event.description || "No description"}
                          </p>
                          <p>
                            {event.transparency === "transparent"
                              ? "Free"
                              : "Busy"}{" "}
                            · {event.visibility ?? "default"} visibility ·{" "}
                            {EVENT_COLORS.find(
                              ([id]) => id === event.colorId,
                            )?.[1] ?? "Calendar default"}{" "}
                            color
                          </p>
                          <p>
                            Notifications:{" "}
                            {event.reminders?.useDefault !== false
                              ? "Calendar defaults"
                              : event.reminders.overrides
                                  ?.map(
                                    (r) =>
                                      `${r.method === "popup" ? "Notification" : "Email"} ${r.minutes} min before`,
                                  )
                                  .join(", ") || "None"}
                          </p>
                          <p className="pending-description">
                            Guests:{" "}
                            {event.attendees
                              ?.map(
                                (a) =>
                                  `${a.email ?? a.displayName ?? "Guest"}${a.optional ? " (optional)" : ""}`,
                              )
                              .join(", ") ||
                              (event.attendeeCount
                                ? `${event.attendeeCount} (list unavailable)`
                                : "None")}
                          </p>
                          <p>
                            Guest permissions: modify{" "}
                            {event.guestsCanModify ? "yes" : "no"}, invite{" "}
                            {event.guestsCanInviteOthers === false
                              ? "no"
                              : "yes"}
                            , view guests{" "}
                            {event.guestsCanSeeOtherGuests === false
                              ? "no"
                              : "yes"}
                          </p>
                          <p>
                            Conference:{" "}
                            {event.meetingLink ??
                              (event.conferenceStatus === "pending"
                                ? "Google Meet requested"
                                : (event.conferenceType ?? "None"))}
                          </p>
                          {event.recurrence?.length ? (
                            <p>{event.recurrence.join(" · ")}</p>
                          ) : null}
                        </>
                      ) : (
                        <p>Deleted or unavailable</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="write-actions">
              {row.status === "conflict" ? (
                <>
                  <button
                    className="write-button"
                    disabled={busy}
                    onClick={() =>
                      void act({
                        type: "RESOLVE_WRITE",
                        id: row.id,
                        choice: "google",
                      })
                    }
                  >
                    Use Google version
                  </button>
                  {row.remote?.etag && row.kind !== "create" && (
                    <button
                      className="write-button primary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Apply your changed fields over the Google version shown here? A newer Google change will cause another conflict.",
                          )
                        )
                          void act({
                            type: "RESOLVE_WRITE",
                            id: row.id,
                            choice: "mine",
                          });
                      }}
                    >
                      Apply my changes
                    </button>
                  )}
                </>
              ) : (
                <button
                  className="write-button"
                  disabled={busy || row.status === "sending"}
                  onClick={() => void act({ type: "RETRY_WRITE", id: row.id })}
                >
                  {row.status === "awaiting-sync"
                    ? "Refresh calendar"
                    : "Retry now"}
                </button>
              )}
              {row.status !== "awaiting-sync" && (
                <button
                  className="write-button danger"
                  disabled={busy || row.status === "sending"}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Discard this local change? This does not undo any change already received by Google.",
                      )
                    )
                      void act({ type: "DISCARD_WRITE", id: row.id });
                  }}
                >
                  Discard local change
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
