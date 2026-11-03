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

describe("Google free/busy protocol", () => {
  it("queries one calendar with bounded times, validates offsets and clips returned intervals", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      reply({
        calendars: {
          calendar: {
            busy: [
              {
                start: "2026-11-02T10:00:00+01:00",
                end: "2026-11-02T12:00:00+01:00",
              },
            ],
          },
        },
      }),
    );
    const busy = await new GoogleCalendarGateway(fetcher).getBusy(
      "private-token",
      "calendar",
      "2026-11-02T09:30:00Z",
      "2026-11-02T11:30:00Z",
    );
    expect(busy).toEqual([
      { start: "2026-11-02T09:30:00.000Z", end: "2026-11-02T11:00:00.000Z" },
    ]);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: "Bearer private-token" },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual({
      timeMin: "2026-11-02T09:30:00Z",
      timeMax: "2026-11-02T11:30:00Z",
      timeZone: "UTC",
      items: [{ id: "calendar" }],
    });
  });
  it.each([
    [
      {
        calendars: { calendar: { errors: [{ reason: "notFound" }], busy: [] } },
      },
      "calendar-unavailable",
    ],
    [
      {
        calendars: {
          calendar: { errors: [{ reason: "internalError" }], busy: [] },
        },
      },
      "api-error",
    ],
    [{ calendars: { other: { busy: [] } } }, "invalid-response"],
    [{ calendars: { calendar: {} } }, "invalid-response"],
    [
      { calendars: { calendar: { busy: [{ start: "invalid", end: at }] } } },
      "invalid-response",
    ],
  ])(
    "does not turn nested errors or malformed responses into fresh empty coverage",
    async (body, code) => {
      const gateway = new GoogleCalendarGateway(
        vi.fn<typeof fetch>().mockResolvedValue(reply(body)),
      );
      await expect(
        gateway.getBusy("token", "calendar", at, "2026-12-01T00:00:00Z"),
      ).rejects.toMatchObject({ code });
    },
  );
});

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

describe("extended event metadata", () => {
  it("retains guest responses, reminder methods, privacy and async conference state", async () => {
    const raw = {
      id: "extended",
      summary: "Extended event",
      start: { dateTime: "2026-11-03T08:00:00Z" },
      end: { dateTime: "2026-11-03T09:00:00Z" },
      colorId: "11",
      transparency: "transparent",
      visibility: "private",
      reminders: {
        useDefault: false,
        overrides: [{ method: "email", minutes: 60 }],
      },
      attendees: [
        {
          email: "guest@example.test",
          responseStatus: "accepted",
          optional: true,
        },
      ],
      conferenceData: { createRequest: { status: { statusCode: "pending" } } },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(reply({ items: [raw], timeZone: "UTC" }));
    const result = await new GoogleCalendarGateway(fetcher).getInstances(
      "token",
      calendar.id,
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
    );
    expect(
      normalizeGoogleEvent(result.events[0]!, account, calendar, "UTC", at),
    ).toMatchObject({
      color: "#d50000",
      colorId: "11",
      visibility: "private",
      transparency: "transparent",
      reminders: raw.reminders,
      attendees: raw.attendees,
      conferenceStatus: "pending",
    });
    const projection = new URL(
      String(fetcher.mock.calls[0]![0]),
    ).searchParams.get("fields")!;
    expect(projection).toContain("conferenceData");
    expect(projection).toContain("reminders");
    expect(projection).toContain("attendees,attendeesOmitted");
  });
  it("sends conferenceDataVersion for explicit Meet creation/removal and preserves conditional writes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => reply({ id: "event" }));
    const gateway = new GoogleCalendarGateway(fetcher);
    await gateway.insertEvent(
      "token",
      "calendar",
      {
        conferenceData: {
          createRequest: {
            requestId: "stable",
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
      "all",
    );
    await gateway.patchEvent(
      "token",
      "calendar",
      "event",
      { conferenceData: null },
      '"etag"',
      "none",
    );
    await gateway.patchEvent(
      "token",
      "calendar",
      "event",
      { summary: "Title only" },
      '"etag"',
      "none",
    );
    expect(
      new URL(String(fetcher.mock.calls[0]![0])).searchParams.get(
        "conferenceDataVersion",
      ),
    ).toBe("1");
    expect(
      new URL(String(fetcher.mock.calls[1]![0])).searchParams.get(
        "conferenceDataVersion",
      ),
    ).toBe("1");
    expect(fetcher.mock.calls[1]![1]?.headers).toMatchObject({
      "If-Match": '"etag"',
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({
      conferenceData: null,
    });
    expect(
      new URL(String(fetcher.mock.calls[2]![0])).searchParams.has(
        "conferenceDataVersion",
      ),
    ).toBe(false);
  });
});

describe("description privacy projections", () => {
  it("excludes descriptions on every list page and on get/insert/patch responses while preserving explicit writes", async () => {
    const event = {
      id: "event",
      description: "Unexpected provider description",
      recurrence: ["RRULE:FREQ=WEEKLY"],
      extendedProperties: { private: { calendarCheckerMutation: "operation" } },
    };
    let lists = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      return reply(
        url.pathname.endsWith("/events") && url.searchParams.has("singleEvents")
          ? {
              items: [event],
              timeZone: "UTC",
              ...(lists++ === 0 ? { nextPageToken: "page2" } : {}),
            }
          : event,
      );
    });
    const gateway = new GoogleCalendarGateway(fetcher);
    const result = await gateway.getInstances(
      "token",
      "calendar",
      at,
      "2026-12-01T00:00:00Z",
      true,
    );
    expect(result.events).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(event.description);
    const got = await gateway.getEvent("token", "calendar", "event", true);
    expect(got).toMatchObject({
      recurrence: event.recurrence,
      extendedProperties: event.extendedProperties,
    });
    const inserted = await gateway.insertEvent(
      "token",
      "calendar",
      { description: "Explicit draft" },
      "none",
      true,
    );
    const patched = await gateway.patchEvent(
      "token",
      "calendar",
      "event",
      { summary: "Rename" },
      '"etag"',
      "none",
      true,
    );
    expect(JSON.stringify([got, inserted, patched])).not.toContain(
      event.description,
    );
    for (const [url] of fetcher.mock.calls) {
      const fields = new URL(String(url)).searchParams.get("fields");
      expect(fields).toBeTruthy();
      expect(fields).not.toContain("description");
      expect(fields).toContain("etag");
    }
    const post = fetcher.mock.calls.find(
      ([, init]) => init?.method === "POST",
    )!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      description: "Explicit draft",
    });
    const patch = fetcher.mock.calls.find(
      ([, init]) => init?.method === "PATCH",
    )!;
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ summary: "Rename" });
  });
});
