import { describe, expect, it } from "vitest";
import { secondarySlotLabel } from "./dual-time";
describe("dual-zone week labels", () => {
  it("aligns UTC slots with fractional-offset zones and date rollover", () => {
    expect(
      secondarySlotLabel(
        new Date("2026-11-02T11:00:00Z"),
        "2026-11-02",
        "UTC",
        "Asia/Kolkata",
        "24h",
      ),
    ).toBe("16:30");
    expect(
      secondarySlotLabel(
        new Date("2026-11-02T23:00:00Z"),
        "2026-11-02",
        "UTC",
        "Asia/Tokyo",
        "24h",
      ),
    ).toBe("08:00 +1d");
    expect(
      secondarySlotLabel(
        new Date("2026-11-02T00:00:00Z"),
        "2026-11-02",
        "UTC",
        "America/New_York",
        "24h",
      ),
    ).toBe("19:00 -1d");
  });
  it("shows both values when only one zone changes DST during the week", () => {
    expect(
      secondarySlotLabel(
        new Date("2026-10-19T10:00:00Z"),
        "2026-10-19",
        "UTC",
        "Europe/Warsaw",
        "24h",
      ),
    ).toBe("12:00 / 11:00");
    expect(
      secondarySlotLabel(
        new Date("2026-10-19T10:00:00Z"),
        "2026-10-19",
        "UTC",
        "Europe/Warsaw",
        "24h",
        false,
      ),
    ).toBe("12:00");
  });
  it("accounts for both instances of a primary-zone repeated hour and skips nonexistent hours", () => {
    expect(
      secondarySlotLabel(
        new Date("2026-10-19T00:30:00Z"),
        "2026-10-19",
        "Europe/Warsaw",
        "UTC",
        "24h",
      ),
    ).toBe("00:30 / 01:30");
    expect(
      secondarySlotLabel(
        new Date("2026-03-23T01:30:00Z"),
        "2026-03-23",
        "Europe/Warsaw",
        "UTC",
        "24h",
      ),
    ).toBe("01:30");
  });
});
