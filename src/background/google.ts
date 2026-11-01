import { z } from "zod";
import { AppError } from "../shared/errors";
import type { CalendarSummary, FailureDetails } from "../shared/model";
import type { GoogleGateway } from "./ports";

const profileSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.literal(true),
});
const pageSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        summary: z.string().optional(),
        summaryOverride: z.string().optional(),
        accessRole: z.string(),
        primary: z.boolean().optional(),
        timeZone: z.string().optional(),
      }),
    )
    .optional(),
});

export class GoogleHttpError extends AppError {
  constructor(
    public readonly status: number,
    code: ConstructorParameters<typeof AppError>[0],
    details: FailureDetails = {},
  ) {
    super(code, { ...details, httpStatus: status });
  }
}

interface RequestPolicy {
  waitBeforeRetry?: () => Promise<void>;
  isOnline?: () => boolean;
}

// Native fetch checks its Window/Worker receiver in Chrome. Calling a stored native
// function as `this.fetcher(...)` instead binds it to the gateway and throws before I/O.
export const browserFetch: typeof fetch = (...args) =>
  globalThis.fetch(...args);

export class GoogleCalendarGateway implements GoogleGateway {
  constructor(
    private readonly fetcher: typeof fetch = browserFetch,
    private readonly policy: RequestPolicy = {},
  ) {}

  private transportError(
    error: unknown,
    stage: FailureDetails["stage"],
    httpStatus?: number,
  ): AppError {
    if (
      error instanceof TypeError &&
      /illegal invocation/i.test(error.message)
    ) {
      return new AppError("unexpected", { stage });
    }
    const name = error instanceof Error ? error.name : "";
    const online =
      this.policy.isOnline?.() ?? globalThis.navigator?.onLine !== false;
    return new AppError("network", {
      stage,
      networkFailure:
        name === "TimeoutError" || name === "AbortError"
          ? "timeout"
          : !online
            ? "offline"
            : "request-failed",
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    });
  }

  private async request(
    url: string,
    token: string,
    stage: FailureDetails["stage"],
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce(url, token, stage);
      } catch (error) {
        // Read-only GETs are safe to retry once. HTTP/auth/schema errors are handled separately.
        if (
          !(error instanceof AppError) ||
          error.code !== "network" ||
          error.details.networkFailure === "offline" ||
          attempt > 0
        )
          throw error;
        await (this.policy.waitBeforeRetry?.() ??
          new Promise<void>((resolve) => setTimeout(resolve, 500)));
      }
    }
  }

  private async requestOnce(
    url: string,
    token: string,
    stage: FailureDetails["stage"],
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
    } catch (error) {
      throw this.transportError(error, stage);
    }
    if (!response.ok) {
      if (response.status === 401)
        throw new GoogleHttpError(401, "reconnect-required", { stage });
      const data = (await response.json().catch(() => ({}))) as {
        error?: { errors?: { reason?: string }[] };
      };
      const reason = data?.error?.errors?.[0]?.reason;
      if (
        response.status === 429 ||
        reason === "rateLimitExceeded" ||
        reason === "userRateLimitExceeded" ||
        reason === "quotaExceeded"
      ) {
        throw new GoogleHttpError(response.status, "rate-limited", { stage });
      }
      if (reason === "accessNotConfigured" || reason === "serviceDisabled") {
        throw new GoogleHttpError(response.status, "api-disabled", { stage });
      }
      if (response.status === 403)
        throw new GoogleHttpError(403, "permission-required", { stage });
      throw new GoogleHttpError(response.status, "api-error", { stage });
    }
    try {
      return await response.json();
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new AppError("invalid-response", {
          stage,
          httpStatus: response.status,
        });
      // Fetch can deliver headers before its body times out or the connection breaks.
      throw this.transportError(error, stage, response.status);
    }
  }

  async getProfile(token: string): Promise<{ id: string; email: string }> {
    const parsed = profileSchema.safeParse(
      await this.request(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        token,
        "account-details",
      ),
    );
    if (!parsed.success)
      throw new AppError("invalid-response", { stage: "account-details" });
    return { id: parsed.data.sub, email: parsed.data.email };
  }

  async listCalendars(token: string): Promise<CalendarSummary[]> {
    const calendars: CalendarSummary[] = [];
    const seenPages = new Set<string>();
    let pageToken: string | undefined;
    do {
      const url = new URL(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      );
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const parsed = pageSchema.safeParse(
        await this.request(url.toString(), token, "calendar-list"),
      );
      if (!parsed.success)
        throw new AppError("invalid-response", { stage: "calendar-list" });
      for (const item of parsed.data.items ?? []) {
        calendars.push({
          id: item.id,
          summary: item.summaryOverride ?? item.summary ?? item.id,
          accessRole: item.accessRole,
          primary: item.primary ?? false,
          ...(item.timeZone ? { timeZone: item.timeZone } : {}),
        });
      }
      pageToken = parsed.data.nextPageToken;
      if (pageToken) {
        if (seenPages.has(pageToken) || seenPages.size >= 100)
          throw new AppError("invalid-response", { stage: "calendar-list" });
        seenPages.add(pageToken);
      }
    } while (pageToken);
    return calendars;
  }
}
