import { useEffect, useState } from "react";
import { AppError } from "../shared/errors";
import {
  needsReconnect,
  type Account,
  type Command,
  type Settings,
} from "../shared/model";
import { useExtensionState } from "./use-extension-state";
import { AppearanceSettings } from "./AppearanceSettings";
import { useTheme } from "./use-theme";
import { SyncSettings } from "./SyncSettings";
import { AccountChooserSettings } from "./AccountChooserSettings";
import "./styles.css";

function timeLabel(value: string | null): string {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function AccountCard({
  account,
  busy,
  staleAfterMinutes,
  run,
}: {
  account: Account;
  busy: boolean;
  staleAfterMinutes: number;
  run: (command: Command, success?: string) => Promise<void>;
}) {
  const stale =
    !account.lastSuccessfulAt ||
    Date.now() - Date.parse(account.lastSuccessfulAt) >
      staleAfterMinutes * 60_000;
  const label = !account.enabled
    ? "Paused"
    : account.status === "reconnect"
      ? "Reconnect needed"
      : account.status === "offline"
        ? account.errorDetails?.networkFailure === "offline"
          ? "Offline"
          : "Connection issue"
        : account.status === "error"
          ? "Check failed"
          : stale
            ? "Check overdue"
            : "Connected";
  return (
    <article className={`account-card ${!account.enabled ? "paused" : ""}`}>
      <div className="account-heading">
        <span className="avatar" aria-hidden="true">
          {account.email.slice(0, 1).toUpperCase()}
        </span>
        <div className="account-identity">
          <h3>{account.email}</h3>
          <span
            className={`status status-${account.enabled ? account.status : "paused"}`}
          >
            {label}
          </span>
        </div>
        <label
          className="switch"
          title={account.enabled ? "Pause account" : "Enable account"}
        >
          <input
            type="checkbox"
            checked={account.enabled}
            disabled={busy}
            aria-label={`Enable ${account.email}`}
            onChange={(event) =>
              void run({
                type: "SET_ENABLED",
                accountId: account.id,
                enabled: event.target.checked,
              })
            }
          />
          <span aria-hidden="true" />
        </label>
      </div>
      {account.errorCode && account.enabled && (
        <p className="inline-warning">
          {new AppError(account.errorCode, account.errorDetails).message}
        </p>
      )}
      <p className="account-summary">
        {account.calendars.length} calendar
        {account.calendars.length === 1 ? "" : "s"} · Last successful check{" "}
        {timeLabel(account.lastSuccessfulAt)}
      </p>
      <details className="calendar-details">
        <summary>View calendar list</summary>
        <ul>
          {account.calendars.map((calendar) => (
            <li key={calendar.id}>
              <span>
                {calendar.summary}
                {calendar.primary && <small>Primary</small>}
              </span>
              <span className="calendar-role">
                {calendar.accessRole}
                {calendar.timeZone ? ` · ${calendar.timeZone}` : ""}
              </span>
            </li>
          ))}
        </ul>
        {account.calendars.length === 0 && (
          <p className="muted">No calendars returned by Google.</p>
        )}
      </details>
      <div className="account-actions">
        {account.status !== "reconnect" && !account.eventsReadGranted && (
          <button
            className="button primary"
            disabled={busy || !account.enabled}
            title="Approve read-only event access for this account"
            onClick={() =>
              void run(
                { type: "RECONNECT", accountId: account.id },
                "Event access approved.",
              )
            }
          >
            Reconnect
          </button>
        )}
        {account.status === "reconnect" ? (
          <button
            className="button primary"
            disabled={busy || !account.enabled}
            onClick={() =>
              void run(
                { type: "RECONNECT", accountId: account.id },
                "Account reconnected.",
              )
            }
          >
            Reconnect
          </button>
        ) : (
          <button
            className="button subtle"
            disabled={busy || !account.enabled}
            onClick={() =>
              void run(
                { type: "CHECK", accountId: account.id },
                "Connection checked.",
              )
            }
          >
            Check connection
          </button>
        )}
        <button
          className="button subtle"
          disabled={busy || !account.enabled}
          title="Discard the cached access token for this account and request another without a sign-in prompt."
          onClick={() =>
            void run(
              { type: "CHECK", accountId: account.id, freshToken: true },
              "A fresh token was obtained and calendar access verified.",
            )
          }
        >
          Test token renewal
        </button>
        <button
          className="button text danger"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                `Remove ${account.email} and its cached calendars/events from this device? This does not sign you out of Google.`,
              )
            )
              void run({ type: "REMOVE", accountId: account.id });
          }}
        >
          Remove
        </button>
      </div>
    </article>
  );
}

