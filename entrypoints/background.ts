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
import { ensureConnectionAlarm } from "../src/background/scheduler";
import { SerialQueue } from "../src/background/serial-queue";
import { AUTH_ALARM } from "../src/shared/model";
import { LocalCalendarRepository } from "../src/calendar/database";

export default defineBackground(() => {
  const repository = new ChromeRepository();
  const localCalendar = new LocalCalendarRepository();
  const service = new AuthService({
    identity: new ChromeIdentityProvider(),
    google: new GoogleCalendarGateway(),
    repository,
    badge: new ChromeBadge(),
    configuration: {
      extensionId: chrome.runtime.id,
      oauthConfigured: Boolean(chrome.runtime.getManifest().oauth2?.client_id),
    },
  });
  const queue = new SerialQueue();
  const reschedule = async () => {
    const { settings } = await repository.read();
    await ensureConnectionAlarm(chrome.alarms, settings.connectionCheckMinutes);
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
        ? routeCommand(command, service, reschedule, localCalendar)
        : queue.run(() =>
            routeCommand(command, service, reschedule, localCalendar),
          );
      void result.then(sendResponse);
      return true;
    },
  );

  const backgroundCheck = () => {
    void queue
      .run(async () => {
        await ready;
        await service.checkEnabled();
      })
      .catch(() => undefined);
  };
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTH_ALARM) backgroundCheck();
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
    await service.refreshBadge();
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
