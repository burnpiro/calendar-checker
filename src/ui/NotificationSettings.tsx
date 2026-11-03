import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Account, Command, Settings } from "../shared/model";
import { getCalendarDatabase } from "../calendar/database";
import { sendCommand } from "./client";
import { dndActive } from "../reminders/planning";
import { useConnectionClock } from "./use-sync-metadata";
import { TimePicker } from "./calendar/TimePicker";
import { settingsSchema } from "../shared/preferences";
import { ReminderInbox } from "./ReminderInbox";
import "./reminders.css";
import { revealInvalidSetting } from "./settings-validation";
const list = (value: string) => {
  const parts = value.split(",").map((v) => v.trim());
  if (parts.some((v) => !/^\d+$/.test(v))) throw new Error();
  return parts.map(Number);
};
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function NotificationSettings({
  settings,
  accounts,
  busy,
  run,
}: {
  settings: Settings;
  accounts: Account[];
  busy: boolean;
  run: (command: Command, notice?: string) => Promise<void>;
}) {
  const [reminders, setReminders] = useState(settings.reminders);
  const [dnd, setDnd] = useState(settings.dnd);
  const [offsets, setOffsets] = useState(reminders.offsets.join(", "));
  const [snoozes, setSnoozes] = useState(reminders.snoozePresets.join(", "));
  const [overrides, setOverrides] = useState(settings.notificationCalendars);
  const [calendarOffsets, setCalendarOffsets] = useState(
    Object.fromEntries(
      Object.entries(settings.notificationCalendars).map(([id, rule]) => [
        id,
        rule.offsets?.join(", ") ?? "",
      ]),
    ),
  );
  const sounds = useLiveQuery(async () => {
    try {
      return (await getCalendarDatabase().sounds.toArray())
        .filter((s) => s.duration > 0)
        .map(({ id, name, bytes, duration }) => ({
          id,
          name,
          bytes,
          duration,
        }));
    } catch {
      return undefined;
    }
  }, []);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const clock = useConnectionClock();
  const [until, setUntil] = useState(
    dnd.until
      ? new Date(
          Date.parse(dnd.until) -
            new Date(dnd.until).getTimezoneOffset() * 60_000,
        )
          .toISOString()
          .slice(0, 16)
      : "",
  );
  const calendars = [
    ...new Map(
      accounts.flatMap((a) =>
        a.calendars.map(
          (c) =>
            [c.id, { id: c.id, name: c.summary, account: a.email }] as const,
        ),
      ),
    ).values(),
  ];
  const soundOptions = (
    <>
      <option value="builtin">Built-in chime</option>
      {sounds?.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </>
  );
  const upload = async () => {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const mime = (
        {
          mp3: "audio/mpeg",
          wav: "audio/wav",
          ogg: "audio/ogg",
          m4a: "audio/mp4",
          webm: "audio/webm",
        } as Record<string, string>
      )[ext ?? ""];
      if (!mime || file.size > 5 * 1024 * 1024)
        throw new Error("Choose MP3, WAV, Ogg, M4A or WebM audio up to 5 MB.");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await sendCommand({
        type: "IMPORT_SOUND",
        name: name.trim() || file.name.slice(0, 100),
        mime: mime as "audio/wav",
        data,
      });
      if (fileInput.current) fileInput.current.value = "";
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sound import failed.");
    } finally {
      setUploading(false);
    }
  };
  return (
    <section className="settings-section notification-settings">
      <p className="eyebrow">REMINDERS</p>
      <h2>Notifications, sounds and Do not disturb</h2>
      <p className="muted">
        Choose how and when you are reminded. Local reminders work from saved
        events; Chrome must be running. Display filters do not silence alerts.
      </p>
      <form
        className="settings-form appearance-form"
        onInvalidCapture={revealInvalidSetting}
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          try {
            const parsedUntil = until ? new Date(until).toISOString() : null;
            const notificationCalendars = Object.fromEntries(
              Object.entries(overrides).map(([id, rule]) => [
                id,
                {
                  ...rule,
                  offsets: calendarOffsets[id]?.trim()
                    ? list(calendarOffsets[id]!)
                    : undefined,
                },
              ]),
            );
            const update = {
              reminders: {
                ...reminders,
                offsets: list(offsets),
                snoozePresets: list(snoozes),
              },
              dnd: { ...dnd, until: parsedUntil },
              notificationCalendars,
            };
            settingsSchema.parse({ ...settings, ...update });
            void run(
              { type: "UPDATE_SETTINGS", settings: update },
              "Reminder preferences saved.",
            );
          } catch {
            setError(
              "Check the comma-separated reminder/snooze minutes, selected schedule days and DND end time.",
            );
          }
        }}
      >
        <fieldset className="settings-field-group">
          <legend>Delivery & timing</legend>
          <label className="check-setting">
            <input
              type="checkbox"
              checked={reminders.desktop}
              onChange={(e) =>
                setReminders({ ...reminders, desktop: e.target.checked })
              }
            />
            Desktop notifications
          </label>
          <label className="check-setting">
            <input
              type="checkbox"
              checked={reminders.sound}
              onChange={(e) =>
                setReminders({ ...reminders, sound: e.target.checked })
              }
            />
            Sound notifications
          </label>
          <label>
            Reminder minutes before event
            <input
              required
              value={offsets}
              onChange={(e) => setOffsets(e.target.value)}
            />
            <small>
              Up to five distinct values, 0–40320. Comma-separated; 0 is at
              start.
            </small>
          </label>
          <label>
            Snooze presets in minutes
            <input
              required
              value={snoozes}
              onChange={(e) => setSnoozes(e.target.value)}
            />
            <small>
              Up to five values, 1–1440. The first is the desktop notification's
              snooze button.
            </small>
          </label>
          <label>
            Notification privacy
            <select
              value={reminders.privacy}
              onChange={(e) =>
                setReminders({
                  ...reminders,
                  privacy: e.target.value as typeof reminders.privacy,
                })
              }
            >
              <option value="details">
                Title, time, calendar and location
              </option>
              <option value="title">Title and time</option>
              <option value="private">Hide event details</option>
            </select>
          </label>
        </fieldset>
        <fieldset className="settings-field-group">
          <legend>Sound</legend>
          <label>
            Default sound
            <select
              aria-label="Default sound"
              value={reminders.soundId}
              onChange={(e) =>
                setReminders({ ...reminders, soundId: e.target.value })
              }
            >
              {soundOptions}
            </select>
          </label>
          <label>
            Sound volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={reminders.volume}
              onChange={(e) =>
                setReminders({ ...reminders, volume: Number(e.target.value) })
              }
            />
            <small>{Math.round(reminders.volume * 100)}%</small>
          </label>
        </fieldset>
        <fieldset className="settings-field-group">
          <legend>Do not disturb</legend>
          <div className="reminder-form-wide">
            <p>
              Currently{" "}
              {dndActive(settings.dnd, new Date(clock.now))
                ? "active"
                : "inactive"}{" "}
              · applied to both desktop and sound reminders.
            </p>
          </div>
          <label className="check-setting">
            <input
              type="checkbox"
              checked={dnd.manual}
              onChange={(e) => setDnd({ ...dnd, manual: e.target.checked })}
            />
            Manual Do not disturb
          </label>
          <label>
            Manual DND until
            <input
              type="datetime-local"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <small>Device local time. Leave empty for indefinite DND.</small>
          </label>
        </fieldset>
        <details className="settings-disclosure reminder-form-wide">
          <summary>
            <span>Recovery & all-day reminders</span>
            <small>Advanced · late alerts and all-day timing</small>
          </summary>
          <div className="settings-fields-grid">
            <label>
              Missed reminders
              <select
                value={reminders.missed}
                onChange={(e) =>
                  setReminders({
                    ...reminders,
                    missed: e.target.value as "skip" | "deliver",
                  })
                }
              >
                <option value="deliver">Deliver within recovery window</option>
                <option value="skip">
                  Skip reminders delayed over one minute
                </option>
              </select>
            </label>
            <label>
              Recovery window in minutes
              <input
                type="number"
                min={1}
                max={1440}
                required
                value={reminders.graceMinutes}
                onChange={(e) =>
                  setReminders({
                    ...reminders,
                    graceMinutes: Number(e.target.value),
                  })
                }
              />
              <small>
                Reminders after the event ends are always skipped. Multiple
                missed offsets combine into one alert.
              </small>
            </label>
            <label className="check-setting">
              <input
                type="checkbox"
                checked={reminders.includeAllDay}
                onChange={(e) =>
                  setReminders({
                    ...reminders,
                    includeAllDay: e.target.checked,
                  })
                }
              />
              Remind for all-day events
            </label>
            <label>
              All-day reminder base hour
              <input
                type="number"
                min={0}
                max={23}
                required
                value={reminders.allDayHour}
                onChange={(e) =>
                  setReminders({
                    ...reminders,
                    allDayHour: Number(e.target.value),
                  })
                }
              />
              <small>
                In the primary display zone on the first event day. Reminder
                offsets apply before this hour.
              </small>
            </label>
          </div>
        </details>
        <details className="settings-disclosure reminder-form-wide">
          <summary>
            <span>Do not disturb schedule</span>
            <small>Advanced · weekly schedules and quiet-hour behavior</small>
          </summary>
          <div className="settings-fields-grid">
            <label className="check-setting">
              <input
                type="checkbox"
                checked={dnd.scheduleEnabled}
                onChange={(e) =>
                  setDnd({ ...dnd, scheduleEnabled: e.target.checked })
                }
              />
              Scheduled Do not disturb
            </label>
            <label>
              DND schedule time zone
              <input
                list="dnd-zones"
                required
                value={dnd.timeZone}
                onChange={(e) => setDnd({ ...dnd, timeZone: e.target.value })}
              />
              <datalist id="dnd-zones">
                <option value="device" />
                <option value="UTC" />
                {Intl.supportedValuesOf("timeZone").map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </label>
            <label>
              During Do not disturb
              <select
                value={dnd.policy}
                onChange={(e) =>
                  setDnd({ ...dnd, policy: e.target.value as "skip" | "defer" })
                }
              >
                <option value="skip">Skip due reminders</option>
                <option value="defer">Defer within recovery window</option>
              </select>
            </label>
            <div className="reminder-form-wide">
              {dnd.rules.map((rule, index) => (
                <fieldset key={index} className="dnd-rule">
                  <legend>Schedule {index + 1}</legend>
                  <div className="dnd-days">
                    {days.map((day, i) => (
                      <label key={day}>
                        <input
                          type="checkbox"
                          checked={rule.days.includes(i + 1)}
                          onChange={(e) =>
                            setDnd({
                              ...dnd,
                              rules: dnd.rules.map((r, j) =>
                                j === index
                                  ? {
                                      ...r,
                                      days: e.target.checked
                                        ? [...r.days, i + 1]
                                        : r.days.filter((n) => n !== i + 1),
                                    }
                                  : r,
                              ),
                            })
                          }
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                  <div className="dnd-times">
                    <TimePicker
                      label={`Schedule ${index + 1} starts`}
                      value={rule.start}
                      onChange={(value) =>
                        setDnd({
                          ...dnd,
                          rules: dnd.rules.map((r, j) =>
                            j === index ? { ...r, start: value } : r,
                          ),
                        })
                      }
                    />
                    <TimePicker
                      label={`Schedule ${index + 1} ends`}
                      value={rule.end}
                      onChange={(value) =>
                        setDnd({
                          ...dnd,
                          rules: dnd.rules.map((r, j) =>
                            j === index ? { ...r, end: value } : r,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() =>
                        setDnd({
                          ...dnd,
                          rules: dnd.rules.filter((_, j) => j !== index),
                        })
                      }
                    >
                      Remove schedule {index + 1}
                    </button>
                  </div>
                  <small>
                    Days select when an overnight schedule starts; equal times
                    cover the full selected day.
                  </small>
                </fieldset>
              ))}
              <button
                type="button"
                className="button subtle"
                disabled={dnd.rules.length >= 7}
                onClick={() =>
                  setDnd({
                    ...dnd,
                    rules: [
                      ...dnd.rules,
                      { days: [1, 2, 3, 4, 5], start: "22:00", end: "08:00" },
                    ],
                  })
                }
              >
                Add DND schedule
              </button>
            </div>
          </div>
        </details>
        <details className="settings-disclosure reminder-form-wide">
          <summary>
            <span>Calendar reminder overrides</span>
            <small>Advanced · customize individual calendars</small>
          </summary>
          <div className="settings-fields-grid">
            <div className="reminder-form-wide">
              <p>
                Shared calendar copies use one policy and one reminder. Display
                visibility does not disable reminders.
              </p>
              {calendars.map((c) => {
                const rule = overrides[c.id] ?? { enabled: true };
                return (
                  <details className="calendar-reminder-rule" key={c.id}>
                    <summary>
                      {c.name} · {c.account}
                    </summary>
                    <label className="check-setting">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [c.id]: { ...rule, enabled: e.target.checked },
                          })
                        }
                      />
                      Enable reminders for this calendar
                    </label>
                    <label>
                      Calendar reminder minutes
                      <input
                        value={calendarOffsets[c.id] ?? ""}
                        placeholder="Use default"
                        onChange={(e) => {
                          setCalendarOffsets({
                            ...calendarOffsets,
                            [c.id]: e.target.value,
                          });
                          setOverrides({ ...overrides, [c.id]: { ...rule } });
                        }}
                      />
                    </label>
                    <label>
                      Calendar sound
                      <select
                        value={rule.soundId ?? ""}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [c.id]: {
                              ...rule,
                              soundId: e.target.value || undefined,
                            },
                          })
                        }
                      >
                        <option value="">Use default sound</option>
                        {soundOptions}
                      </select>
                    </label>
                    <label className="check-setting">
                      <input
                        type="checkbox"
                        checked={rule.desktop !== false}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [c.id]: { ...rule, desktop: e.target.checked },
                          })
                        }
                      />
                      Allow desktop alerts when globally enabled
                    </label>
                    <label className="check-setting">
                      <input
                        type="checkbox"
                        checked={rule.sound !== false}
                        onChange={(e) =>
                          setOverrides({
                            ...overrides,
                            [c.id]: { ...rule, sound: e.target.checked },
                          })
                        }
                      />
                      Allow sound when globally enabled
                    </label>
                  </details>
                );
              })}
            </div>
          </div>
        </details>
        {error && (
          <p role="alert" className="write-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || uploading}>
          Save reminder preferences
        </button>
      </form>
      <div className="reminder-actions">
        <button
          type="button"
          className="button subtle"
          disabled={busy}
          onClick={() =>
            void run(
              { type: "TEST_NOTIFICATION" },
              "Test notification requested. Check your desktop notification settings if it is not visible.",
            )
          }
        >
          Test desktop notification
        </button>
        <button
          type="button"
          className="button subtle"
          disabled={busy}
          onClick={() =>
            void run(
              {
                type: "PREVIEW_SOUND",
                id: reminders.soundId,
                volume: reminders.volume,
              },
              "Sound preview started.",
            )
          }
        >
          Preview selected sound
        </button>
      </div>
      <small>
        Explicit tests/previews run even when automatic reminders or DND are
        enabled/disabled.
      </small>
      <h3>Custom notification sounds</h3>
      <p>
        Audio stays on this device. Up to 10 sounds, 5 MB each, 60 seconds
        maximum. Browser-supported MP3/WAV/Ogg/M4A/WebM audio only.
      </p>
      <div className="sound-import">
        <label>
          Sound name
          <input
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Audio file
          <input
            ref={fileInput}
            type="file"
            accept=".mp3,.wav,.ogg,.m4a,.webm"
          />
        </label>
        <button
          type="button"
          className="button subtle"
          disabled={busy || uploading}
          onClick={() => void upload()}
        >
          {uploading ? "Checking audio…" : "Import sound"}
        </button>
      </div>
      <ul className="sound-list">
        {sounds?.map((s) => (
          <li key={s.id}>
            <span>
              {s.name} · {s.duration.toFixed(1)}s · {Math.round(s.bytes / 1024)}{" "}
              KB
            </span>
            <button
              className="button subtle"
              onClick={() =>
                void run({
                  type: "PREVIEW_SOUND",
                  id: s.id,
                  volume: reminders.volume,
                })
              }
            >
              Preview {s.name}
            </button>
            <button
              className="button subtle"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete local sound “${s.name}”? Assigned sounds must be unassigned first.`,
                  )
                )
                  void run({ type: "REMOVE_SOUND", id: s.id });
              }}
            >
              Delete {s.name}
            </button>
          </li>
        ))}
      </ul>
      <h3>Recent reminders</h3>
      <ReminderInbox settings={settings} />
    </section>
  );
}
