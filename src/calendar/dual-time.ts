import { Temporal } from "temporal-polyfill";

/** Shared week axis: show every distinct conversion when offsets vary across days. */
export function secondarySlotLabel(
  date: Date,
  weekStart: string,
  primary: string,
  secondary: string,
  format: "12h" | "24h",
  weekends = true,
): string {
  const time = Temporal.Instant.fromEpochMilliseconds(date.getTime())
    .toZonedDateTimeISO(primary)
    .toPlainTime();
  const first = Temporal.PlainDate.from(weekStart);
  const result = new Set<string>();
  for (let day = 0; day < 7; day++) {
    const localDate = first.add({ days: day });
    if (!weekends && localDate.dayOfWeek > 5) continue;
    const wall = localDate.toPlainDateTime(time);
    for (const disambiguation of ["earlier", "later"] as const) {
      const instant = wall.toZonedDateTime(primary, { disambiguation });
      if (!instant.toPlainDateTime().equals(wall)) continue;
      const target = instant.withTimeZone(secondary);
      const delta = localDate.until(target.toPlainDate(), {
        largestUnit: "days",
      }).days;
      const text = new Intl.DateTimeFormat("en", {
        timeZone: secondary,
        hour: "numeric",
        minute: "2-digit",
        hour12: format === "12h",
      }).format(new Date(Number(instant.epochMilliseconds)));
      result.add(`${text}${delta ? ` ${delta > 0 ? "+" : ""}${delta}d` : ""}`);
    }
  }
  return [...result].join(" / ") || "—";
}
