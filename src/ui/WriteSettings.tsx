import { useState } from "react";
import type { Account, Settings, Command } from "../shared/model";
import { calendarKey } from "../shared/preferences";
import { writableCalendar } from "../calendar/write-model";
import { PendingChanges } from "./PendingChanges";

export function WriteSettings({
  accounts,
  settings,
  busy,
  run,
}: {
  accounts: Account[];
  settings: Settings;
  busy: boolean;
  run: (command: Command, notice?: string) => Promise<void>;
}) {
  const [defaultCalendar, setDefaultCalendar] = useState(
    settings.defaultWriteCalendar,
  );
  const choices = accounts
    .filter((a) => a.enabled)
    .flatMap((a) =>
      a.calendars
        .filter((c) => writableCalendar(c.accessRole))
        .map((c) => ({
          key: calendarKey(a.id, c.id),
          label: `${a.email} · ${c.summary}`,
        })),
    );
  return (
    <section className="settings-section">
      <p className="eyebrow">EVENT EDITING</p>
      <h2>Writing and pending changes</h2>
      <p className="muted">
        Use Reconnect on existing accounts to approve Google event editing.
        Creating and editing events saves a local pending change before
        contacting Google.
      </p>
      <form
        className="settings-form appearance-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            {
              type: "UPDATE_SETTINGS",
              settings: { defaultWriteCalendar: defaultCalendar },
            },
            "Default event calendar saved.",
          );
        }}
      >
        <label>
          Default calendar for new events
          <select
            value={defaultCalendar}
            onChange={(e) => setDefaultCalendar(e.target.value)}
          >
            <option value="">Automatic · primary writable calendar</option>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
            {defaultCalendar &&
              !choices.some((c) => c.key === defaultCalendar) && (
                <option value={defaultCalendar}>
                  Saved calendar is unavailable
                </option>
              )}
          </select>
        </label>
        <button className="button primary" disabled={busy}>
          Save event preferences
        </button>
      </form>
      <h3>Pending event changes</h3>
      <PendingChanges accounts={accounts} />
    </section>
  );
}
