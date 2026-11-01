import { describe, expect, it, vi } from "vitest";
import { ensureConnectionAlarm } from "./scheduler";
import { SerialQueue } from "./serial-queue";
import { isTrustedSender, routeCommand } from "./message-router";
import type { AuthService } from "./auth-service";
import { AUTH_ALARM } from "../shared/model";

describe("worker lifecycle and messages", () => {
  it("restores missing alarms and applies changed intervals without postponing existing alarms", async () => {
    const alarms = {
      get: vi
        .fn<() => Promise<{ periodInMinutes?: number } | undefined>>()
        .mockResolvedValue(undefined),
      create: vi.fn(async () => undefined),
    };
    await ensureConnectionAlarm(alarms, 5);
    expect(alarms.create).toHaveBeenCalledWith(AUTH_ALARM, {
      delayInMinutes: 5,
      periodInMinutes: 5,
    });
    alarms.create.mockClear();
    alarms.get.mockResolvedValue({ periodInMinutes: 5 });
    await ensureConnectionAlarm(alarms, 5);
    expect(alarms.create).not.toHaveBeenCalled();
    await ensureConnectionAlarm(alarms, 10);
    expect(alarms.create).toHaveBeenCalledWith(AUTH_ALARM, {
      delayInMinutes: 10,
      periodInMinutes: 10,
    });
  });

  it("serializes state mutations and recovers after one fails", async () => {
    const queue = new SerialQueue();
    const values: string[] = [];
    let finishFirst!: () => void;
    const first = queue.run(async () => {
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      values.push("first");
    });
    const second = queue
      .run(async () => {
        values.push("second");
        throw new Error("failed");
      })
      .catch(() => undefined);
    const third = queue.run(async () => {
      values.push("third");
    });
    await Promise.resolve();
    expect(values).toEqual([]);
    finishFirst();
    await Promise.all([first, second, third]);
    expect(values).toEqual(["first", "second", "third"]);
  });

  it("accepts only this extension's own pages", () => {
    expect(
      isTrustedSender(
        { id: "our-id", url: "chrome-extension://our-id/options.html" },
        "our-id",
      ),
    ).toBe(true);
    expect(
      isTrustedSender(
        { id: "our-id", url: "https://mail.google.com/" },
        "our-id",
      ),
    ).toBe(false);
    expect(
      isTrustedSender(
        { id: "other-id", url: "chrome-extension://our-id/options.html" },
        "our-id",
      ),
    ).toBe(false);
    expect(isTrustedSender({ id: "our-id" }, "our-id")).toBe(false);
  });

  it("rejects invalid settings messages before calling domain services", async () => {
    const updateSettings = vi.fn();
    const service = { updateSettings } as unknown as AuthService;
    const reschedule = vi.fn();
    const reply = await routeCommand(
      {
        type: "UPDATE_SETTINGS",
        settings: { connectionCheckMinutes: -5, staleAfterMinutes: 15 },
      },
      service,
      reschedule,
    );
    expect(reply).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
    expect(updateSettings).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });
});
