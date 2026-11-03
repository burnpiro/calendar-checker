import { EVENT_COLORS, eventColor } from "../../calendar/event-options";
import type { EventDraft } from "../../calendar/write-model";
import type { CalendarEvent } from "../../calendar/model";
import type { CalendarSummary } from "../../shared/model";

export function EventOptions({
  value,
  onChange,
  base,
  calendar,
}: {
  value: EventDraft;
  onChange: (value: EventDraft) => void;
  base?: CalendarEvent;
  calendar?: CalendarSummary;
}) {
  const set = (patch: Partial<EventDraft>) => onChange({ ...value, ...patch });
  const reminders = value.reminders ?? { useDefault: true };
  const guests = value.attendees ?? [];
  const guestsLocked = Boolean(
    base &&
    (base.organizerSelf === false ||
      base.attendeesOmitted ||
      !base.attendees ||
      base.attendees?.some((a) => !a.email) ||
      (base.attendees?.length ?? 0) > 200),
  );
  const meetLocked = Boolean(
    base &&
    (base.organizerSelf === false ||
      (base.conferenceType && base.conferenceType !== "hangoutsMeet")),
  );
  const meetAllowed =
    !calendar?.allowedConferenceSolutionTypes ||
    calendar.allowedConferenceSolutionTypes.includes("hangoutsMeet");
  return (
    <>
      <label>
        Event color
        <span className="editor-color-select">
          <span
            className="editor-color-swatch"
            style={{
              background: eventColor(
                value.colorId,
                calendar?.backgroundColor ?? "#7765d8",
              ),
            }}
          />
          <select
            aria-label="Event color"
            value={value.colorId ?? ""}
            onChange={(e) => set({ colorId: e.target.value })}
          >
            <option value="">Calendar default</option>
            {value.colorId &&
              !EVENT_COLORS.some(([id]) => id === value.colorId) && (
                <option value={value.colorId}>Existing color</option>
              )}
            {EVENT_COLORS.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </span>
      </label>
      <label>
        Show as
        <select
          aria-label="Show as"
          value={value.transparency ?? "opaque"}
          onChange={(e) =>
            set({ transparency: e.target.value as EventDraft["transparency"] })
          }
        >
          <option value="opaque">Busy</option>
          <option value="transparent">Free</option>
        </select>
      </label>
      <label>
        Visibility
        <select
          aria-label="Visibility"
          value={value.visibility ?? "default"}
          onChange={(e) =>
            set({ visibility: e.target.value as EventDraft["visibility"] })
          }
        >
          <option value="default">Default visibility</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
          {value.visibility === "confidential" && (
            <option value="confidential">Confidential (existing)</option>
          )}
        </select>
        <small>Calendar sharing rules still apply.</small>
        {base?.recurringEventId && (
          <small>
            Google may apply a more restrictive visibility to the entire series.
            Edit the series to make it less restrictive.
          </small>
        )}
      </label>
      <label>
        Video conferencing
        <select
          aria-label="Video conferencing"
          value={value.conference ?? "keep"}
          disabled={meetLocked}
          onChange={(e) =>
            set({ conference: e.target.value as EventDraft["conference"] })
          }
        >
          <option value="keep">
            {base?.meetingLink || base?.conferenceType
              ? "Keep existing conference"
              : "No video conference"}
          </option>
          {meetAllowed && (
            <option value="create">
              {base?.meetingLink
                ? "Replace with a new Google Meet"
                : "Add Google Meet"}
            </option>
          )}
          {(base?.meetingLink ||
            base?.conferenceType ||
            base?.conferenceStatus) && (
            <option value="remove">Remove video conference</option>
          )}
        </select>
        <small>
          {meetLocked
            ? "The organizer or conference provider manages this meeting."
            : !meetAllowed
              ? "Google Meet is unavailable for this calendar."
              : value.conference === "create"
                ? "A unique link is created after Google receives this event."
                : base?.conferenceStatus === "failure"
                  ? "Google could not create the conference. You can request a new Meet link."
                  : base?.conferenceStatus === "pending"
                    ? "Google is still creating the meeting link. Sync again shortly."
                    : "Google Meet availability depends on the selected calendar."}
        </small>
        {base?.meetingLink && value.conference === "keep" && (
          <a href={base.meetingLink} target="_blank" rel="noreferrer">
            Open existing meeting
          </a>
        )}
      </label>
      <fieldset className="editor-option-group editor-wide">
        <legend>Google Calendar notifications</legend>
        <label className="editor-check">
          <input
            type="checkbox"
            checked={reminders.useDefault}
            onChange={(e) =>
              set({
                reminders: { useDefault: e.target.checked, overrides: [] },
              })
            }
          />
          Use calendar default notifications
        </label>
        {!reminders.useDefault && (
          <>
            {(reminders.overrides ?? []).map((reminder, index) => (
              <div className="editor-reminder-row" key={index}>
                <label>
                  Notification {index + 1}
                  <select
                    aria-label={`Notification ${index + 1}`}
                    value={reminder.method}
                    onChange={(e) =>
                      set({
                        reminders: {
                          useDefault: false,
                          overrides: reminders.overrides!.map((r, i) =>
                            i === index
                              ? {
                                  ...r,
                                  method: e.target.value as "popup" | "email",
                                }
                              : r,
                          ),
                        },
                      })
                    }
                  >
                    <option value="popup">Notification</option>
                    <option value="email">Email</option>
                  </select>
                </label>
                <label>
                  Minutes before
                  <input
                    type="number"
                    min={0}
                    max={40320}
                    required
                    value={
                      Number.isNaN(reminder.minutes) ? "" : reminder.minutes
                    }
                    onChange={(e) =>
                      set({
                        reminders: {
                          useDefault: false,
                          overrides: reminders.overrides!.map((r, i) =>
                            i === index
                              ? {
                                  ...r,
                                  minutes:
                                    e.target.value === ""
                                      ? NaN
                                      : Number(e.target.value),
                                }
                              : r,
                          ),
                        },
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="write-button"
                  aria-label={`Remove notification ${index + 1}`}
                  onClick={() =>
                    set({
                      reminders: {
                        useDefault: false,
                        overrides: reminders.overrides!.filter(
                          (_, i) => i !== index,
                        ),
                      },
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="write-button"
              disabled={(reminders.overrides?.length ?? 0) >= 5}
              onClick={() =>
                set({
                  reminders: {
                    useDefault: false,
                    overrides: [
                      ...(reminders.overrides ?? []),
                      { method: "popup", minutes: 10 },
                    ],
                  },
                })
              }
            >
              Add notification
            </button>
            {!reminders.overrides?.length && (
              <p className="editor-note">
                No Google notifications for this event.
              </p>
            )}
          </>
        )}
        <p className="editor-note">
          Saved to Google for this account. Extension desktop/sound reminders
          follow your separate Settings rules.
        </p>
      </fieldset>
      <details className="editor-option-group editor-wide" id="editor-guests">
        <summary>Guests{guests.length ? ` · ${guests.length}` : ""}</summary>
        {guestsLocked ? (
          <p className="editor-note">
            The organizer manages guests, or Google has not provided the
            complete guest list. Existing guests are preserved.
          </p>
        ) : (
          <>
            {guests.map((guest, index) => (
              <div className="editor-guest-row" key={index}>
                <label>
                  Guest {index + 1} email
                  <input
                    type="email"
                    required
                    maxLength={320}
                    value={guest.email}
                    readOnly={guest.organizer || guest.self}
                    onChange={(e) =>
                      set({
                        attendees: guests.map((g, i) =>
                          i === index
                            ? { email: e.target.value, optional: g.optional }
                            : g,
                        ),
                      })
                    }
                  />
                </label>
                <label className="editor-check">
                  <input
                    type="checkbox"
                    checked={guest.optional ?? false}
                    disabled={guest.organizer || guest.self}
                    onChange={(e) =>
                      set({
                        attendees: guests.map((g, i) =>
                          i === index
                            ? { ...g, optional: e.target.checked }
                            : g,
                        ),
                      })
                    }
                  />
                  Optional
                </label>
                <button
                  type="button"
                  className="write-button"
                  disabled={guest.organizer || guest.self}
                  aria-label={`Remove guest ${index + 1}`}
                  onClick={() =>
                    set({ attendees: guests.filter((_, i) => i !== index) })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="write-button"
              disabled={guests.length >= 200}
              onClick={() => set({ attendees: [...guests, { email: "" }] })}
            >
              Add guest
            </button>
            <div className="editor-guest-permissions">
              <label className="editor-check">
                <input
                  type="checkbox"
                  checked={value.guestsCanModify ?? false}
                  onChange={(e) => set({ guestsCanModify: e.target.checked })}
                />
                Guests can modify event
              </label>
              <label className="editor-check">
                <input
                  type="checkbox"
                  checked={value.guestsCanInviteOthers ?? true}
                  onChange={(e) =>
                    set({ guestsCanInviteOthers: e.target.checked })
                  }
                />
                Guests can invite others
              </label>
              <label className="editor-check">
                <input
                  type="checkbox"
                  checked={value.guestsCanSeeOtherGuests ?? true}
                  onChange={(e) =>
                    set({ guestsCanSeeOtherGuests: e.target.checked })
                  }
                />
                Guests can see guest list
              </label>
            </div>
          </>
        )}
      </details>
    </>
  );
}
