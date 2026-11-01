import type { ErrorCode } from "./model";

const MESSAGES: Record<ErrorCode, string> = {
  "setup-required":
    "Configure the Google OAuth client ID and rebuild the extension before connecting an account.",
  "auth-cancelled":
    "Google sign-in was cancelled. Your connected accounts have been kept.",
  "reconnect-required": "Google needs you to reconnect this account.",
  "permission-required":
    "Calendar access was not granted. Reconnect and allow the requested permissions.",
  "account-mismatch":
    "Google returned a different account. No calendar data was loaded or replaced. Reconnect the intended account.",
  network:
    "Google could not be reached. Saved calendar information is still available; try again when connected.",
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
  constructor(public readonly code: ErrorCode) {
    super(MESSAGES[code]);
    this.name = "AppError";
  }
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
  if (/network|connection|offline|timeout/.test(message))
    return new AppError("network");
  if (/cancel|did not approve|rejected|denied/.test(message))
    return new AppError("auth-cancelled");
  if (/invalid client|bad client|client id|not registered/.test(message))
    return new AppError("setup-required");
  return new AppError("reconnect-required");
}
