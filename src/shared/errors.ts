import type { ErrorCode, FailureDetails } from "./model";

const MESSAGES: Record<ErrorCode, string> = {
  "notification-denied":
    "Chrome notifications are blocked. Allow Calendar Checker notifications in Chrome and your operating-system settings.",
  "sound-invalid":
    "Choose a playable MP3, WAV, Ogg, M4A or WebM audio file up to 5 MB and 60 seconds. Up to 10 custom sounds can be stored locally.",
  "sound-in-use":
    "This sound is assigned to reminders. Choose another sound for the default and calendar overrides before deleting it.",
  "reminder-ended":
    "This snooze would be after the event ends. Choose a shorter snooze or dismiss it.",
  "event-conflict":
    "This event changed in Google. Review the pending change before choosing which version to keep.",
  "event-readonly":
    "This event cannot be edited here. Use a writable calendar and a regular event; specialized or locked events can be opened in Google Calendar.",
  "pending-writes":
    "Resolve or discard pending event changes for this account or event first. Saved changes have been kept.",
  "event-gone":
    "This event was deleted or is no longer accessible in Google. Your pending change has been kept.",
  "calendar-unavailable":
    "This calendar is no longer readable. Cached events have been kept; check its sharing permissions in Google Calendar.",
  "sync-expired":
    "Google requires a fresh calendar sync. Cached events remain available while it is rebuilt.",
  "setup-required":
    "Configure the Google OAuth client ID and rebuild the extension before connecting an account.",
  "auth-cancelled":
    "Google sign-in was cancelled. Your connected accounts have been kept.",
  "reconnect-required": "Google needs you to reconnect this account.",
  "permission-required":
    "Calendar access was not granted. Reconnect and allow the requested permissions.",
  "account-already-connected":
    "That Google account is already connected. No new account was added. Choose a different account. If no chooser opens, configure Google account chooser in Settings.",
  "chooser-setup-required":
    "Configure a Web application OAuth client in Settings → Google account chooser. Check that its authorized redirect URI matches this extension.",
  "account-mismatch":
    "Google returned a different account. No calendar data was loaded or replaced. Reconnect the intended account.",
  network:
    "A Google connection failed. Any saved calendar information has been kept. Try again; if it continues, generate a report in Settings → Connection diagnostics.",
  "rate-limited": "Google is limiting requests. Please try again later.",
  "api-disabled":
    "Enable Google Calendar API in the OAuth client's Google Cloud project, then try again.",
  "api-error":
    "Google could not complete the request. Your saved information has been kept.",
  "invalid-response":
    "Google returned an unexpected response. Your saved information has been kept.",
  "unknown-account":
    "This account is no longer connected. Refresh the page and try again.",
  "invalid-request":
    "The request or settings were invalid. Refresh the page and try again.",
  "storage-error":
    "Local settings could not be read or saved. Existing stored data has not been intentionally cleared.",
  unexpected: "The operation could not be completed. Please try again.",
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly details: FailureDetails = {},
  ) {
    super(code === "network" ? networkMessage(details) : MESSAGES[code]);
    this.name = "AppError";
  }
}

function networkMessage(details: FailureDetails): string {
  const step =
    details.stage === "authorization"
      ? "Chrome could not complete Google sign-in."
      : details.stage === "account-details"
        ? "The connection failed while loading your Google account details."
        : details.stage === "calendar-list"
          ? "The connection failed while loading your Google calendar list."
          : details.stage === "calendar-events"
            ? "The connection failed while syncing Google events."
            : "A Google connection failed.";
  const reason =
    details.networkFailure === "timeout"
      ? "The request timed out."
      : details.networkFailure === "offline"
        ? "Chrome reports that this device is offline."
        : details.browserNetworkCode !== undefined
          ? `Chrome reported network error ${details.browserNetworkCode}.`
          : "";
  return [
    step,
    reason,
    "Any saved calendar information has been kept. Try again; if it continues, generate a report in Settings → Connection diagnostics.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function asAppError(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError("unexpected");
}

export function isReconnectError(code: ErrorCode): boolean {
  return [
    "reconnect-required",
    "permission-required",
    "account-mismatch",
  ].includes(code);
}

export function classifyIdentityError(error: unknown): AppError {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const details: FailureDetails = { stage: "authorization" };
  if (/network|connection|offline|timeout|timed out/.test(message)) {
    const match = message.match(/connection failed \((-?\d{1,3})\)/);
    const code = match ? Number(match[1]) : undefined;
    return new AppError("network", {
      ...details,
      networkFailure: /timeout|timed out/.test(message)
        ? "timeout"
        : /offline/.test(message)
          ? "offline"
          : "request-failed",
      ...(code !== undefined && code < 0 ? { browserNetworkCode: code } : {}),
    });
  }
  if (/cancel|did not approve|rejected|denied/.test(message))
    return new AppError("auth-cancelled", details);
  if (/invalid client|bad client|client id|not registered/.test(message))
    return new AppError("setup-required", details);
  return new AppError("reconnect-required", details);
}
