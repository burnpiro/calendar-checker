import type { CalendarDatabase } from "../calendar/database";
import type { Settings } from "../shared/model";
import { AppError } from "../shared/errors";

export class SoundLibrary {
  constructor(
    private readonly db: CalendarDatabase,
    private readonly validate: (id: string) => Promise<number>,
  ) {}
  async recover() {
    await this.db.sounds
      .filter(
        (sound) => !Number.isFinite(sound.duration) || sound.duration <= 0,
      )
      .delete();
  }
  async import(name: string, mime: string, data: string): Promise<void> {
    let bytes: Uint8Array;
    try {
      const decoded = atob(data);
      bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    } catch {
      throw new AppError("sound-invalid");
    }
    const text = (a: number, b: number) =>
      String.fromCharCode(...bytes.slice(a, b));
    const valid =
      mime === "audio/wav"
        ? text(0, 4) === "RIFF" && text(8, 12) === "WAVE"
        : mime === "audio/mpeg"
          ? text(0, 3) === "ID3" ||
            (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224)
          : mime === "audio/ogg"
            ? text(0, 4) === "OggS"
            : mime === "audio/mp4"
              ? text(4, 8) === "ftyp"
              : mime === "audio/webm"
                ? text(0, 4) === "\x1a\x45\xdf\xa3"
                : false;
    if (
      !valid ||
      bytes.length > 5 * 1024 * 1024 ||
      bytes.length < 12 ||
      (await this.db.sounds.count()) >= 10
    )
      throw new AppError("sound-invalid");
    const id = crypto.randomUUID();
    await this.db.sounds.put({
      id,
      name,
      mime,
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
      bytes: bytes.length,
      duration: 0,
      createdAt: new Date().toISOString(),
    });
    try {
      const duration = await this.validate(id);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 60)
        throw new AppError("sound-invalid");
      await this.db.sounds.update(id, { duration });
    } catch {
      await this.db.sounds.delete(id);
      throw new AppError("sound-invalid");
    }
  }
  async validateAssignments(settings: Settings) {
    const ids = [
      settings.reminders.soundId,
      ...Object.values(settings.notificationCalendars).map((r) => r.soundId),
    ].filter((id): id is string => Boolean(id && id !== "builtin"));
    for (const id of ids)
      if (!(await this.db.sounds.get(id))?.duration)
        throw new AppError("sound-invalid");
  }
  async remove(id: string, settings: Settings) {
    if (
      settings.reminders.soundId === id ||
      Object.values(settings.notificationCalendars).some(
        (r) => r.soundId === id,
      )
    )
      throw new AppError("sound-in-use");
    await this.db.sounds.delete(id);
  }
}
