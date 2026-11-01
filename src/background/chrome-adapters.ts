import { AppError, classifyIdentityError } from "../shared/errors";
import {
  emptyStore,
  SCOPES,
  STORAGE_KEY,
  storeSchema,
  type Store,
} from "../shared/model";
import type {
  Badge,
  IdentityProvider,
  Repository,
  TokenRequest,
} from "./ports";

export class ChromeIdentityProvider implements IdentityProvider {
  async getToken({
    accountId,
    interactive,
    chooseAccount,
  }: TokenRequest): Promise<string> {
    try {
      // Explicit "Add account" only. Resets this extension's remembered chooser selection,
      // not Google's browser sessions. Never clear the whole cache during checks/reconnect.
      if (chooseAccount) await chrome.identity.clearAllCachedAuthTokens();
      const result = await chrome.identity.getAuthToken({
        interactive,
        scopes: [...SCOPES],
        ...(accountId ? { account: { id: accountId } } : {}),
      });
      if (!result.token)
        throw new AppError("reconnect-required", { stage: "authorization" });
      if (
        result.grantedScopes &&
        SCOPES.some((scope) => !result.grantedScopes?.includes(scope))
      ) {
        await chrome.identity.removeCachedAuthToken({ token: result.token });
        throw new AppError("permission-required", { stage: "authorization" });
      }
      return result.token;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const classified = classifyIdentityError(error);
      // Background consent failures are actionable reconnects, never cancelled UI operations.
      if (!interactive && classified.code === "auth-cancelled")
        throw new AppError("reconnect-required", classified.details);
      throw classified;
    }
  }

  async invalidateToken(token: string): Promise<void> {
    try {
      await chrome.identity.removeCachedAuthToken({ token });
    } catch {
      throw new AppError("reconnect-required", { stage: "authorization" });
    }
  }
}

export class ChromeRepository implements Repository {
  async read(): Promise<Store> {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      return data[STORAGE_KEY] === undefined
        ? emptyStore()
        : storeSchema.parse(data[STORAGE_KEY]);
    } catch {
      // Do not replace an unsupported/corrupt store with defaults and lose account data.
      throw new AppError("storage-error");
    }
  }

  async write(store: Store): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: storeSchema.parse(store),
      });
    } catch {
      throw new AppError("storage-error");
    }
  }
}

export class ChromeBadge implements Badge {
  async update(reconnectCount: number): Promise<void> {
    await chrome.action.setBadgeText({ text: reconnectCount > 0 ? "!" : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b42335" });
    await chrome.action.setTitle({
      title:
        reconnectCount > 0
          ? `Calendar Checker — ${reconnectCount} account${reconnectCount === 1 ? " needs" : "s need"} reconnecting`
          : "Calendar Checker",
    });
  }
}
