import { Temporal } from "temporal-polyfill";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "./controls";

export function MiniCalendar({
  date,
  weekStartsOn,
  onSelect,
}: {
  date: string;
  weekStartsOn: number;
  onSelect: (date: string) => void;
}) {
  const selected = Temporal.PlainDate.from(date);
  const first = selected.with({ day: 1 });
  const offset = ((first.dayOfWeek % 7) - weekStartsOn + 7) % 7;
  const beginning = first.subtract({ days: offset });
  const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <section className="mini-calendar" aria-label="Date navigator">
      <div className="mini-heading">
        <strong>
          {first.toLocaleString("en", { month: "long", year: "numeric" })}
        </strong>
        <span>
          <IconButton
            label="Previous mini-calendar month"
            onClick={() => onSelect(first.subtract({ months: 1 }).toString())}
          >
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton
            label="Next mini-calendar month"
            onClick={() => onSelect(first.add({ months: 1 }).toString())}
          >
            <ChevronRight size={15} />
          </IconButton>
        </span>
      </div>
      <div className="mini-grid">
        {Array.from({ length: 7 }, (_, index) => (
          <span className="mini-weekday" key={index}>
            {weekdays[(index + weekStartsOn) % 7]}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, index) => {
          const day = beginning.add({ days: index });
          return (
            <button
              type="button"
              key={day.toString()}
              className={`${day.month !== first.month ? "other-month" : ""} ${day.equals(selected) ? "selected" : ""}`}
              aria-label={`Go to ${day.toString()}`}
              aria-pressed={day.equals(selected)}
              onClick={() => onSelect(day.toString())}
            >
              {day.day}
            </button>
          );
        })}
      </div>
    </section>
  );
}
