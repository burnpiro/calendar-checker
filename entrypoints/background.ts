import { ReminderService } from "../src/reminders/service";
import { ReminderPlatform } from "../src/background/reminder-platform";
import { SoundLibrary } from "../src/background/sounds";
import { REMINDER_ALARM, REMINDER_TICK } from "../src/reminders/model";
import { EventWriteService } from "../src/background/event-writes";
import { AuthService } from "../src/background/auth-service";
import {
  ChromeBadge,
  ChromeIdentityProvider,
  ChromeRepository,
} from "../src/background/chrome-adapters";
import { GoogleCalendarGateway } from "../src/background/google";
import {
  isTrustedSender,
  routeCommand,
} from "../src/background/message-router";
import {
  ensureConnectionAlarm,
  ensureSyncAlarm,
  ensureReminderTick,
} from "../src/background/scheduler";
import { SerialQueue } from "../src/background/serial-queue";
import { AUTH_ALARM, SYNC_ALARM } from "../src/shared/model";
import { EventSyncService } from "../src/background/event-sync";
import { EventRepository } from "../src/calendar/event-repository";
import { AppError } from "../src/shared/errors";

export default defineBackground(() => {
  const repository = new ChromeRepository();
  const google = new GoogleCalendarGateway();
  const service = new AuthService({
    identity: new ChromeIdentityProvider(),
    google,
    repository,
    badge: new ChromeBadge(),
    configuration: {
      extensionId: chrome.runtime.id,
      oauthConfigured: Boolean(chrome.runtime.getManifest().oauth2?.client_id),
    },
  });
  const eventSync = new EventSyncService(
    service,
    google,
    new EventRepository(),
  );
  const eventWrites = new EventWriteService(
    service,
    google,
    eventSync.repository,
    () => new Date(),
    async (url) => {
      await chrome.tabs.create({ url });
    },
  );
  const reminderPlatform = new ReminderPlatform();
  const reminders = new ReminderService(
    eventSync.repository.db,
    () => service.snapshot(),
    reminderPlatform,
  );
  const reminderFeatures = {
    service: reminders,
    platform: reminderPlatform,
    sounds: new SoundLibrary(eventSync.repository.db, (id) =>
      reminderPlatform.validate(id),
    ),
  };
  const queue = new SerialQueue();
  const reschedule = async () => {
    const { settings } = await repository.read();
    await ensureConnectionAlarm(chrome.alarms, settings.connectionCheckMinutes);
    await ensureSyncAlarm(chrome.alarms);
    await ensureReminderTick(chrome.alarms);
  };

  // Register listeners synchronously before the first asynchronous initialization step.
  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (!isTrustedSender(sender, chrome.runtime.id)) return false;
      const request = message as {
        namespace?: unknown;
        command?: unknown;
      } | null;
      if (request?.namespace !== "calendar-checker") return false;
      const command = request.command;
      // Reads can still render the popup while an interactive chooser is open.
      const reading =
        (command as { type?: unknown } | null)?.type === "GET_STATE";
      const result = reading
        ? routeCommand(
            command,
            service,
            reschedule,
            eventSync,
            eventWrites,
            reminderFeatures,
          )
        : queue
            .run(async () => {
              await ready;
              return routeCommand(
                command,
                service,
                reschedule,
                eventSync,
                eventWrites,
                reminderFeatures,
              );
            })
            .catch(() => ({
              ok: false as const,
              error: {
                code: "storage-error" as const,
                message: new AppError("storage-error").message,
              },
            }));
      void result.then((reply) => {
        sendResponse(reply);
        if (
          reply.ok &&
          ![
            "GET_STATE",
            "GET_DIAGNOSTICS",
            "PREVIEW_SOUND",
            "IMPORT_SOUND",
            "REMOVE_SOUND",
            "TEST_NOTIFICATION",
          ].includes((command as { type: string }).type)
        )
          void reminders.run().catch(() => undefined);
        if (
          reply.ok &&
          [
            "SAVE_EVENT",
            "DELETE_EVENT",
            "RETRY_WRITE",
            "DISCARD_WRITE",
            "RESOLVE_WRITE",
            "RECONNECT",
            "SET_ENABLED",
          ].includes((command as { type: string }).type)
        ) {
          void queue
            .run(async () => {
              await eventWrites.run();
              await eventSync.run();
              await reminders.run();
            })
            .catch(() => undefined);
        }
        if (
          reply.ok &&
          ["CONNECT", "RECONNECT", "SET_ENABLED"].includes(
            (command as { type: string }).type,
          )
        )
          void queue
            .run(() =>
              eventSync.run({
                reason:
                  (command as { type: string }).type === "RECONNECT"
                    ? "manual"
                    : "view",
                ...((command as { type: string }).type !== "CONNECT"
                  ? { accountId: (command as { accountId: string }).accountId }
                  : {}),
              }),
            )
            .catch(() => undefined);
      });
      return true;
    },
  );

  const backgroundCheck = () => {
    void queue
      .run(async () => {
        await ready;
        await service.checkEnabled();
        await eventWrites.run();
        await eventSync.run();
        await reminders.run();
      })
      .catch(() => undefined);
  };
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REMINDER_ALARM || alarm.name === REMINDER_TICK)
      void ready.then(() => reminders.run()).catch(() => undefined);
    if (alarm.name === AUTH_ALARM) backgroundCheck();
    if (alarm.name === SYNC_ALARM)
      void queue
        .run(async () => {
          await ready;
          // Keep the next-event badge current even when no network sync is due.
          await service.refreshBadge().catch(() => undefined);
          try {
            await eventWrites.run();
            await eventSync.run();
          } finally {
            await service.refreshBadge().catch(() => undefined);
            await reminders.run().catch(() => undefined);
          }
        })
        .catch(() => undefined);
  });
  chrome.notifications.onButtonClicked.addListener((notificationId, index) => {
    const id = notificationId.replace(/^calendar-reminder:/, "");
    if (id === notificationId || ![0, 1].includes(index)) return;
    void ready
      .then(() => reminders.action(id, index === 0 ? "snooze" : "dismiss"))
      .then(() => reminders.run())
      .catch(() => undefined);
  });
  chrome.notifications.onClosed.addListener((notificationId, byUser) => {
    if (byUser && notificationId.startsWith("calendar-reminder:"))
      void ready
        .then(() =>
          reminders.action(
            notificationId.slice("calendar-reminder:".length),
            "dismiss",
          ),
        )
        .catch(() => undefined);
  });
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith("calendar-reminder:"))
      void chrome.tabs.create({
        url: chrome.runtime.getURL("/calendar.html#reminders"),
      });
  });
  chrome.runtime.onStartup.addListener(backgroundCheck);
  chrome.runtime.onInstalled.addListener(() => {
    void reschedule().catch(() => undefined);
  });

  const ready = (async () => {
    await chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
    await reschedule();
    await eventSync.repository.applyDescriptionPrivacy(
      (await service.snapshot()).settings.excludeEventDescriptions,
    );
    await eventSync.repository.recover();
    await eventWrites.recover();
    await reminderFeatures.sounds.recover();
    await eventSync.repository.reconcile((await service.snapshot()).accounts);
    await service.refreshBadge();
    await reminders.run();
  })();
  // Preserve a visible failure signal without logging data or silently deleting a bad store.
  void ready.catch(async () => {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b42335" });
    await chrome.action.setTitle({
      title: "Calendar Checker — open settings to check local storage",
    });
  });
});
