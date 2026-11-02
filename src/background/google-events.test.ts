import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarGateway } from "./google";
import { normalizeGoogleEvent } from "../calendar/google-events";
const reply = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), { status, headers });
const calendar = {
  id: "calendar",
  summary: "Calendar",
  primary: false,
  accessRole: "reader",
  timeZone: "Europe/Warsaw",
};
const account = { id: "account", email: "user@example.test" };
const at = "2026-11-01T12:00:00.000Z";

describe("Google event transport and normalization", () => {
  it("paginates the independent change feed with a stable cursor and no date filters", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply({ items: [{ id: "cancelled-id" }], nextPageToken: "page+/?" }),
      )
      .mockResolvedValueOnce(
        reply({ items: [], nextSyncToken: "next-cursor" }),
      );
    const gateway = new GoogleCalendarGateway(fetcher);
    await expect(
      gateway.getChanges(
        "private-token",
        "shared/a+b@example.test",
        "previous+/?",
      ),
    ).resolves.toEqual({ syncToken: "next-cursor", changed: true });
    for (const [url] of fetcher.mock.calls) {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toContain("shared%2Fa%2Bb%40example.test");
      expect(parsed.searchParams.get("syncToken")).toBe("previous+/?");
      expect(parsed.searchParams.get("singleEvents")).toBe("false");
      expect(parsed.searchParams.get("showDeleted")).toBe("true");
      for (const incompatible of [
        "timeMin",
        "timeMax",
        "orderBy",
        "q",
        "updatedMin",
      ])
        expect(parsed.searchParams.has(incompatible)).toBe(false);
    }
    expect(
      new URL(String(fetcher.mock.calls[1]![0])).searchParams.get("pageToken"),
    ).toBe("page+/?");
  });
  it("fetches all pages of bounded server-expanded instances without using their sync cursor", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply({
          timeZone: "Europe/Warsaw",
          items: [{ id: "instance-a" }],
          nextPageToken: "next",
        }),
      )
      .mockResolvedValueOnce(
        reply({
          items: [{ id: "instance-b" }],
          nextSyncToken: "ignored-range-cursor",
        }),
      );
    const result = await new GoogleCalendarGateway(fetcher).getInstances(
      "token",
      "calendar",
      "2026-10-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
    );
    expect(result.events.map((e) => e.id)).toEqual([
      "instance-a",
      "instance-b",
    ]);
    expect(result.timeZone).toBe("Europe/Warsaw");
    for (const [url] of fetcher.mock.calls) {
      const query = new URL(String(url)).searchParams;
      expect(query.get("singleEvents")).toBe("true");
      expect(query.get("timeMin")).toBe("2026-10-01T00:00:00Z");
      expect(query.has("syncToken")).toBe(false);
    }
  });
  it("rejects pagination loops and missing final change cursors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => reply({ nextPageToken: "loop" }));
    await expect(
      new GoogleCalendarGateway(fetcher).getChanges("token", "calendar"),
    ).rejects.toMatchObject({ code: "invalid-response" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(
      new GoogleCalendarGateway(
        vi.fn<typeof fetch>().mockResolvedValue(reply({ items: [] })),
      ).getChanges("token", "calendar"),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
  it("rejects a malformed later instance page instead of returning a partial range", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        reply({ items: [{ id: "first" }], nextPageToken: "next" }),
      )
      .mockResolvedValueOnce(reply({ items: [{ missingId: true }] }));
    await expect(
      new GoogleCalendarGateway(fetcher).getInstances(
        "token",
        "calendar",
        "2026-10-01T00:00:00Z",
        "2026-12-01T00:00:00Z",
      ),
    ).rejects.toMatchObject({
      code: "invalid-response",
      details: { stage: "calendar-events" },
    });
  });
  it.each([
    [410, "", "sync-expired"],
    [404, "", "calendar-unavailable"],
    [403, "forbidden", "calendar-unavailable"],
    [403, "insufficientPermissions", "permission-required"],
  ])(
    "classifies event HTTP %s %s without leaking server messages",
    async (status, reason, code) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        reply(
          {
            error: {
              message: "private server content",
              errors: [{ reason }],
            },
          },
          status as number,
        ),
      );
      await expect(
        new GoogleCalendarGateway(fetcher).getChanges("token", "calendar"),
      ).rejects.toMatchObject({
        code,
        details: { httpStatus: status, stage: "calendar-events" },
      });
    },
  );
  it("preserves Retry-After for durable rate-limit backoff", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(reply({}, 429, { "Retry-After": "900" }));
    await expect(
      new GoogleCalendarGateway(fetcher).getChanges("token", "calendar"),
    ).rejects.toMatchObject({
      code: "rate-limited",
      details: { retryAfterSeconds: 900 },
    });
  });
  it("keeps all-day dates and recurring exception provenance without trusting executable links", () => {
    const event = normalizeGoogleEvent(
      {
        id: "birthday",
        start: { date: "2026-11-05" },
        end: { date: "2026-11-06" },
        eventType: "birthday",
        recurringEventId: "series",
        originalStartTime: { date: "2026-11-04" },
        htmlLink: "javascript:alert(1)",
        hangoutLink: "https://meet.google.com/fixture",
        description: "<script>untrusted</script>",
      },
      account,
      calendar,
      "UTC",
      at,
    )!;
    expect(event).toMatchObject({
      allDay: true,
      start: "2026-11-05",
      end: "2026-11-06",
      originalStart: "2026-11-04",
      title: "Busy",
      meetingLink: "https://meet.google.com/fixture",
      description: "<script>untrusted</script>",
    });
    expect(event.htmlLink).toBeUndefined();
    expect(
      normalizeGoogleEvent(
        { id: "cancelled", status: "cancelled" },
        account,
        calendar,
        "UTC",
        at,
      ),
    ).toBeNull();
  });
  it("converts named-zone wall times across DST and rejects incomplete events", () => {
    const event = normalizeGoogleEvent(
      {
        id: "timed",
        start: { dateTime: "2026-03-30T09:00:00", timeZone: "Europe/Warsaw" },
        end: { dateTime: "2026-03-30T10:00:00" },
      },
      account,
      calendar,
      "UTC",
      at,
    )!;
    expect(event.start).toBe("2026-03-30T07:00:00Z");
    expect(() =>
      normalizeGoogleEvent({ id: "incomplete" }, account, calendar, "UTC", at),
    ).toThrowError();
  });
});

