import { useState } from "react";
import type { Account, Command, Settings } from "../shared/model";
import { AppError } from "../shared/errors";
import { calendarKey } from "../shared/preferences";
import { readableCalendar } from "../calendar/sync-model";
import { useConnectionClock, useSyncMetadata } from "./use-sync-metadata";

export function SyncSettings({
  accounts,
  settings,
  busy,
  run,
}: {
  accounts: Account[];
  settings: Settings;
  busy: boolean;
  run: (command: Command, success?: string) => Promise<void>;
}) {
  const [interval, setInterval] = useState(settings.syncIntervalMinutes);
  const [past, setPast] = useState(settings.cachePastMonths);
  const [future, setFuture] = useState(settings.cacheFutureMonths);
  const [refresh, setRefresh] = useState(settings.refreshOnOpen);
  const metadata = useSyncMetadata();
  const clock = useConnectionClock();
  return (
    <section className="settings-section sync-settings">
      <p className="eyebrow">GOOGLE CALENDAR</p>
      <h2>Event synchronization</h2>
      <p className="muted">
        Events are read directly from Google and saved on this device. Syncing
        never creates or changes Google events. Chrome may delay background work
        while asleep.
      </p>
      <form
        className="settings-form appearance-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            {
              type: "UPDATE_SETTINGS",
              settings: {
                syncIntervalMinutes: interval,
                refreshOnOpen: refresh,
                cachePastMonths: past,
                cacheFutureMonths: future,
              },
            },
            "Sync preferences saved.",
          );
        }}
      >
        <label>
          Event sync interval
          <span className="input-unit">
            <input
              aria-label="Event sync interval"
              type="number"
              min={1}
              max={1440}
              required
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            />{" "}
            minutes
          </span>
        </label>
        <label>
          Cache past months
          <span className="input-unit">
            <input
              type="number"
              min={0}
              max={12}
              required
              value={past}
              onChange={(e) => setPast(Number(e.target.value))}
            />
          </span>
        </label>
        <label>
          Cache future months
          <span className="input-unit">
            <input
              type="number"
              min={0}
              max={12}
              required
              value={future}
              onChange={(e) => setFuture(Number(e.target.value))}
            />
          </span>
        </label>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={refresh}
            onChange={(e) => setRefresh(e.target.checked)}
          />{" "}
          Refresh when opening the calendar
        </label>
        <small>
          The home cache surrounds the current month. Browsing outside it also
          keeps the last requested three-month window. Repeated opens within one
          minute reuse the recent check.
        </small>
        <button className="button primary" disabled={busy}>
          Save sync preferences
        </button>
      </form>
      <button
        className="button subtle"
        disabled={busy || !accounts.some((a) => a.enabled)}
        onClick={() =>
          void run(
            { type: "SYNC_EVENTS", reason: "manual" },
            "Google calendars selected. Review sync status below.",
          )
        }
      >
        Sync and show Google calendars
      </button>
      {settings.dataSource === "demo" && (
        <p className="muted">
          The calendar is displaying sample events. This action switches the
          popup and calendar tab to your enabled Google accounts.
        </p>
      )}
      <p className="muted">
        {clock.online
          ? "Connected to the network"
          : "Offline — saved events remain available"}
        . Calendar visibility affects display; enabled accounts continue syncing
        their readable calendars.
      </p>
      {metadata?.failed && (
        <p role="alert">Local sync status could not be read.</p>
      )}
      {accounts.map((account) => (
        <details className="sync-account" key={account.id} open>
          <summary>
            {account.email} {account.enabled ? "" : "· paused"}
          </summary>
          {!account.eventsReadGranted && (
            <p className="muted">
              Read-only event permission is required. Use this account’s
              Reconnect control above to approve access.
            </p>
          )}
          {account.calendars.map((calendar) => {
            const state = metadata?.states.find(
              (item) => item.key === calendarKey(account.id, calendar.id),
            );
            const ranges =
              metadata?.ranges.filter(
                (r) =>
                  r.accountId === account.id && r.calendarId === calendar.id,
              ) ?? [];
            const stale =
              state?.invalidated ||
              !state?.lastCheckedAt ||
              clock.now - Date.parse(state.lastCheckedAt) >
                settings.staleAfterMinutes * 60_000;
            return (
              <div className="sync-calendar" key={calendar.id}>
                <strong>{calendar.summary}</strong>
                {!readableCalendar(calendar.accessRole) ? (
                  <p>
                    Busy-only or unreadable calendar · event details are
                    unavailable.
                  </p>
                ) : (
                  <>
                    <p>
                      {state?.running
                        ? "Syncing…"
                        : state?.lastCheckedAt
                          ? `Last successful check ${new Date(state.lastCheckedAt).toLocaleString()}${stale ? " · stale" : ""}`
                          : "Not synced yet"}
                    </p>
                    {state?.errorCode && (
                      <p className="sync-error">
                        {
                          new AppError(state.errorCode, state.errorDetails)
                            .message
                        }
                      </p>
                    )}
                    {state?.retryAt &&
                      Date.parse(state.retryAt) > clock.now && (
                        <p>
                          Retry after{" "}
                          {new Date(state.retryAt).toLocaleTimeString()}. Manual
                          sync respects this backoff.
                        </p>
                      )}
                    {ranges.map((range) => (
                      <p key={range.key}>
                        {range.kind === "home"
                          ? "Home cache"
                          : "Browsing cache"}
                        : {range.start} to {range.end} (end exclusive)
                      </p>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </details>
      ))}
    </section>
  );
}
