import { z } from "zod";
import { getCalendarDatabase } from "../../src/calendar/database";
const requestSchema = z.discriminatedUnion("action", [
  z.object({ target: z.literal("calendar-audio"), action: z.literal("stop") }),
  z.object({
    target: z.literal("calendar-audio"),
    action: z.literal("status"),
  }),
  z.object({
    target: z.literal("calendar-audio"),
    action: z.literal("play"),
    id: z.union([z.literal("builtin"), z.uuid()]),
    volume: z.number().min(0).max(1),
    preview: z.boolean().default(false),
  }),
  z.object({
    target: z.literal("calendar-audio"),
    action: z.literal("validate"),
    id: z.uuid(),
  }),
]);
let playing: HTMLAudioElement | undefined;
let cleanup: (() => void) | undefined;
let previewing = false;
const idle = () => {
  void chrome.runtime
    .sendMessage({ namespace: "calendar-audio-idle" })
    .catch(() => undefined);
};
async function operate(request: z.infer<typeof requestSchema>) {
  if (request.action === "status") return { playing: Boolean(playing) };
  if (request.action === "stop") {
    if (!previewing) cleanup?.();
    return {};
  }
  const sound =
    request.id === "builtin"
      ? undefined
      : await getCalendarDatabase().sounds.get(request.id);
  if (request.id !== "builtin" && !sound) throw new Error();
  const url = sound
    ? URL.createObjectURL(sound.blob)
    : chrome.runtime.getURL("/sounds/chime.wav");
  const revoke = () => {
    if (sound) URL.revokeObjectURL(url);
  };
  const audio = new Audio(url);
  if (request.action === "validate") {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          audio.src = "";
          reject(new Error());
        }, 8000);
        audio.onloadedmetadata = () => {
          clearTimeout(timeout);
          resolve();
        };
        audio.onerror = () => {
          clearTimeout(timeout);
          reject(new Error());
        };
        audio.preload = "metadata";
        audio.load();
      });
      if (
        !Number.isFinite(audio.duration) ||
        audio.duration <= 0 ||
        audio.duration > 60
      )
        throw new Error();
      return { duration: audio.duration };
    } finally {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      revoke();
      idle();
    }
  }
  cleanup?.();
  let stopped = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    revoke();
    if (playing === audio) {
      playing = undefined;
      previewing = false;
      cleanup = undefined;
    }
    idle();
  };
  playing = audio;
  previewing = request.preview;
  cleanup = stop;
  audio.volume = request.volume;
  timeout = setTimeout(stop, 61_000);
  audio.onended = stop;
  audio.onerror = stop;
  try {
    await audio.play();
  } catch {
    stop();
    throw new Error();
  }

  return {};
}
chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("background.js")
  )
    return false;
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return false;
  void operate(parsed.data).then(
    (result) => sendResponse({ ok: true, ...result }),
    () => sendResponse({ ok: false }),
  );
  return true;
});
