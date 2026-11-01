import { z } from "zod";
import { AppError } from "../shared/errors";
import type { CalendarSummary } from "../shared/model";
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
  ) {
    super(code);
  }
}

export class GoogleCalendarGateway implements GoogleGateway {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request(url: string, token: string): Promise<unknown> {
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
    } catch {
      throw new AppError("network");
    }
    if (!response.ok) {
      if (response.status === 401)
        throw new GoogleHttpError(401, "reconnect-required");
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
        throw new GoogleHttpError(response.status, "rate-limited");
      }
      if (reason === "accessNotConfigured" || reason === "serviceDisabled") {
        throw new GoogleHttpError(response.status, "api-disabled");
      }
      if (response.status === 403)
        throw new GoogleHttpError(403, "permission-required");
      throw new GoogleHttpError(response.status, "api-error");
    }
    try {
      return await response.json();
    } catch {
      throw new AppError("invalid-response");
    }
  }

  async getProfile(token: string): Promise<{ id: string; email: string }> {
    const parsed = profileSchema.safeParse(
      await this.request(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        token,
      ),
    );
    if (!parsed.success) throw new AppError("invalid-response");
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
        await this.request(url.toString(), token),
      );
      if (!parsed.success) throw new AppError("invalid-response");
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
          throw new AppError("invalid-response");
        seenPages.add(pageToken);
      }
    } while (pageToken);
    return calendars;
  }
}
