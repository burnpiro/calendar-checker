import { AppError, asAppError } from "../shared/errors";
import { commandSchema, type Reply } from "../shared/model";
import type { AuthService } from "./auth-service";
import type { EventWriteService } from "./event-writes";
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
  eventSync?: EventSyncService,
  eventWrites?: EventWriteService,
): Promise<Reply> {
  try {
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("invalid-request");
    const command = parsed.data;
    switch (command.type) {
      case "PREPARE_EDIT":
        if (!eventWrites) throw new AppError("unexpected");
        return {
          ok: true,
          state: await service.snapshot(),
          edit: await eventWrites.prepare(command.key, command.scope),
        };
      case "SAVE_EVENT":
        if (!eventWrites) throw new AppError("unexpected");
        await eventWrites.save(command);
        break;
      case "DELETE_EVENT":
        if (!eventWrites) throw new AppError("unexpected");
        await eventWrites.delete(
          command.id,
          command.base,
          command.scope,
          command.sendUpdates,
        );
        break;
      case "RETRY_WRITE":
        if (!eventWrites) throw new AppError("unexpected");
        await eventWrites.retry(command.id);
        break;
      case "DISCARD_WRITE":
        if (!eventWrites) throw new AppError("unexpected");
        await eventWrites.discard(command.id);
        break;
      case "RESOLVE_WRITE":
        if (!eventWrites) throw new AppError("unexpected");
        await eventWrites.resolve(command.id, command.choice);
        break;
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
        await eventWrites?.assertNoPending(command.accountId);
        await service.remove(command.accountId);
        await eventSync?.repository.reconcile(
          (await service.snapshot()).accounts,
        );
        break;
      case "UPDATE_SETTINGS":
        await service.updateSettings(command.settings);
        await reschedule();
        break;
      case "SYNC_EVENTS":
        if (!eventSync) throw new AppError("unexpected");
        await eventWrites?.run();
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
