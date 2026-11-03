import { useLiveQuery } from "dexie-react-hooks";
import { getCalendarDatabase } from "../calendar/database";
import type { Settings } from "../shared/model";
import { numericPreference } from "./preference-autosave";
import {
  AutoSaveStatus,
  useAutoSavePreferences,
} from "./use-auto-save-preferences";

const appearanceDraft = (settings: Settings) => ({
  defaultView: settings.defaultView,
  theme: settings.theme,
  weekStartsOn: settings.weekStartsOn,
  timeFormat: settings.timeFormat,
  density: settings.density,
  showWeekends: settings.showWeekends,
  primaryTimeZone: settings.primaryTimeZone,
  secondaryTimeZone: settings.secondaryTimeZone,
  weekStartHour: settings.weekStartHour as number | string,
  weekEndHour: settings.weekEndHour as number | string,
  weekLayout: settings.weekLayout,
  weekHourHeight: settings.weekHourHeight as number | string,
  showEventBadge: settings.showEventBadge,
});
export function AppearanceSettings({ settings }: { settings: Settings }) {
  const save = useAutoSavePreferences(settings, appearanceDraft, (draft) => ({
    ...draft,
    weekStartHour: numericPreference(draft.weekStartHour),
    weekEndHour: numericPreference(draft.weekEndHour),
    weekHourHeight: numericPreference(draft.weekHourHeight),
  }));
  const { draft, setDraft } = save;
  const zones = [
    ...new Set([
      "device",
      "UTC",
      "Europe/Warsaw",
      "Europe/London",
      "America/New_York",
      "America/Los_Angeles",
      "Asia/Tokyo",
      draft.primaryTimeZone,
      draft.secondaryTimeZone,
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  ];
  return (
    <>
      <section className="settings-section">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h2>Calendar appearance</h2>
          <p className="muted">
            Shared by the popup and full calendar. Valid changes save
            automatically.
          </p>
        </div>
        <form
          className="settings-form appearance-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset className="settings-field-group">
            <legend>Display</legend>
            <label>
              Default view
              <select
                value={draft.defaultView}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    defaultView: event.target.value as Settings["defaultView"],
                  })
                }
              >
                <option value="month">Month</option>
                <option value="week">Week</option>
              </select>
            </label>
            <label>
              Theme
              <select
                value={draft.theme}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    theme: event.target.value as Settings["theme"],
                  })
                }
              >
                <option value="system">Follow device</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label>
              Week starts on
              <select
                value={draft.weekStartsOn}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    weekStartsOn: Number(event.target.value),
                  })
                }
              >
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((day, index) => (
                  <option value={index} key={day}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clock format
              <select
                value={draft.timeFormat}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    timeFormat: event.target.value as Settings["timeFormat"],
                  })
                }
              >
                <option value="24h">24-hour · 14:30</option>
                <option value="12h">12-hour · 2:30 PM</option>
              </select>
            </label>
            <label>
              Density
              <select
                value={draft.density}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    density: event.target.value as Settings["density"],
                  })
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
              <small>
                Compact uses tighter controls, sidebar and event rows in both
                calendar windows. Week hour height is configured separately.
              </small>
            </label>
            <label className="check-setting">
              <input
                type="checkbox"
                checked={draft.showWeekends}
                onChange={(event) =>
                  setDraft({ ...draft, showWeekends: event.target.checked })
                }
              />
              Show weekends
            </label>
          </fieldset>
          <fieldset className="settings-field-group">
            <legend>Time zones</legend>
            <label>
              Primary time zone
              <input
                list="time-zone-options"
                value={draft.primaryTimeZone}
                onChange={(event) =>
                  setDraft({ ...draft, primaryTimeZone: event.target.value })
                }
                required
              />
              <datalist id="time-zone-options">
                {zones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
              <small>
                Use “device” to follow your computer, or an IANA name such as
                Europe/Warsaw.
              </small>
            </label>
            <label>
              Secondary time zone
              <input
                list="time-zone-options"
                value={draft.secondaryTimeZone}
                onChange={(e) =>
                  setDraft({ ...draft, secondaryTimeZone: e.target.value })
                }
                placeholder="Disabled"
              />
              <small>
                Leave empty to show only the primary zone. Use device to follow
                the computer. Week labels show multiple values when offsets vary
                during the week.
              </small>
            </label>
          </fieldset>
          <details className="settings-disclosure reminder-form-wide">
            <summary>
              <span>Week view layout</span>
              <small>Advanced · visible hours, scrolling and row height</small>
            </summary>
            <div className="settings-fields-grid">
              <label>
                Week view starts at
                <span className="input-unit">
                  <input
                    type="number"
                    min="0"
                    max="23"
                    required
                    value={draft.weekStartHour}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        weekStartHour: event.target.value,
                      })
                    }
                  />
                  :00
                </span>
              </label>
              <label>
                Week view ends at
                <span className="input-unit">
                  <input
                    type="number"
                    min="1"
                    max="24"
                    required
                    value={draft.weekEndHour}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        weekEndHour: event.target.value,
                      })
                    }
                  />
                  :00
                </span>
              </label>
              <label>
                Week view layout
                <select
                  aria-label="Week view layout"
                  value={draft.weekLayout}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      weekLayout: event.target.value as Settings["weekLayout"],
                    })
                  }
                >
                  <option value="scroll">
                    Readable hours · scroll when needed
                  </option>
                  <option value="fit">
                    Fit all hours · no vertical scroll
                  </option>
                </select>
                <small>
                  Choose whether long days scroll or shrink to fit the calendar
                  height.
                </small>
              </label>
              <label>
                Minimum hour height
                <span className="input-unit">
                  <input
                    type="number"
                    aria-label="Minimum hour height"
                    min="32"
                    max="120"
                    required
                    disabled={draft.weekLayout === "fit"}
                    value={draft.weekHourHeight}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        weekHourHeight: event.target.value,
                      })
                    }
                  />
                  px
                </span>
                <small>
                  Used in the scroll layout. Default: 48 pixels per hour.
                </small>
              </label>
            </div>
          </details>
          <label className="check-setting">
            <input
              type="checkbox"
              checked={draft.showEventBadge}
              onChange={(event) =>
                setDraft({ ...draft, showEventBadge: event.target.checked })
              }
            />
            Show next event on toolbar
          </label>
          <small>
            Shows today's next start time in 24-hour format, or +1d, +2d, and so
            on for later dates. Reconnect warnings take priority.
          </small>
          <AutoSaveStatus {...save} />
        </form>
      </section>
    </>
  );
}

export function LocalStorageSettings() {
  const counts = useLiveQuery(async () => {
    try {
      const db = getCalendarDatabase();
      return {
        google: await db.events.count(),
      };
    } catch {
      return null;
    }
  }, []);
  return (
    <section className="settings-section">
      <p className="eyebrow">ON THIS DEVICE</p>
      <h2>Local calendar storage</h2>
      <p className="muted">
        {counts === undefined
          ? "Calculating cache size…"
          : counts
            ? `${counts.google} cached Google events`
            : "Local storage is unavailable."}
      </p>
      <p className="muted">
        Google events are saved on this device for offline access. Configure the
        cache window and synchronization frequency in the sync settings.
      </p>
    </section>
  );
}
