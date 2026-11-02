import { z } from "zod";
import type { EventBody } from "../calendar/write-model";
import { AppError } from "../shared/errors";
import type { CalendarSummary, FailureDetails } from "../shared/model";
import type { GoogleGateway } from "./ports";
import { googleEventSchema, type GoogleEvent } from "../calendar/google-events";

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
        backgroundColor: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .optional(),
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
    init: RequestInit = {},
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...init.headers,
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
      if (response.status === 412 || response.status === 409)
        throw new GoogleHttpError(response.status, "event-conflict", { stage });
      if (stage === "calendar-events" && response.status === 410)
        throw new GoogleHttpError(410, "sync-expired", { stage });
      if (stage === "calendar-events" && response.status === 404)
        throw new GoogleHttpError(404, "calendar-unavailable", { stage });
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
        const seconds = Number(response.headers.get("Retry-After"));
        throw new GoogleHttpError(response.status, "rate-limited", {
          stage,
          ...(Number.isInteger(seconds) && seconds > 0
            ? { retryAfterSeconds: Math.min(seconds, 86400) }
            : {}),
        });
      }
      if (reason === "accessNotConfigured" || reason === "serviceDisabled") {
        throw new GoogleHttpError(response.status, "api-disabled", { stage });
      }
      if (response.status === 403)
        throw new GoogleHttpError(
          403,
          stage === "calendar-events" && reason !== "insufficientPermissions"
            ? "calendar-unavailable"
            : "permission-required",
          { stage },
        );
      throw new GoogleHttpError(response.status, "api-error", { stage });
    }
    if (response.status === 204) return undefined;
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
          ...(item.backgroundColor
            ? { backgroundColor: item.backgroundColor }
            : {}),
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

  private async eventPages(
    token: string,
    calendarId: string,
    parameters: Record<string, string>,
    consume: (value: unknown) => void,
  ): Promise<unknown> {
    let pageToken: string | undefined;
    const seen = new Set<string>();
    let last: unknown;
    do {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      );
      for (const [key, value] of Object.entries(parameters))
        url.searchParams.set(key, value);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      last = await this.request(url.toString(), token, "calendar-events");
      consume(last);
      const parsed = z
        .object({ nextPageToken: z.string().min(1).optional() })
        .safeParse(last);
      if (!parsed.success)
        throw new AppError("invalid-response", { stage: "calendar-events" });
      pageToken = parsed.data.nextPageToken;
      if (pageToken) {
        if (seen.has(pageToken) || seen.size >= 100)
          throw new AppError("invalid-response", { stage: "calendar-events" });
        seen.add(pageToken);
      }
    } while (pageToken);
    return last;
  }

  async getChanges(
    token: string,
    calendarId: string,
    syncToken?: string,
  ): Promise<{ syncToken: string; changed: boolean }> {
    let changed = false;
    const last = await this.eventPages(
      token,
      calendarId,
      {
        maxResults: "2500",
        singleEvents: "false",
        showDeleted: "true",
        fields: "items(id),nextPageToken,nextSyncToken",
        ...(syncToken ? { syncToken } : {}),
      },
      (value) => {
        const parsed = z
          .object({
            items: z.array(z.object({ id: z.string().min(1) })).optional(),
          })
          .safeParse(value);
        if (!parsed.success)
          throw new AppError("invalid-response", { stage: "calendar-events" });
        changed ||= Boolean(parsed.data.items?.length);
      },
    );
    const parsed = z
      .object({ nextSyncToken: z.string().min(1) })
      .safeParse(last);
    if (!parsed.success)
      throw new AppError("invalid-response", { stage: "calendar-events" });
    return { syncToken: parsed.data.nextSyncToken, changed };
  }

  async getInstances(
    token: string,
    calendarId: string,
    start: string,
    end: string,
  ): Promise<{ events: GoogleEvent[]; timeZone: string }> {
    const events: GoogleEvent[] = [];
    let timeZone = "UTC";
    await this.eventPages(
      token,
      calendarId,
      {
        maxResults: "2500",
        singleEvents: "true",
        showDeleted: "false",
        timeMin: start,
        timeMax: end,
        fields:
          "nextPageToken,timeZone,items(id,status,summary,description,location,start,end,eventType,etag,updated,recurringEventId,originalStartTime,iCalUID,htmlLink,hangoutLink,organizer,guestsCanModify,locked,attendees(self,responseStatus))",
      },
      (value) => {
        const parsed = z
          .object({
            items: z.array(googleEventSchema).optional(),
            timeZone: z.string().optional(),
          })
          .safeParse(value);
        if (!parsed.success)
          throw new AppError("invalid-response", { stage: "calendar-events" });
        events.push(...(parsed.data.items ?? []));
        timeZone = parsed.data.timeZone ?? timeZone;
      },
    );
    return { events, timeZone };
  }
  private eventUrl(calendarId: string, eventId?: string): string {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`;
  }
  private parseEvent(value: unknown): GoogleEvent {
    const parsed = googleEventSchema.safeParse(value);
    if (!parsed.success)
      throw new AppError("invalid-response", { stage: "calendar-events" });
    return parsed.data;
  }
  async getEvent(
    token: string,
    calendarId: string,
    eventId: string,
  ): Promise<GoogleEvent> {
    return this.parseEvent(
      await this.request(
        this.eventUrl(calendarId, eventId),
        token,
        "calendar-events",
      ),
    );
  }
  async insertEvent(
    token: string,
    calendarId: string,
    body: EventBody,
    sendUpdates: "all" | "none",
  ): Promise<GoogleEvent> {
    const url = new URL(this.eventUrl(calendarId));
    url.searchParams.set("sendUpdates", sendUpdates);
    return this.parseEvent(
      await this.requestOnce(url.href, token, "calendar-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  async patchEvent(
    token: string,
    calendarId: string,
    eventId: string,
    body: EventBody,
    etag: string,
    sendUpdates: "all" | "none",
  ): Promise<GoogleEvent> {
    const url = new URL(this.eventUrl(calendarId, eventId));
    url.searchParams.set("sendUpdates", sendUpdates);
    return this.parseEvent(
      await this.requestOnce(url.href, token, "calendar-events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": etag },
        body: JSON.stringify(body),
      }),
    );
  }
  async deleteEvent(
    token: string,
    calendarId: string,
    eventId: string,
    etag: string,
    sendUpdates: "all" | "none",
  ): Promise<void> {
    const url = new URL(this.eventUrl(calendarId, eventId));
    url.searchParams.set("sendUpdates", sendUpdates);
    await this.requestOnce(url.href, token, "calendar-events", {
      method: "DELETE",
      headers: { "If-Match": etag },
    });
  }
}
