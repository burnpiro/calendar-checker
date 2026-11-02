import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

const searchable = (value: string) => value.replaceAll("_", " ").toLowerCase();

export function TimeZonePicker({
  value,
  defaultZone,
  onChange,
}: {
  value: string;
  defaultZone: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const zones = useMemo(
    () =>
      [
        ...new Set([
          "UTC",
          defaultZone,
          value,
          ...Intl.supportedValuesOf("timeZone"),
        ]),
      ].sort(),
    [defaultZone, value],
  );
  const matches = zones.filter((zone) =>
    searchable(zone).includes(searchable(query.trim())),
  );
  useEffect(() => {
    if (open) {
      search.current?.focus({ preventScroll: true });
      panel.current?.scrollIntoView({ block: "nearest" });
    }
  }, [open]);
  useEffect(() => {
    if (active >= 0)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (zone: string) => {
    if (zone !== value) onChange(zone);
    close();
  };
  return (
    <div
      className="editor-wide zone-picker"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <span id={`${id}-label`} className="time-field-label">
        Event time zone
      </span>
      <button
        type="button"
        ref={trigger}
        className="zone-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setActive(-1);
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>
          {value.replaceAll("_", " ")}
          {value === defaultZone ? " · default" : ""}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="zone-options" ref={panel}>
          <input
            ref={search}
            type="search"
            role="combobox"
            aria-label="Search time zones"
            placeholder="Search time zones…"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={
              active >= 0 && active < matches.length
                ? `${id}-option-${active}`
                : undefined
            }
            value={query}
            onChange={(e) => {
              e.stopPropagation();
              setQuery(e.target.value);
              setActive(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (
                ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
              ) {
                e.preventDefault();
                setActive((previous) =>
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? matches.length - 1
                      : Math.max(
                          0,
                          Math.min(
                            matches.length - 1,
                            previous + (e.key === "ArrowDown" ? 1 : -1),
                          ),
                        ),
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                const zone =
                  matches[active] ??
                  (matches.length === 1 ? matches[0] : undefined);
                if (zone) choose(zone);
              }
            }}
          />
          <ul
            id={`${id}-list`}
            ref={list}
            role="listbox"
            aria-label="Time zones"
          >
            {matches.map((zone, index) => (
              <li
                key={zone}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={zone === value}
                className={index === active ? "zone-active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(zone)}
              >
                <span>
                  {zone.replaceAll("_", " ")}
                  {zone === defaultZone ? " · default" : ""}
                </span>
                {zone === value && <Check size={14} />}
              </li>
            ))}
          </ul>
          {!matches.length && (
            <p className="editor-note">No matching time zones.</p>
          )}
          <small>{matches.length} time zones · type a region or city</small>
        </div>
      )}
    </div>
  );
}
