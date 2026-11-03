import {
  AutoSaveStatus,
  useAutoSavePreferences,
} from "./use-auto-save-preferences";
import { numericPreference } from "./preference-autosave";
import type { Account, Command, Settings } from "../shared/model";
import { AppError } from "../shared/errors";
import { calendarKey } from "../shared/preferences";
import { viewableCalendar } from "../calendar/sync-model";
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
  const save = useAutoSavePreferences(
    settings,
    (s) => ({
      interval: s.syncIntervalMinutes as number | string,
      past: s.cachePastMonths as number | string,
      future: s.cacheFutureMonths as number | string,
      refresh: s.refreshOnOpen,
      excludeDescriptions: s.excludeEventDescriptions,
    }),
    (d) => ({
      syncIntervalMinutes: numericPreference(d.interval),
      cachePastMonths: numericPreference(d.past),
      cacheFutureMonths: numericPreference(d.future),
      refreshOnOpen: d.refresh,
      excludeEventDescriptions: d.excludeDescriptions,
    }),
  );
  const { interval, past, future, refresh, excludeDescriptions } = save.draft;
  const setInterval = (interval: string) =>
    save.setDraft((d) => ({ ...d, interval }));
  const setPast = (past: string) => save.setDraft((d) => ({ ...d, past }));
  const setFuture = (future: string) =>
    save.setDraft((d) => ({ ...d, future }));
  const setRefresh = (refresh: boolean) =>
    save.setDraft((d) => ({ ...d, refresh }));
  const metadata = useSyncMetadata();
  const clock = useConnectionClock();
  return (
    <section className="settings-section sync-settings">
      <p className="eyebrow">GOOGLE CALENDAR</p>
      <h2>Event synchronization</h2>
      <p className="muted">
        Events are read directly from Google and saved on this device. Syncing
        also sends your explicitly queued event changes. Chrome may delay
        background work while asleep.
      </p>
      <form
        className="settings-form appearance-form"
        onSubmit={(event) => event.preventDefault()}
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
              onChange={(e) => setInterval(e.target.value)}
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
              onChange={(e) => setPast(e.target.value)}
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
              onChange={(e) => setFuture(e.target.value)}
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
        <label className="check-setting">
          <input
            type="checkbox"
            checked={excludeDescriptions}
            aria-describedby="description-privacy-help"
            onChange={(e) =>
              save.setDraft((d) => ({
                ...d,
                excludeDescriptions: e.target.checked,
              }))
            }
          />{" "}
          Exclude event descriptions
        </label>
        <small id="description-privacy-help">
          Do not download descriptions from Google. Removes previously cached
          descriptions, including saved editing and conflict copies.
          Descriptions you explicitly write stay in pending changes until saved
          to Google. Titles, locations, guests and other event details are still
          cached.
        </small>
        <small>
          Setting both month counts to 0 still caches the current month; it does
          not disable offline storage. Viewing the calendar can also keep a
          three-month browsing window.
        </small>
        <small>
          The home cache surrounds the current month. The last requested
          three-month browsing window is retained when it does not fit inside
          the home cache. Repeated opens within one minute reuse the recent
          check.
        </small>
        <AutoSaveStatus {...save} />
      </form>
      <button
        className="button subtle"
        disabled={busy || !accounts.some((a) => a.enabled)}
        onClick={() =>
          void run(
            { type: "SYNC_EVENTS", reason: "manual" },
            "Sync finished. See each calendar for its status.",
          )
        }
      >
        Sync Google calendars
      </button>
      <p className="muted">
        {clock.online
          ? "Connected to the network"
          : "Offline — saved events remain available"}
        . Calendar visibility affects display; enabled accounts continue syncing
        their accessible calendars, including busy-only availability.
      </p>
      {metadata?.failed && (
        <p role="alert">Local sync status could not be read.</p>
      )}
      {accounts.map((account) => (
        <details
          className="sync-account"
          key={account.id}
          open={metadata?.states.some(
            (s) => s.accountId === account.id && Boolean(s.errorCode),
          )}
        >
          <summary>
            {account.email} · {account.calendars.length} calendars{" "}
            {account.enabled ? "" : "· paused"}
            {metadata?.states.some(
              (s) => s.accountId === account.id && Boolean(s.errorCode),
            ) && <span className="status-error"> · Needs attention</span>}
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
                {!viewableCalendar(calendar.accessRole) ? (
                  <p>Unreadable calendar · event information is unavailable.</p>
                ) : (
                  <>
                    {calendar.accessRole === "freeBusyReader" && (
                      <p>
                        Busy-only calendar · shows occupied times without event
                        details.
                      </p>
                    )}
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
