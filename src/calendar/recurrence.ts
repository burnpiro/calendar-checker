import { Temporal } from "temporal-polyfill";

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export interface RepeatRule {
  frequency: string;
  interval: number;
  ends: "count" | "until" | "never";
  count: number;
  until: string;
  weekdays: string[];
  allDay: boolean;
  timeZone: string;
  start: string;
}
export function repeatRule(input: RepeatRule): string[] {
  if (input.frequency === "none") return [];
  if (
    !/^(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(input.frequency) ||
    !Number.isInteger(input.interval) ||
    input.interval < 1 ||
    input.interval > 99
  )
    throw new Error("Choose a valid repeat interval.");
  let rule = `RRULE:FREQ=${input.frequency};INTERVAL=${input.interval}`;
  if (input.frequency === "WEEKLY" && input.weekdays.length) {
    if (
      new Set(input.weekdays).size !== input.weekdays.length ||
      input.weekdays.some(
        (d) => !WEEKDAYS.includes(d as (typeof WEEKDAYS)[number]),
      )
    )
      throw new Error("Choose valid repeat weekdays.");
    rule += `;BYDAY=${WEEKDAYS.filter((d) => input.weekdays.includes(d)).join(",")}`;
  }
  if (input.ends === "count") {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000)
      throw new Error("Choose 1–1000 occurrences.");
    rule += `;COUNT=${input.count}`;
  } else if (input.ends === "until") {
    const date = Temporal.PlainDate.from(input.until);
    const first = input.allDay
      ? input.start
      : Temporal.Instant.from(input.start)
          .toZonedDateTimeISO(input.timeZone)
          .toPlainDate()
          .toString();
    if (Temporal.PlainDate.compare(date, first) < 0)
      throw new Error("Repeat end must not precede the event.");
    const until = input.allDay
      ? date.toString().replaceAll("-", "")
      : date
          .toPlainDateTime("23:59:59")
          .toZonedDateTime(input.timeZone)
          .toInstant()
          .toString()
          .replaceAll("-", "")
          .replaceAll(":", "");
    rule += `;UNTIL=${until}`;
  }
  return [rule];
}
/** Allow only our bounded editor grammar for new rules; existing complex rules remain unchanged. */
export function validNewRecurrence(rules: string[]): boolean {
  if (rules.length !== 1) return false;
  const match = rules[0]!.match(
    /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=([1-9][0-9]?))?(?:;BYDAY=((?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*))?(?:;COUNT=([1-9][0-9]{0,3})|;UNTIL=(\d{8}(?:T\d{6}Z)?))?$/,
  );
  if (
    !match ||
    (match[4] && Number(match[4]) > 1000) ||
    (match[3] &&
      (match[1] !== "WEEKLY" ||
        new Set(match[3].split(",")).size !== match[3].split(",").length))
  )
    return false;
  if (match[5]) {
    try {
      const raw = match[5];
      const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      Temporal.PlainDate.from(date, { overflow: "reject" });
      if (raw.length > 8)
        Temporal.Instant.from(
          `${date}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`,
        );
    } catch {
      return false;
    }
  }
  return true;
}
