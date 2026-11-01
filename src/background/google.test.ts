import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarGateway } from "./google";

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

const immediateRetry = {
  waitBeforeRetry: async () => undefined,
  isOnline: () => true,
};

describe("Google Calendar adapter", () => {
  it("calls native fetch with the global browser receiver instead of the gateway as this", async () => {
    const nativeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(
        response({
          sub: "account",
          email: "user@example.com",
          email_verified: true,
        }),
      );
    });
    vi.stubGlobal("fetch", nativeFetch);
    try {
      await expect(
        new GoogleCalendarGateway(undefined, immediateRetry).getProfile(
          "secret",
        ),
      ).resolves.toEqual({ id: "account", email: "user@example.com" });
      expect(nativeFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not misreport a browser invocation bug as a network outage or retry it", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new TypeError(
          "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
        ),
      );
    await expect(
      new GoogleCalendarGateway(fetcher, immediateRetry).getProfile("secret"),
    ).rejects.toMatchObject({
      code: "unexpected",
      details: { stage: "account-details" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

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
      new GoogleCalendarGateway(fetcher, immediateRetry).getProfile(
        "secret-token",
      ),
    ).rejects.toMatchObject({ code: "network" });
    try {
      await new GoogleCalendarGateway(fetcher, immediateRetry).getProfile(
        "secret-token",
      );
    } catch (error) {
      expect(String(error)).not.toContain("secret-token");
    }
  });

  it("recovers from one temporary GET failure without asking for another token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        response({
          sub: "account",
          email: "user@example.com",
          email_verified: true,
        }),
      );
    await expect(
      new GoogleCalendarGateway(fetcher, immediateRetry).getProfile("secret"),
    ).resolves.toEqual({ id: "account", email: "user@example.com" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, options] of fetcher.mock.calls)
      expect(options?.headers).toMatchObject({
        Authorization: "Bearer secret",
      });
  });

  it("bounds repeated transport failures to two attempts and identifies the failed step", async () => {
    const waitBeforeRetry = vi.fn(async () => undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch: private-token"));
    await expect(
      new GoogleCalendarGateway(fetcher, {
        ...immediateRetry,
        waitBeforeRetry,
      }).getProfile("private-token"),
    ).rejects.toMatchObject({
      code: "network",
      details: { stage: "account-details", networkFailure: "request-failed" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(waitBeforeRetry).toHaveBeenCalledTimes(1);
  });

  it("reports timeouts on calendar requests separately from offline use", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new DOMException("Sensitive transport error", "TimeoutError"),
      );
    await expect(
      new GoogleCalendarGateway(fetcher, immediateRetry).listCalendars(
        "private-token",
      ),
    ).rejects.toMatchObject({
      code: "network",
      details: { stage: "calendar-list", networkFailure: "timeout" },
      message: expect.stringContaining("timed out"),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not delay an offline failure with a pointless retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const waitBeforeRetry = vi.fn(async () => undefined);
    await expect(
      new GoogleCalendarGateway(fetcher, {
        isOnline: () => false,
        waitBeforeRetry,
      }).getProfile("secret"),
    ).rejects.toMatchObject({
      details: { stage: "account-details", networkFailure: "offline" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(waitBeforeRetry).not.toHaveBeenCalled();
  });

  it("keeps HTTP permission failures out of the transport retry path", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({}, 403));
    await expect(
      new GoogleCalendarGateway(fetcher, immediateRetry).listCalendars(
        "secret",
      ),
    ).rejects.toMatchObject({
      code: "permission-required",
      details: { stage: "calendar-list", httpStatus: 403 },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry malformed JSON as a network outage", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{malformed", { status: 200 }));
    await expect(
      new GoogleCalendarGateway(fetcher, immediateRetry).getProfile("secret"),
    ).rejects.toMatchObject({
      code: "invalid-response",
      details: { stage: "account-details", httpStatus: 200 },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("recovers when response headers arrive but the body times out", async () => {
    const broken = response({});
    vi.spyOn(broken, "json").mockRejectedValue(
      new DOMException("Body timed out", "TimeoutError"),
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(
        response({
          sub: "account",
          email: "user@example.com",
          email_verified: true,
        }),
      );
    await expect(
      new GoogleCalendarGateway(fetcher, immediateRetry).getProfile("secret"),
    ).resolves.toMatchObject({ id: "account" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retains HTTP status when an interrupted response body exhausts its retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      const broken = response({});
      vi.spyOn(broken, "json").mockRejectedValue(
        new DOMException("Body timed out", "TimeoutError"),
      );
      return broken;
    });
    await expect(
      new GoogleCalendarGateway(fetcher, immediateRetry).getProfile("secret"),
    ).rejects.toMatchObject({
      code: "network",
      details: {
        stage: "account-details",
        httpStatus: 200,
        networkFailure: "timeout",
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a failed calendar page without duplicating earlier results", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          items: [{ id: "a", summary: "A", accessRole: "owner" }],
          nextPageToken: "next",
        }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        response({ items: [{ id: "b", summary: "B", accessRole: "reader" }] }),
      );
    const calendars = await new GoogleCalendarGateway(
      fetcher,
      immediateRetry,
    ).listCalendars("secret");
    expect(calendars.map((calendar) => calendar.id)).toEqual(["a", "b"]);
    expect(fetcher.mock.calls[1]?.[0]).toBe(fetcher.mock.calls[2]?.[0]);
  });
});
