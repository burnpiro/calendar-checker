import { AppError, classifyIdentityError } from "../shared/errors";
import { SCOPES } from "../shared/model";
import type { TokenRequest } from "./ports";

const authorization = { stage: "authorization" } as const;
const clientPattern = /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/;

/** Optional direct Google chooser. Tokens and callback URLs never leave the worker. */
export class GoogleWebIdentity {
  private readonly cache = new Map<
    string,
    { token: string; expiresAt: number }
  >();
  private readonly issued = new Map<string, number>();

  async getToken(request: TokenRequest): Promise<string> {
    if (!request.webClientId || !clientPattern.test(request.webClientId))
      throw new AppError("chooser-setup-required", authorization);
    const now = Date.now();
    for (const [key, value] of this.cache)
      if (value.expiresAt <= now) this.cache.delete(key);
    for (const [token, expiresAt] of this.issued)
      if (expiresAt <= now) this.issued.delete(token);
    const key = JSON.stringify([request.webClientId, request.accountId]);
    const cached = this.cache.get(key);
    if (cached && !request.interactive) return cached.token;
    const redirect = chrome.identity.getRedirectURL();
    const state = crypto.randomUUID();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: request.webClientId,
      redirect_uri: redirect,
      response_type: "token",
      scope: SCOPES.join(" "),
      state,
      prompt: request.interactive ? "select_account" : "none",
      ...(request.accountId ? { login_hint: request.accountId } : {}),
    }).toString();
    let callback: string | undefined;
    try {
      callback = await chrome.identity.launchWebAuthFlow({
        url: url.href,
        interactive: request.interactive,
        ...(!request.interactive
          ? {
              abortOnLoadForNonInteractive: false,
              timeoutMsForNonInteractive: 15_000,
            }
          : {}),
      });
    } catch (error) {
      const safe = classifyIdentityError(error);
      throw !request.interactive && safe.code === "auth-cancelled"
        ? new AppError("reconnect-required", authorization)
        : safe;
    }
    const result = parseGoogleCallback(
      callback,
      redirect,
      state,
      request.interactive,
    );
    // In-memory only. After worker/browser restart a bounded, noninteractive flow
    // tries the account's Google session; missing consent/session requires Reconnect.
    const expiresAt = Date.now() + Math.max(0, result.seconds - 60) * 1000;
    if (this.issued.size >= 100) {
      this.issued.clear();
      this.cache.clear();
    }
    if (this.cache.size >= 50) this.cache.clear();
    this.issued.set(result.token, expiresAt);
    if (request.accountId)
      this.cache.set(key, { token: result.token, expiresAt });
    return result.token;
  }

  invalidate(token: string): boolean {
    if (!this.issued.delete(token)) return false;
    for (const [key, value] of this.cache)
      if (value.token === token) this.cache.delete(key);
    return true;
  }
}

export function parseGoogleCallback(
  callback: string | undefined,
  redirect: string,
  state: string,
  interactive: boolean,
): { token: string; seconds: number } {
  const invalid = () => new AppError("invalid-response", authorization);
  if (!callback)
    throw new AppError(
      interactive ? "auth-cancelled" : "reconnect-required",
      authorization,
    );
  let result: URL;
  try {
    result = new URL(callback);
  } catch {
    throw invalid();
  }
  const expected = new URL(redirect);
  if (
    result.origin !== expected.origin ||
    result.pathname !== expected.pathname ||
    result.username ||
    result.password
  )
    throw invalid();
  const parameters = new URLSearchParams(
    result.hash.slice(1) || result.search.slice(1),
  );
  if (
    [...parameters.keys()].some((key) => parameters.getAll(key).length !== 1) ||
    parameters.get("state") !== state
  )
    throw invalid();
  const failure = parameters.get("error");
  if (failure) {
    if (["server_error", "temporarily_unavailable"].includes(failure))
      throw new AppError("api-error", authorization);
    if (
      [
        "invalid_client",
        "redirect_uri_mismatch",
        "unauthorized_client",
      ].includes(failure)
    )
      throw new AppError("chooser-setup-required", authorization);
    throw new AppError(
      failure === "access_denied" && interactive
        ? "auth-cancelled"
        : "reconnect-required",
      authorization,
    );
  }
  const token = parameters.get("access_token");
  const seconds = Number(parameters.get("expires_in"));
  if (
    !result.hash ||
    result.search ||
    !token ||
    token.length > 8192 ||
    /\s/.test(token) ||
    parameters.get("token_type")?.toLowerCase() !== "bearer" ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 86400
  )
    throw invalid();
  const scopes = new Set((parameters.get("scope") ?? "").split(/\s+/));
  if (scopes.has("email"))
    scopes.add("https://www.googleapis.com/auth/userinfo.email");
  if (SCOPES.some((scope) => !scopes.has(scope)))
    throw new AppError("permission-required", authorization);
  return { token, seconds };
}
