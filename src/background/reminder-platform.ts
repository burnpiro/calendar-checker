import { SerialQueue } from "./serial-queue";
import { AppError } from "../shared/errors";
import type { Snapshot } from "../shared/model";
import { eventWhen } from "../calendar/presentation";
import { displayTimeZone } from "../shared/preferences";
import { REMINDER_ALARM, type ReminderJob } from "../reminders/model";
import type { ReminderDelivery } from "../reminders/service";
export class ReminderPlatform implements ReminderDelivery {
  private creating?: Promise<void>;
  private readonly audioQueue = new SerialQueue();
  constructor() {
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (
        message?.namespace !== "calendar-audio-idle" ||
        sender.id !== chrome.runtime.id ||
        sender.url !== chrome.runtime.getURL("/offscreen.html")
      )
        return false;
      void this.audioQueue
        .run(async () => {
          const contexts = await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          });
          if (!contexts.length) return;
          const state = await chrome.runtime.sendMessage({
            target: "calendar-audio",
            action: "status",
          });
          if (state?.ok && !state.playing)
            await chrome.offscreen.closeDocument();
        })
        .catch(() => undefined);
      return false;
    });
  }
  private async ensureAudio() {
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL("/offscreen.html")],
    });
    if (existing.length) return;
    if (!this.creating)
      this.creating = chrome.offscreen
        .createDocument({
          url: "offscreen.html",
          reasons: [
            chrome.offscreen.Reason.AUDIO_PLAYBACK,
            chrome.offscreen.Reason.BLOBS,
          ],
          justification:
            "Play calendar reminder sounds from bundled or locally imported audio.",
        })
        .finally(() => {
          this.creating = undefined;
        });
    await this.creating;
  }
  sound(id: string, volume: number): Promise<void> {
    return this.audioQueue.run(() => this.playSound(id, volume));
  }
  preview(id: string, volume: number): Promise<void> {
    return this.audioQueue.run(() => this.playSound(id, volume, true));
  }
  private async playSound(
    id: string,
    volume: number,
    preview = false,
  ): Promise<void> {
    await this.ensureAudio();
    const result = await chrome.runtime.sendMessage({
      target: "calendar-audio",
      action: "play",
      id,
      volume,
      preview,
    });
    if (!result?.ok) throw new AppError("sound-invalid");
  }
  validate(id: string): Promise<number> {
    return this.audioQueue.run(() => this.validateSound(id));
  }
  private async validateSound(id: string): Promise<number> {
    await this.ensureAudio();
    const result = await chrome.runtime.sendMessage({
      target: "calendar-audio",
      action: "validate",
      id,
    });
    if (!result?.ok || typeof result.duration !== "number")
      throw new AppError("sound-invalid");
    return result.duration;
  }
  stop(): Promise<void> {
    return this.audioQueue.run(async () => {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      });
      if (contexts.length)
        await chrome.runtime.sendMessage({
          target: "calendar-audio",
          action: "stop",
        });
    });
  }
  async desktop(job: ReminderJob, snapshot: Snapshot): Promise<void> {
    if ((await chrome.notifications.getPermissionLevel()) !== "granted")
      throw new AppError("notification-denied");
    const privacy = snapshot.settings.reminders.privacy;
    await chrome.notifications.create(`calendar-reminder:${job.id}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("/icon/128.png"),
      silent: true,
      title:
        privacy === "private"
          ? "Calendar reminder"
          : job.event.title.slice(0, 200),
      message:
        privacy === "private"
          ? "An event is coming up. Open Calendar Checker for details."
          : eventWhen(
              job.event,
              displayTimeZone(snapshot.settings.primaryTimeZone),
              snapshot.settings.timeFormat,
            ),
      ...(privacy === "details"
        ? {
            contextMessage: [job.event.calendarName, job.event.location]
              .filter(Boolean)
              .join(" · ")
              .slice(0, 200),
          }
        : {}),
      buttons: [
        { title: `Snooze ${snapshot.settings.reminders.snoozePresets[0]} min` },
        { title: "Dismiss" },
      ],
      requireInteraction: true,
    });
  }
  async testNotification() {
    if ((await chrome.notifications.getPermissionLevel()) !== "granted")
      throw new AppError("notification-denied");
    await chrome.notifications.create("calendar-reminder-test", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("/icon/128.png"),
      title: "Calendar Checker",
      message: "Desktop reminders are available. This is a test notification.",
      silent: true,
    });
  }
  async clear(id: string) {
    await chrome.notifications.clear(`calendar-reminder:${id}`);
  }
  async schedule(when?: number) {
    if (when === undefined) {
      await chrome.alarms.clear(REMINDER_ALARM);
      return;
    }
    const current = await chrome.alarms.get(REMINDER_ALARM);
    if (current && Math.abs(current.scheduledTime - when) < 1000) return;
    await chrome.alarms.create(REMINDER_ALARM, { when });
  }
}
