import { AppError, asAppError } from "../shared/errors";
import { commandSchema, type Reply } from "../shared/model";
import type { AuthService } from "./auth-service";

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
        break;
      case "UPDATE_SETTINGS":
        await service.updateSettings(command.settings);
        await reschedule();
        break;
      case "GET_DIAGNOSTICS":
        return {
          ok: true,
          state: await service.snapshot(),
          diagnostics: await service.diagnostics(),
        };
    }
    return { ok: true, state: await service.snapshot() };
  } catch (error) {
    const safe = asAppError(error);
    return { ok: false, error: { code: safe.code, message: safe.message } };
  }
}
