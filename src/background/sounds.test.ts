import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { CalendarDatabase } from "../calendar/database";
import { emptyStore } from "../shared/model";
import { SoundLibrary } from "./sounds";
const databases: CalendarDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
function harness() {
  const db = new CalendarDatabase(`sound-${crypto.randomUUID()}`);
  databases.push(db);
  const validate = vi.fn(async (_id: string) => 1);
  return { db, validate, sounds: new SoundLibrary(db, validate) };
}
const wav = async () =>
  (await readFile("public/sounds/chime.wav")).toString("base64");
describe("local sound library", () => {
  it("stores local blobs and metadata durably without persisting the upload encoding", async () => {
    const h = harness();
    await h.sounds.import("Chime", "audio/wav", await wav());
    h.db.close();
    await h.db.open();
    const [sound] = await h.db.sounds.toArray();
    expect(sound).toMatchObject({
      name: "Chime",
      mime: "audio/wav",
      duration: 1,
    });
    expect(sound!.blob).toBeInstanceOf(Blob);
    expect(sound!.blob.size).toBe(sound!.bytes);
    expect(Object.keys(sound!)).not.toContain("data");
  });
  it("rejects mismatched file content and invalid base64 before decoding audio", async () => {
    const h = harness();
    await expect(
      h.sounds.import("Bad", "audio/ogg", await wav()),
    ).rejects.toMatchObject({ code: "sound-invalid" });
    await expect(
      h.sounds.import("Bad", "audio/wav", "not-base64!?"),
    ).rejects.toMatchObject({ code: "sound-invalid" });
    expect(h.validate).not.toHaveBeenCalled();
    expect(await h.db.sounds.count()).toBe(0);
  });
  it.each([0, Infinity, 61])(
    "removes provisional audio rejected by duration validation (%s)",
    async (duration) => {
      const h = harness();
      h.validate.mockResolvedValue(duration);
      await expect(
        h.sounds.import("Bad", "audio/wav", await wav()),
      ).rejects.toMatchObject({ code: "sound-invalid" });
      expect(await h.db.sounds.count()).toBe(0);
    },
  );
  it("removes interrupted provisional imports on startup without touching validated sounds", async () => {
    const h = harness();
    await h.sounds.import("Chime", "audio/wav", await wav());
    const sound = (await h.db.sounds.toArray())[0]!;
    await h.db.sounds.put({ ...sound, id: crypto.randomUUID(), duration: 0 });
    await h.sounds.recover();
    expect(await h.db.sounds.toArray()).toEqual([sound]);
  });
  it("prevents deleting assigned sounds and validates references", async () => {
    const h = harness();
    await h.sounds.import("Chime", "audio/wav", await wav());
    const sound = (await h.db.sounds.toArray())[0]!;
    const settings = emptyStore().settings;
    settings.notificationCalendars.calendar = {
      enabled: true,
      soundId: sound.id,
    };
    await expect(h.sounds.remove(sound.id, settings)).rejects.toMatchObject({
      code: "sound-in-use",
    });
    await h.sounds.validateAssignments(settings);
    settings.notificationCalendars = {};
    await h.sounds.remove(sound.id, settings);
    expect(await h.db.sounds.count()).toBe(0);
    settings.reminders.soundId = sound.id;
    await expect(h.sounds.validateAssignments(settings)).rejects.toMatchObject({
      code: "sound-invalid",
    });
  });
});
