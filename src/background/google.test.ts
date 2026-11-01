import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarGateway } from "./google";

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

describe("Google Calendar adapter", () => {
  it("uses direct Google requests with bounded duration and verified profile identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        sub: "account",
        email: "user@example.com",
        email_verified: true,
      }),
    );
    const client = new GoogleCalendarGateway(fetcher);
    await expect(client.getProfile("secret")).resolves.toEqual({
      id: "account",
      email: "user@example.com",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
        headers: { Authorization: "Bearer secret", Accept: "application/json" },
      }),
    );
  });

  it("does not accept an unverified email as an account identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        sub: "account",
        email: "user@example.com",
        email_verified: false,
      }),
    );
    await expect(
      new GoogleCalendarGateway(fetcher).getProfile("secret"),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("loads every calendar-list page, retaining account permissions and time zones", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          items: [
            {
              id: "a",
              summary: "Work",
              accessRole: "owner",
              timeZone: "Europe/Warsaw",
              primary: true,
            },
          ],
          nextPageToken: "next",
        }),
      )
      .mockResolvedValueOnce(
        response({
          items: [
            {
              id: "b",
              summary: "Original",
              summaryOverride: "Family",
              accessRole: "reader",
            },
          ],
        }),
      );
    const calendars = await new GoogleCalendarGateway(fetcher).listCalendars(
      "secret",
    );
    expect(calendars).toHaveLength(2);
    expect(calendars[0]).toMatchObject({
      primary: true,
      timeZone: "Europe/Warsaw",
      accessRole: "owner",
    });
    expect(calendars[1]?.summary).toBe("Family");
    expect(fetcher.mock.calls[1]?.[0]).toContain("pageToken=next");
  });

  it("rejects looping pagination instead of hanging", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ nextPageToken: "same" }));
    await expect(
      new GoogleCalendarGateway(fetcher).listCalendars("secret"),
    ).rejects.toMatchObject({ code: "invalid-response" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, {}, "reconnect-required"],
    [
      403,
      { error: { errors: [{ reason: "rateLimitExceeded" }] } },
      "rate-limited",
    ],
    [
      403,
      { error: { errors: [{ reason: "accessNotConfigured" }] } },
      "api-disabled",
    ],
    [403, {}, "permission-required"],
    [429, {}, "rate-limited"],
    [500, {}, "api-error"],
  ])("maps HTTP %s to a safe application error", async (status, body, code) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(body, status));
    await expect(
      new GoogleCalendarGateway(fetcher).listCalendars("secret"),
    ).rejects.toMatchObject({ code });
  });

  it("does not expose raw network errors that could include tokens", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Network request failed: secret-token"));
    await expect(
      new GoogleCalendarGateway(fetcher).getProfile("secret-token"),
    ).rejects.toMatchObject({ code: "network" });
    try {
      await new GoogleCalendarGateway(fetcher).getProfile("secret-token");
    } catch (error) {
      expect(String(error)).not.toContain("secret-token");
    }
  });
});
