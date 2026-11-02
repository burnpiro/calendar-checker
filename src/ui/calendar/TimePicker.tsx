import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Clock3, X } from "lucide-react";

const two = (value: number) => String(value).padStart(2, "0");

/** A bounded clock face with exact numeric entry; no native minute scroller. */
export function TimePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const dial = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const hourValue = Number(hour) || 0;
  const minuteValue = Number(minute) || 0;
  const angle =
    (mode === "hour" ? (hourValue % 12) / 12 : minuteValue / 60) * Math.PI * 2;
  const radius =
    mode === "hour" && (hourValue === 0 || hourValue > 12) ? 65 : 98;
  const valid =
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59;
  const pickAt = (clientX: number, clientY: number) => {
    const rect = dial.current!.getBoundingClientRect();
    const x = ((clientX - rect.left) * 240) / rect.width - 120;
    const y = ((clientY - rect.top) * 240) / rect.height - 120;
    const turn = (Math.atan2(x, -y) / (Math.PI * 2) + 1) % 1;
    if (mode === "minute") setMinute(Math.round(turn * 60) % 60);
    else {
      const position = Math.round(turn * 12) % 12;
      setHour(
        Math.hypot(x, y) < 81
          ? position === 0
            ? 0
            : position + 12
          : position === 0
            ? 12
            : position,
      );
    }
  };
  return (
    <div className="time-picker">
      <span className="time-field-label">{label}</span>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <button
          type="button"
          ref={trigger}
          className="time-trigger"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setHour(Number(value.slice(0, 2)) || 0);
            setMinute(Number(value.slice(3, 5)) || 0);
            setMode("hour");
            setOpen(true);
          }}
        >
          <span>{value || "Choose time"}</span>
          <Clock3 size={16} />
        </button>
        <Dialog.Portal>
          <Dialog.Overlay className="write-overlay time-overlay" />
          <Dialog.Content
            className="write-dialog time-dialog"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              trigger.current?.focus();
            }}
            aria-describedby="clock-instructions"
            onEscapeKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => e.stopPropagation()}
          >
            <header className="write-header">
              <div>
                <Dialog.Title>{label}</Dialog.Title>
                <Dialog.Description id="clock-instructions">
                  Choose an hour, then minutes. You can also type an exact time.
                </Dialog.Description>
              </div>
              <Dialog.Close
                type="button"
                className="icon-button"
                aria-label="Close time picker"
              >
                <X size={18} />
              </Dialog.Close>
            </header>
            <div className="clock-content">
              <div className="clock-inputs">
                <label>
                  Hour
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={23}
                    value={Number.isNaN(hour) ? "" : hour}
                    onFocus={() => setMode("hour")}
                    onChange={(e) =>
                      setHour(
                        e.target.value === "" ? NaN : Number(e.target.value),
                      )
                    }
                  />
                </label>
                <span>:</span>
                <label>
                  Minute
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    value={Number.isNaN(minute) ? "" : minute}
                    onFocus={() => setMode("minute")}
                    onChange={(e) =>
                      setMinute(
                        e.target.value === "" ? NaN : Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <div className="clock-mode" aria-label="Clock selection">
                <button
                  type="button"
                  aria-pressed={mode === "hour"}
                  onClick={() => setMode("hour")}
                >
                  Hours · 24h
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "minute"}
                  onClick={() => setMode("minute")}
                >
                  Minutes
                </button>
              </div>
              <div
                className="clock-face"
                ref={dial}
                role="group"
                aria-label={mode === "hour" ? "Choose hour" : "Choose minute"}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  e.preventDefault();
                  dragging.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  pickAt(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (dragging.current) pickAt(e.clientX, e.clientY);
                }}
                onPointerUp={() => {
                  if (dragging.current) {
                    dragging.current = false;
                    if (mode === "hour") setMode("minute");
                  }
                }}
                onPointerCancel={() => {
                  dragging.current = false;
                }}
              >
                <svg viewBox="0 0 240 240" aria-hidden="true">
                  <line
                    x1="120"
                    y1="120"
                    x2={120 + Math.sin(angle) * radius}
                    y2={120 - Math.cos(angle) * radius}
                  />
                  <circle cx="120" cy="120" r="4" />
                </svg>
                {(mode === "hour"
                  ? Array.from({ length: 24 }, (_, i) => i)
                  : Array.from({ length: 12 }, (_, i) => i * 5)
                ).map((number) => {
                  const inner =
                    mode === "hour" && (number === 0 || number > 12);
                  const r = inner ? 65 : 98;
                  const radians =
                    (mode === "hour" ? (number % 12) / 12 : number / 60) *
                    Math.PI *
                    2;
                  const selected =
                    number === (mode === "hour" ? hourValue : minuteValue);
                  return (
                    <button
                      type="button"
                      key={`${mode}-${number}`}
                      className={`clock-number${inner ? " clock-inner" : ""}`}
                      aria-label={`${two(number)} ${mode === "hour" ? "hours" : "minutes"}`}
                      aria-pressed={selected}
                      style={{
                        left: 120 + Math.sin(radians) * r,
                        top: 120 - Math.cos(radians) * r,
                      }}
                      onClick={() => {
                        if (mode === "hour") {
                          setHour(number);
                          setMode("minute");
                        } else setMinute(number);
                      }}
                    >
                      {two(number)}
                    </button>
                  );
                })}
              </div>
              <p className="editor-note">
                {two(hourValue)}:{two(minuteValue)} · 24-hour time
              </p>
            </div>
            <footer className="write-actions">
              <Dialog.Close type="button" className="write-button">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                className="write-button primary"
                disabled={!valid}
                onClick={() => {
                  const next = `${two(hour)}:${two(minute)}`;
                  if (next !== value) onChange(next);
                  setOpen(false);
                }}
              >
                Set time
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
