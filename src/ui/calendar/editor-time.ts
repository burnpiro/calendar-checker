import { Temporal } from "temporal-polyfill";
import type { CalendarEvent } from "../../calendar/model";

export function initialEventRange(
  base: CalendarEvent | undefined,
  seed: { start: string } | undefined,
  zone: string,
  now = Temporal.Now.instant(),
) {
  if (base?.allDay)
    return {
      allDay: true,
      start: base.start,
      end: Temporal.PlainDate.from(base.end).subtract({ days: 1 }).toString(),
    };
  const local = (instant: string) =>
    Temporal.Instant.from(instant)
      .toZonedDateTimeISO(zone)
      .toPlainDateTime()
      .toString();
  const start = base
    ? local(base.start)
    : seed
      ? /^\d{4}-\d{2}-\d{2}$/.test(seed.start)
        ? `${seed.start}T09:00`
        : local(seed.start)
      : now
          .toZonedDateTimeISO(zone)
          .round({ smallestUnit: "hour", roundingMode: "ceil" })
          .toPlainDateTime()
          .toString();
  return {
    allDay: false,
    start,
    end: base
      ? local(base.end)
      : Temporal.PlainDateTime.from(start).add({ hours: 1 }).toString(),
  };
}

/** Preserve the chosen duration when the start is moved, including midnight rollover. */
export function movedEventEnd(
  start: string,
  end: string,
  nextStart: string,
  allDay: boolean,
): string {
  try {
    if (allDay)
      return Temporal.PlainDate.from(nextStart)
        .add(Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(end)))
        .toString();
    const before = Temporal.PlainDateTime.from(start);
    const after = Temporal.PlainDateTime.from(end);
    if (Temporal.PlainDateTime.compare(after, before) <= 0) return end;
    return Temporal.PlainDateTime.from(nextStart)
      .add(before.until(after))
      .toString();
  } catch {
    return end;
  }
}
