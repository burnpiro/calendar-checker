import {
  AutoSaveStatus,
  useAutoSavePreferences,
} from "./use-auto-save-preferences";
import type { Account, Settings } from "../shared/model";
import { calendarKey } from "../shared/preferences";
import { writableCalendar } from "../calendar/write-model";
import { PendingChanges } from "./PendingChanges";

export function WriteSettings({
  accounts,
  settings,
}: {
  accounts: Account[];
  settings: Settings;
}) {
  const save = useAutoSavePreferences(
    settings,
    (s) => ({ defaultWriteCalendar: s.defaultWriteCalendar }),
    (d) => d,
  );
  const defaultCalendar = save.draft.defaultWriteCalendar;
  const setDefaultCalendar = (value: string) =>
    save.setDraft({ defaultWriteCalendar: value });
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
        onSubmit={(event) => event.preventDefault()}
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
        <AutoSaveStatus {...save} />
      </form>
      <h3>Pending event changes</h3>
      <PendingChanges accounts={accounts} />
    </section>
  );
}
