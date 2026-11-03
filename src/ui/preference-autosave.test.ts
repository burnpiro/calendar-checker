import { describe, expect, it, vi } from "vitest";
import { emptyStore } from "../shared/model";
import type { Settings, SettingsPatch } from "../shared/preferences";
import { numericPreference, PreferenceAutosave } from "./preference-autosave";

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const defaults = () => structuredClone(emptyStore().settings);

describe("automatic preference persistence", () => {
  it("revalidates a pending edit when another window changes a related constraint", async () => {
    let settings = defaults();
    const persist = vi.fn(
      async (patch: SettingsPatch) => (settings = { ...settings, ...patch }),
    );
    const engine = new PreferenceAutosave(
      settings,
      (s) => ({ start: s.weekStartHour, end: s.weekEndHour }),
      (d) => ({ weekStartHour: d.start, weekEndHour: d.end }),
      persist,
    );
    engine.edit((d) => ({ ...d, start: 23 }));
    expect(engine.getSnapshot().status).toBe("invalid");
    settings = { ...settings, weekEndHour: 24 };
    engine.sync(settings);
    await tick();
    expect(persist).toHaveBeenCalledWith({ weekStartHour: 23 });
    expect(engine.getSnapshot().status).toBe("saved");
  });
  it("does not save initial values, incomplete numbers, invalid zones or contradictory hour ranges", async () => {
    const settings = defaults();
    const persist = vi.fn(async (patch: SettingsPatch) => ({
      ...settings,
      ...patch,
    }));
    const make = (s: Settings) => ({
      start: s.weekStartHour as number | string,
      end: s.weekEndHour as number | string,
      zone: s.primaryTimeZone,
    });
    const engine = new PreferenceAutosave(
      settings,
      make,
      (d) => ({
        weekStartHour: numericPreference(d.start),
        weekEndHour: numericPreference(d.end),
        primaryTimeZone: d.zone,
      }),
      persist,
    );
    expect(persist).not.toHaveBeenCalled();
    for (const draft of [
      { start: "", end: 22, zone: "UTC" },
      { start: 23, end: 22, zone: "UTC" },
      { start: 7, end: 22, zone: "Europe/" },
    ]) {
      engine.edit(draft);
      await tick();
      expect(engine.getSnapshot().status).toBe("invalid");
    }
    expect(persist).not.toHaveBeenCalled();
    engine.edit({ start: 23, end: 24, zone: "Europe/Warsaw" });
    await tick();
    expect(persist).toHaveBeenCalledWith({
      weekStartHour: 23,
      weekEndHour: 24,
      primaryTimeZone: "Europe/Warsaw",
    });
    expect(engine.getSnapshot().status).toBe("saved");
  });
  it("serializes saves and preserves edits made while an earlier response is pending", async () => {
    const settings = defaults();
    const pending: Array<(s: Settings) => void> = [];
    const persist = vi.fn(
      (_patch: SettingsPatch) =>
        new Promise<Settings>((resolve) => pending.push(resolve)),
    );
    const engine = new PreferenceAutosave(
      settings,
      (s) => ({ theme: s.theme, density: s.density }),
      (d) => d,
      persist,
    );
    engine.edit((d) => ({ ...d, theme: "dark" }));
    engine.edit((d) => ({ ...d, density: "compact" }));
    expect(persist).toHaveBeenCalledTimes(1);
    pending.shift()!({ ...settings, theme: "dark" });
    await tick();
    expect(persist.mock.calls[1]![0]).toEqual({ density: "compact" });
    expect(engine.getSnapshot().draft).toEqual({
      theme: "dark",
      density: "compact",
    });
    pending.shift()!({ ...settings, theme: "dark", density: "compact" });
    await tick();
    expect(engine.getSnapshot().status).toBe("saved");
  });
  it("preserves invalid drafts across external updates and never overwrites unrelated preferences", async () => {
    let settings = defaults();
    const persist = vi.fn(
      async (patch: SettingsPatch) => (settings = { ...settings, ...patch }),
    );
    const engine = new PreferenceAutosave(
      settings,
      (s) => ({ zone: s.primaryTimeZone, theme: s.theme }),
      (d) => ({ primaryTimeZone: d.zone, theme: d.theme }),
      persist,
    );
    engine.edit((d) => ({ ...d, zone: "Europe/" }));
    settings = { ...settings, theme: "dark", syncIntervalMinutes: 13 };
    engine.sync(settings);
    expect(engine.getSnapshot().draft).toEqual({
      zone: "Europe/",
      theme: "dark",
    });
    engine.edit((d) => ({ ...d, zone: "Europe/Warsaw" }));
    await tick();
    expect(persist).toHaveBeenCalledWith({ primaryTimeZone: "Europe/Warsaw" });
    expect(settings.syncIntervalMinutes).toBe(13);
    expect(settings.theme).toBe("dark");
  });
  it("preserves newer nested reminder settings and does not save invalid snooze values", async () => {
    let settings = defaults();
    const persist = vi.fn(
      async (patch: SettingsPatch) => (settings = { ...settings, ...patch }),
    );
    const engine = new PreferenceAutosave(
      settings,
      (s) => ({ ...s.reminders }),
      (d) => ({ reminders: d }),
      persist,
    );
    engine.edit((d) => ({ ...d, snoozePresets: [] }));
    settings = {
      ...settings,
      reminders: { ...settings.reminders, volume: 0.9 },
    };
    engine.sync(settings);
    engine.edit((d) => ({ ...d, snoozePresets: [7, 15] }));
    await tick();
    expect(settings.reminders.volume).toBe(0.9);
    expect(settings.reminders.snoozePresets).toEqual([7, 15]);
    expect(persist).toHaveBeenCalledTimes(1);
  });
  it("retains failed changes and supports explicit retry without claiming success", async () => {
    const settings = defaults();
    const persist = vi
      .fn()
      .mockRejectedValueOnce(new Error("Storage unavailable"))
      .mockResolvedValueOnce({ ...settings, theme: "dark" });
    const engine = new PreferenceAutosave(
      settings,
      (s) => ({ theme: s.theme }),
      (d) => d,
      persist,
    );
    engine.edit({ theme: "dark" });
    await tick();
    expect(engine.getSnapshot()).toMatchObject({
      status: "error",
      message: "Storage unavailable",
      draft: { theme: "dark" },
    });
    engine.retry();
    await tick();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(engine.getSnapshot().status).toBe("saved");
  });
});
