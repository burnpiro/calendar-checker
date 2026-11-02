import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { TimePicker } from "./TimePicker";
import { TimeZonePicker } from "./TimeZonePicker";
import { initialEventRange, movedEventEnd } from "./editor-time";
import { Temporal } from "temporal-polyfill";
import type { CalendarEvent } from "../../calendar/model";
import {
  draftSchema,
  writableCalendar,
  type EditScope,
} from "../../calendar/write-model";
import type { Account, Settings } from "../../shared/model";
import { calendarKey, displayTimeZone } from "../../shared/preferences";
import { sendCommand } from "../client";
import "../event-writing.css";

export function EventEditor({
  base,
  scope,
  accounts,
  settings,
  seed,
  onClose,
}: {
  base?: CalendarEvent;
  scope: EditScope;
  accounts: Account[];
  settings: Settings;
  seed?: { start: string };
  onClose: () => void;
}) {
  const id = useRef(crypto.randomUUID());
  const choices = accounts
    .filter((a) => a.enabled)
    .flatMap((a) =>
      a.calendars
        .filter((c) => writableCalendar(c.accessRole))
        .map((c) => ({
          account: a,
          calendar: c,
          key: calendarKey(a.id, c.id),
        })),
    );
  const [target, setTarget] = useState(
    base
      ? calendarKey(base.accountId, base.calendarId)
      : (choices.find((c) => c.key === settings.defaultWriteCalendar)?.key ??
          choices.find((c) => c.calendar.primary)?.key ??
          choices[0]?.key ??
          ""),
  );
  const [zone, setZone] = useState(
    base?.timeZone ?? displayTimeZone(settings.primaryTimeZone),
  );
  const [initial] = useState(() => initialEventRange(base, seed, zone));
  const [allDay, setAllDay] = useState(initial.allDay);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const toLocal = (instant: string) =>
    Temporal.Instant.from(instant)
      .toZonedDateTimeISO(zone)
      .toPlainDateTime()
      .toString();
  const [title, setTitle] = useState(base?.title ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [location, setLocation] = useState(base?.location ?? "");
  const [repeat, setRepeat] = useState(
    base?.recurrence?.length ? "keep" : "none",
  );
  const [count, setCount] = useState(10);
  const [sendUpdates, setSendUpdates] = useState<"all" | "none">("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirmDelete) {
      confirmation.current?.scrollIntoView({ block: "nearest" });
      confirmation.current
        ?.querySelector("button")
        ?.focus({ preventScroll: true });
    }
  }, [confirmDelete]);
  const markDirty = () => {
    setDirty(true);
    setConfirmDelete(false);
  };
  const moveStart = (value: string) => {
    setEnd(movedEventEnd(start, end, value, allDay));
    setStart(value);
    markDirty();
  };

  const close = () => {
    if (!busy && (!dirty || window.confirm("Discard changes in this form?")))
      onClose();
  };
  const chosen = choices.find((c) => c.key === target);
  const convert = (value: string, point: "start" | "end") => {
    if (allDay)
      return point === "end"
        ? Temporal.PlainDate.from(value).add({ days: 1 }).toString()
        : value;
    // Keep the exact instant (including a DST overlap's offset) for unchanged inputs.
    if (
      base &&
      !base.allDay &&
      base.timeZone === zone &&
      value === toLocal(base[point])
    )
      return base[point];
    return Temporal.PlainDateTime.from(value)
      .toZonedDateTime(zone, { disambiguation: "reject" })
      .toInstant()
      .toString();
  };
  const save = async (deleting = false) => {
    setError("");
    if (!chosen) {
      setError("Connect an enabled account with a writable calendar first.");
      return;
    }
    setBusy(true);
    try {
      if (deleting && base) {
        await sendCommand({
          type: "DELETE_EVENT",
          id: id.current,
          base,
          scope,
          sendUpdates,
        });
      } else {
        let draft;
        try {
          draft = draftSchema.parse({
            title,
            description,
            location,
            allDay,
            timeZone: zone,
            start: convert(start, "start"),
            end: convert(end, "end"),
            recurrence:
              repeat === "keep"
                ? (base?.recurrence ?? [])
                : repeat === "none"
                  ? []
                  : [`RRULE:FREQ=${repeat};COUNT=${count}`],
          });
        } catch {
          throw new Error(
            "Check the title, time zone and dates. The end must follow the start. Times skipped or repeated by daylight saving need an unambiguous time or zone.",
          );
        }
        await sendCommand({
          type: "SAVE_EVENT",
          id: id.current,
          accountId: chosen.account.id,
          calendarId: chosen.calendar.id,
          scope,
          base,
          draft,
          sendUpdates,
        });
      }
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the event. Your form is still available.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="write-overlay" />
        <Dialog.Content
          className="write-dialog"
          aria-describedby="editor-description"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <header className="write-header">
            <div>
              <Dialog.Title>
                {base
                  ? scope === "series"
                    ? "Edit recurring series"
                    : "Edit event"
                  : "New event"}
              </Dialog.Title>
              <Dialog.Description id="editor-description">
                Saved on this device first, then sent directly to Google.
              </Dialog.Description>
            </div>
            <button
              className="icon-button"
              aria-label="Close event editor"
              disabled={busy}
              onClick={close}
            >
              <X size={18} />
            </button>
          </header>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            onChange={() => {
              setDirty(true);
              setConfirmDelete(false);
            }}
          >
            <div className="editor-scroll">
              <fieldset className="editor-fields" disabled={busy}>
                <div className="editor-field-grid">
                  <label className="editor-wide">
                    Title
                    <input
                      autoFocus
                      required
                      maxLength={1024}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <label className="editor-wide">
                    Account and calendar
                    <select
                      value={target}
                      disabled={Boolean(base)}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      {choices.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.account.email} · {c.calendar.summary}
                        </option>
                      ))}
                    </select>
                    <small>
                      {base
                        ? "Edits stay in the event's original calendar."
                        : "Only writable calendars from enabled accounts are listed."}
                    </small>
                  </label>
                  <label className="editor-check editor-wide">
                    <input
                      type="checkbox"
                      checked={allDay}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setAllDay(next);
                        setStart(
                          next
                            ? start.slice(0, 10)
                            : `${start.slice(0, 10)}T09:00`,
                        );
                        setEnd(
                          next ? end.slice(0, 10) : `${end.slice(0, 10)}T10:00`,
                        );
                      }}
                    />
                    All day
                  </label>
                  <div className="editor-date-time">
                    <label>
                      Starts
                      <input
                        type="date"
                        required
                        value={start.slice(0, 10)}
                        onChange={(e) =>
                          moveStart(
                            e.target.value
                              ? e.target.value + (allDay ? "" : start.slice(10))
                              : "",
                          )
                        }
                      />
                    </label>
                    {!allDay && (
                      <TimePicker
                        label="Start time"
                        value={start.slice(11, 16)}
                        onChange={(time) =>
                          moveStart(`${start.slice(0, 10)}T${time}`)
                        }
                      />
                    )}
                  </div>
                  <div className="editor-date-time">
                    <label>
                      {allDay ? "Last day (inclusive)" : "Ends"}
                      <input
                        type="date"
                        required
                        value={end.slice(0, 10)}
                        onChange={(e) =>
                          setEnd(
                            e.target.value
                              ? e.target.value + (allDay ? "" : end.slice(10))
                              : "",
                          )
                        }
                      />
                    </label>
                    {!allDay && (
                      <TimePicker
                        label="End time"
                        value={end.slice(11, 16)}
                        onChange={(time) => {
                          setEnd(`${end.slice(0, 10)}T${time}`);
                          markDirty();
                        }}
                      />
                    )}
                  </div>
                  <TimeZonePicker
                    value={zone}
                    defaultZone={displayTimeZone(settings.primaryTimeZone)}
                    onChange={(value) => {
                      setZone(value);
                      markDirty();
                    }}
                  />
                  {!base?.recurringEventId && (
                    <>
                      <label>
                        Repeats
                        <select
                          value={repeat}
                          onChange={(e) => setRepeat(e.target.value)}
                        >
                          {base?.recurrence?.length ? (
                            <option value="keep">Keep existing rule</option>
                          ) : null}
                          <option value="none">Does not repeat</option>
                          <option value="DAILY">Daily</option>
                          <option value="WEEKLY">Weekly</option>
                          <option value="MONTHLY">Monthly</option>
                          <option value="YEARLY">Yearly</option>
                        </select>
                      </label>
                      {!["none", "keep"].includes(repeat) && (
                        <label>
                          Number of occurrences
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            required
                            value={count}
                            onChange={(e) => setCount(Number(e.target.value))}
                          />
                        </label>
                      )}
                    </>
                  )}
                  {scope === "series" && (
                    <p className="editor-note editor-wide">
                      Changes apply to the whole series, starting at its
                      original first occurrence. Existing exceptions remain
                      managed by Google. “This and following” splits are not
                      available.
                    </p>
                  )}
                  {base?.recurringEventId && (
                    <p className="editor-note editor-wide">
                      Only this occurrence changes. The repeating series is
                      preserved.
                    </p>
                  )}
                  <label className="editor-wide">
                    Location
                    <input
                      maxLength={2048}
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </label>
                  <label className="editor-wide">
                    Description
                    <textarea
                      rows={3}
                      maxLength={20000}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                  {base && (
                    <label className="editor-wide">
                      Guest updates
                      <select
                        value={sendUpdates}
                        onChange={(e) =>
                          setSendUpdates(e.target.value as "all" | "none")
                        }
                      >
                        <option value="all">Notify existing guests</option>
                        <option value="none">
                          Do not request guest updates
                        </option>
                      </select>
                      <small>
                        Existing guests and meeting links are preserved. Google
                        may still send some service emails.
                      </small>
                    </label>
                  )}
                  {chosen && !chosen.account.eventsWriteGranted && (
                    <p className="editor-note editor-wide">
                      This account may need Reconnect in Settings to approve
                      event editing. Offline changes will stay queued until
                      access is available.
                    </p>
                  )}
                  {error && (
                    <p className="write-error editor-wide" role="alert">
                      {error}
                    </p>
                  )}
                  {confirmDelete && (
                    <div
                      ref={confirmation}
                      className="editor-wide delete-confirm"
                      role="alert"
                    >
                      <p>
                        Delete{" "}
                        {scope === "series"
                          ? "the entire recurring series"
                          : base?.recurringEventId
                            ? "this occurrence"
                            : "this event"}{" "}
                        from Google? This will be queued when offline.
                      </p>
                      <button
                        type="button"
                        className="write-button danger"
                        onClick={() => void save(true)}
                      >
                        Confirm delete
                      </button>
                    </div>
                  )}
                </div>
              </fieldset>
            </div>
            <footer className="write-actions">
              {base && (
                <button
                  type="button"
                  className="write-button danger"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete{scope === "series" ? " series" : ""}
                </button>
              )}
              <button
                type="button"
                className="write-button"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="write-button primary"
                disabled={busy || !chosen}
              >
                {busy ? "Saving…" : "Save event"}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