function SettingsForm({
  settings,
  busy,
  run,
}: {
  settings: Settings;
  busy: boolean;
  run: (command: Command, success?: string) => Promise<void>;
}) {
  const [interval, setInterval] = useState(
    settings.connectionCheckMinutes.toString(),
  );
  const [stale, setStale] = useState(settings.staleAfterMinutes.toString());
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          {
            type: "UPDATE_SETTINGS",
            settings: {
              connectionCheckMinutes: Number(interval),
              staleAfterMinutes: Number(stale),
            },
          },
          "Settings saved. Background checks have been rescheduled.",
        );
      }}
    >
      <label>
        Connection check interval{" "}
        <span className="input-unit">
          <input
            name="connectionCheckMinutes"
            type="number"
            min="1"
            max="1440"
            step="1"
            required
            value={interval}
            onChange={(event) => setInterval(event.target.value)}
          />{" "}
          minutes
        </span>
        <small>
          Checks account access and refreshes calendar lists. Event sync has its
          own interval below.
        </small>
      </label>
      <label>
        Warn when data is older than{" "}
        <span className="input-unit">
          <input
            name="staleAfterMinutes"
            type="number"
            min="1"
            max="10080"
            step="1"
            required
            value={stale}
            onChange={(event) => setStale(event.target.value)}
          />{" "}
          minutes
        </span>
        <small>
          Saved calendar information stays available if a check fails.
        </small>
      </label>
      <button className="button primary" type="submit" disabled={busy}>
        Save settings
      </button>
    </form>
  );
}