describe("Google event write HTTP protocol", () => {
  it("sends bounded conditional PATCHes with an explicit guest policy and no transport retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(reply({ id: "event" }));
    const gateway = new GoogleCalendarGateway(fetcher);
    await gateway.patchEvent(
      "private-token",
      "a/b@example.test",
      "instance/a",
      { summary: "Edited" },
      '"etag-1"',
      "none",
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain(
      "a%2Fb%40example.test/events/instance%2Fa?sendUpdates=none",
    );
    expect(init).toMatchObject({
      method: "PATCH",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: {
        "If-Match": '"etag-1"',
        Authorization: "Bearer private-token",
        "Content-Type": "application/json",
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({ summary: "Edited" });
    fetcher.mockReset().mockRejectedValue(new TypeError("Connection lost"));
    await expect(
      gateway.insertEvent("token", "calendar", { id: "stable-id" }, "all"),
    ).rejects.toMatchObject({ code: "network" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([409, 412])(
    "classifies %s as a conflict without retrying or exposing Google's body",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          reply({ error: { message: "private-event-data" } }, status),
        );
      await expect(
        new GoogleCalendarGateway(fetcher).patchEvent(
          "token",
          "calendar",
          "event",
          {},
          "etag",
          "all",
        ),
      ).rejects.toMatchObject({ code: "event-conflict", status });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("handles DELETE's empty response without parsing JSON", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      new GoogleCalendarGateway(fetcher).deleteEvent(
        "token",
        "calendar",
        "event",
        '"etag"',
        "all",
      ),
    ).resolves.toBeUndefined();
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "DELETE",
      headers: { "If-Match": '"etag"' },
    });
  });
});
