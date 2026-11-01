import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getCalendarDatabase } from "../calendar/database";
import type { Command, Settings } from "../shared/model";

export function AppearanceSettings({
  settings,
  busy,
  run,
}: {
  settings: Settings;
  busy: boolean;
  run: (command: Command, notice?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
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
    ]),
  ];
  return (
    <>
      <section className="settings-section">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h2>Calendar appearance</h2>
          <p className="muted">
            Shared by the popup and full calendar. Changes appear when saved.
          </p>
        </div>
        <form
          className="settings-form appearance-form"
          onSubmit={(event) => {
            event.preventDefault();
            const {
              webOAuthClientId: _webClient,
              connectionCheckMinutes: _interval,
              staleAfterMinutes: _stale,
              calendarVisibility: _visibility,
              syncIntervalMinutes: _sync,
              refreshOnOpen: _refresh,
              cachePastMonths: _past,
              cacheFutureMonths: _future,
              ...appearance
            } = draft;
            void run(
              { type: "UPDATE_SETTINGS", settings: appearance },
              "Calendar preferences saved.",
            );
          }}
        >
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
                setDraft({ ...draft, weekStartsOn: Number(event.target.value) })
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
          </label>
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
                    weekStartHour: Number(event.target.value),
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
                    weekEndHour: Number(event.target.value),
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
              <option value="fit">Fit all hours · no vertical scroll</option>
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
                    weekHourHeight: Number(event.target.value),
                  })
                }
              />
              px
            </span>
            <small>
              Used in the scroll layout. Default: 48 pixels per hour.
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
          <button className="button primary" disabled={busy}>
            Save calendar preferences
          </button>
        </form>
      </section>
      <section className="settings-section">
        <p className="eyebrow">ON THIS DEVICE</p>
        <h2>Local calendar storage</h2>
        <p className="muted">
          {counts
            ? `${counts.google} cached Google events`
            : "Local storage is unavailable."}
        </p>
        <p className="muted">
          Google events are saved on this device for offline access. Configure
          the cache window and synchronization frequency in the sync settings.
        </p>
      </section>
    </>
  );
}
