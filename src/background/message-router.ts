import { AppError, asAppError } from "../shared/errors";
import { commandSchema, type Reply } from "../shared/model";
import type { AuthService } from "./auth-service";
import type { LocalCalendarPort } from "../calendar/database";
import type { EventSyncService } from "./event-sync";

export function isTrustedSender(
  sender: { id?: string; url?: string },
  extensionId: string,
): boolean {
  return (
    sender.id === extensionId &&
    sender.url?.startsWith(`chrome-extension://${extensionId}/`) === true
  );
}

export async function routeCommand(
  raw: unknown,
  service: AuthService,
  reschedule: () => Promise<void>,
  localCalendar?: LocalCalendarPort,
  eventSync?: EventSyncService,
): Promise<Reply> {
  try {
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("invalid-request");
    const command = parsed.data;
    switch (command.type) {
      case "GET_STATE":
        break;
      case "CONNECT":
        await service.connect();
        break;
      case "RECONNECT":
        await service.check(command.accountId, { interactive: true });
        await eventSync?.repository.resumeAccount(command.accountId);
        break;
      case "CHECK":
        await service.check(command.accountId, {
          freshToken: command.freshToken,
        });
        break;
      case "CHECK_ALL":
        await service.checkEnabled();
        break;
      case "SET_ENABLED":
        await service.setEnabled(command.accountId, command.enabled);
        break;
      case "REMOVE":
        await service.remove(command.accountId);
        await eventSync?.repository.reconcile(
          (await service.snapshot()).accounts,
        );
        break;
      case "UPDATE_SETTINGS":
        await service.updateSettings(command.settings);
        await reschedule();
        break;
      case "PREPARE_DEMO":
        if (!localCalendar) throw new AppError("unexpected");
        await localCalendar.prepareDemo(command.month, command.timeZone);
        break;
      case "RESET_DEMO":
        if (!localCalendar) throw new AppError("unexpected");
        await localCalendar.resetDemo();
        break;
      case "SYNC_EVENTS":
        if (!eventSync) throw new AppError("unexpected");
        // A user's explicit Google sync selects its data source before fetching.
        // Automatic/background refreshes leave an intentional demo preview alone.
        if (
          command.reason === "manual" &&
          (await service.snapshot()).settings.dataSource !== "google"
        ) {
          await service.updateSettings({ dataSource: "google" });
        }
        await eventSync.run(command);
        break;
      case "GET_DIAGNOSTICS":
        return {
          ok: true,
          state: await service.snapshot(),
          diagnostics: {
            ...(await service.diagnostics()),
            ...(eventSync
              ? { eventSync: await eventSync.repository.summary() }
              : {}),
          },
        };
    }
    return { ok: true, state: await service.snapshot() };
  } catch (error) {
    const safe = asAppError(error);
    return { ok: false, error: { code: safe.code, message: safe.message } };
  }
}