export function App({ compact = false }: { compact?: boolean }) {
  const {
    state,
    busy,
    error,
    notice,
    report,
    progress,
    run,
    setError,
    setNotice,
  } = useExtensionState();
  useTheme(state?.settings.theme);
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => setClock((value) => value + 1),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const reconnectCount = state?.accounts.filter(needsReconnect).length ?? 0;
  return (
    <div className={compact ? "app popup" : "app settings-page"}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ▦
          </span>
          <span>Calendar Checker</span>
          <button
            className="button subtle"
            onClick={() =>
              void chrome.tabs.create({
                url: chrome.runtime.getURL("/calendar.html"),
              })
            }
          >
            Open calendar ↗
          </button>
        </div>
        <span className="local-label">
          <span aria-hidden="true">●</span> Stored on this device
        </span>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR GOOGLE CALENDARS</p>
            <h1>{compact ? "Your accounts" : "Together, on your terms."}</h1>
            <p className="lead">
              Connect your accounts. Keep your settings and calendar cache on
              this device.
            </p>
          </div>
          {compact && (
            <button
              className="button subtle"
              onClick={() => void chrome.runtime.openOptionsPage()}
            >
              Settings ↗
            </button>
          )}
        </div>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="banner success" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <div className="working" role="status">
            <span className="spinner" /> {progress}
          </div>
        )}
        {!state && !error && (
          <p className="muted" role="status">
            Loading your accounts…
          </p>
        )}
        {state && (
          <>
            {reconnectCount > 0 && (
              <div className="banner warning" role="alert">
                {reconnectCount} account
                {reconnectCount === 1 ? " needs" : "s need"} to be reconnected.
                Saved information is still available below.
              </div>
            )}
            {!state.oauthConfigured && (
              <section className="setup-card">
                <p className="eyebrow">ONE-TIME GOOGLE SETUP</p>
                <h2>Connect your extension to Google</h2>
                <p>
                  Register this extension ID as a Chrome Extension OAuth client
                  in Google Cloud:
                </p>
                <code className="extension-id">{state.extensionId}</code>
                <p>
                  Add the resulting client ID to <code>.env.local</code>, then
                  rebuild and reload the extension. Follow{" "}
                  <code>docs/GOOGLE-SETUP.md</code> in the project for each
                  step.
                </p>
                {compact && (
                  <button
                    className="button subtle"
                    onClick={() => void chrome.runtime.openOptionsPage()}
                  >
                    Open setup & settings ↗
                  </button>
                )}
              </section>
            )}
            <div className="section-heading">
              <div>
                <h2>
                  Connected accounts{" "}
                  <span className="count">{state.accounts.length}</span>
                </h2>
                <p className="muted">
                  Choose which accounts are checked in the background.
                </p>
              </div>
              <button
                className="button primary"
                disabled={busy || !state.oauthConfigured}
                onClick={() =>
                  void run(
                    { type: "CONNECT" },
                    "Account connected and calendar list loaded.",
                  )
                }
              >
                + Add Google account
              </button>
            </div>
            {state.accounts.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  ◎
                </span>
                <h3>A little more connected.</h3>
                <p>
                  Add your first Google account to see its calendars here.
                  Google will ask for permission.
                </p>
              </div>
            ) : (
              <div className="accounts">
                {state.accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    busy={busy}
                    staleAfterMinutes={state.settings.staleAfterMinutes}
                    run={run}
                  />
                ))}
              </div>
            )}
            {state.accounts.length > 0 && (
              <button
                className="button subtle"
                disabled={busy || !state.oauthConfigured}
                onClick={() =>
                  void run(
                    { type: "CHECK_ALL" },
                    "Enabled accounts checked. See each account for its status.",
                  )
                }
              >
                Check all enabled accounts
              </button>
            )}
            {!compact && (
              <>
                <section className="settings-section">
                  <div>
                    <p className="eyebrow">BACKGROUND ACTIVITY</p>
                    <h2>Connection preferences</h2>
                    <p className="muted">
                      Adjust how often Google access is checked. Changes apply
                      immediately.
                    </p>
                  </div>
                  <SettingsForm
                    key={`${state.settings.connectionCheckMinutes}-${state.settings.staleAfterMinutes}`}
                    settings={state.settings}
                    busy={busy}
                    run={run}
                  />
                </section>
                <AccountChooserSettings
                  key={`chooser-${state.settings.webOAuthClientId}`}
                  settings={state.settings}
                  extensionId={state.extensionId}
                  busy={busy}
                  run={run}
                />
                <AppearanceSettings
                  key={JSON.stringify(state.settings)}
                  settings={state.settings}
                  busy={busy}
                  run={run}
                />
                <SyncSettings
                  key={`sync-${JSON.stringify(state.settings)}`}
                  settings={state.settings}
                  accounts={state.accounts}
                  busy={busy}
                  run={run}
                />
                <section className="settings-section">
                  <div>
                    <p className="eyebrow">TROUBLESHOOTING</p>
                    <h2>Connection diagnostics</h2>
                    <p className="muted">
                      Generate a local report of check results. It excludes
                      tokens, email addresses, account IDs, and calendar names.
                    </p>
                  </div>
                  <div className="diagnostics-actions">
                    <button
                      className="button subtle"
                      disabled={busy}
                      onClick={() => void run({ type: "GET_DIAGNOSTICS" })}
                    >
                      Generate report
                    </button>
                    {report && (
                      <button
                        className="button subtle"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(report)
                            .then(() => setNotice("Diagnostics copied."))
                            .catch(() =>
                              setError(
                                "Copy failed. Select the report below to copy it manually.",
                              ),
                            );
                        }}
                      >
                        Copy report
                      </button>
                    )}
                  </div>
                  {report && (
                    <pre className="diagnostics" tabIndex={0}>
                      {report}
                    </pre>
                  )}
                </section>
                <footer>
                  <p>
                    Extension ID <code>{state.extensionId}</code>
                  </p>
                  <p>
                    Google events are cached locally for offline use. Event
                    editing, notification sounds, and DND are planned next.
                  </p>
                  <p>
                    Adding another account resets this extension’s cached token
                    selection. Existing connected accounts remain saved and are
                    checked independently. Removing an account only removes its
                    saved data from this device.
                  </p>
                </footer>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
