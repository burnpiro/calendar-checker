import type { Account, Settings } from "../shared/model";
import { calendarKey } from "../shared/preferences";
import {
  containsRange,
  readableCalendar,
  viewableCalendar,
  type DateRange,
} from "./sync-model";
import type { SyncMetadata } from "./sync-model";

export function preferredCalendarAccounts(
  accounts: Account[],
  settings: Settings,
  metadata: SyncMetadata | undefined,
  view: DateRange,
): Map<string, string> {
  const chosen = new Map<
    string,
    { id: string; rank: number; score: number; details: boolean }
  >();
  for (const account of accounts.filter((item) => item.enabled))
    for (const calendar of account.calendars) {
      if (
        !viewableCalendar(calendar.accessRole) ||
        settings.calendarVisibility[calendarKey(account.id, calendar.id)] ===
          false
      )
        continue;
      const state = metadata?.states.find(
        (item) => item.key === calendarKey(account.id, calendar.id),
      );
      const ranges =
        metadata?.ranges.filter(
          (range) =>
            range.accountId === account.id &&
            range.calendarId === calendar.id &&
            range.start < view.end &&
            range.end > view.start,
        ) ?? [];
      const details = readableCalendar(calendar.accessRole);
      const modeChanged =
        (state?.dataKind ?? "events") !== (details ? "events" : "freebusy");
      const rank = ranges.some((range) => containsRange(range, view))
        ? state?.invalidated || modeChanged
          ? 2
          : 3
        : ranges.length
          ? 1
          : 0;
      const score = Math.max(
        0,
        ...ranges.map((range) => Date.parse(range.validatedAt)),
      );
      const previous = chosen.get(calendar.id);
      if (
        !previous ||
        rank > previous.rank ||
        (rank === previous.rank &&
          Number(details) > Number(previous.details)) ||
        (rank === previous.rank &&
          details === previous.details &&
          score > previous.score)
      )
        chosen.set(calendar.id, { id: account.id, rank, score, details });
    }
  return new Map([...chosen].map(([calendar, value]) => [calendar, value.id]));
}
export function coverageStatus(
  accounts: Account[],
  settings: Settings,
  metadata: SyncMetadata | undefined,
  view: DateRange,
  online: boolean,
  now: number,
) {
  const selected = preferredCalendarAccounts(
    accounts,
    settings,
    metadata,
    view,
  );
  let missing = 0,
    invalid = false,
    failed = false,
    running = false;
  const times: number[] = [];
  for (const [calendarId, accountId] of selected) {
    const state = metadata?.states.find(
      (item) => item.key === calendarKey(accountId, calendarId),
    );
    running ||= state?.running ?? false;
    invalid ||= state?.invalidated ?? false;
    const role = accounts
      .find((a) => a.id === accountId)
      ?.calendars.find((c) => c.id === calendarId)?.accessRole;
    invalid ||=
      (state?.dataKind === "freebusy") !== (role === "freeBusyReader");
    failed ||= Boolean(state?.errorCode);
    const ranges =
      metadata?.ranges.filter(
        (range) =>
          range.accountId === accountId &&
          range.calendarId === calendarId &&
          containsRange(range, view),
      ) ?? [];
    if (!ranges.length) missing++;
    else
      times.push(
        Math.max(...ranges.map((range) => Date.parse(range.validatedAt))),
      );
  }
  const oldest = times.length ? Math.min(...times) : undefined;
  const stale =
    invalid ||
    (oldest !== undefined &&
      now - oldest > settings.staleAfterMinutes * 60_000);
  const age =
    oldest === undefined
      ? "Never synced"
      : `Last synced ${Math.max(0, Math.floor((now - oldest) / 60_000))} min ago`;
  if (metadata?.failed)
    return {
      short: "Cache unavailable",
      message:
        "Local calendar storage could not be read. Open Settings for account information.",
      warning: true,
    };
  if (!accounts.some((account) => account.enabled))
    return {
      short: "No enabled accounts",
      message:
        "Connect or enable a Google account in Settings to load your events.",
      warning: true,
    };
  if (!selected.size)
    return {
      short: "No calendars selected",
      message:
        "Select a calendar in the sidebar. Busy-only calendars show availability without event details.",
      warning: true,
    };
  if (!online)
    return {
      short: "Offline · cached events",
      message: `Offline — showing saved events. ${missing ? "Some visible dates have not been cached." : age + "."}`,
      warning: true,
    };
  if (running)
    return {
      short: "Syncing events…",
      message: "Syncing Google events. Saved events remain available.",
      warning: false,
    };
  if (missing)
    return {
      short: "Dates not fully cached",
      message: `${missing} of ${selected.size} calendars have not cached all visible dates. Sync when connected; an empty area may be uncached.`,
      warning: true,
    };
  if (stale || failed)
    return {
      short: stale ? "Cached events are stale" : "Sync needs attention",
      message: `${stale ? "Cached events may be out of date." : "Some calendars could not sync."} ${age}. Saved events are still available; see Settings for details.`,
      warning: true,
    };
  return {
    short: age,
    message: `${age}. All visible calendars have cached coverage.`,
    warning: false,
  };
}
