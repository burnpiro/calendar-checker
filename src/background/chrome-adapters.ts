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

import { GoogleWebIdentity } from "./web-identity";
import { EventRepository } from "../calendar/event-repository";
import {
  badgeTextColor,
  emptyToolbarBadge,
  nextEventBadge,
  reconnectToolbarBadge,
} from "../calendar/toolbar-badge";

export class ChromeIdentityProvider implements IdentityProvider {
  private readonly web = new GoogleWebIdentity();
  async getToken({
    accountId,
    interactive,
    chooseAccount,
    webClientId,
  }: TokenRequest): Promise<string> {
    if (webClientId !== undefined)
      return this.web.getToken({
        accountId,
        interactive,
        chooseAccount,
        webClientId,
      });
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
    if (this.web.invalidate(token)) return;
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
  constructor(
    private readonly readStore: () => Promise<Store> = () =>
      new ChromeRepository().read(),
    private readonly readEvents = (now: Date) =>
      new EventRepository().toolbarData(now),
    private readonly now = () => new Date(Date.now()),
  ) {}

  async update(reconnectCount: number): Promise<void> {
    let badge = emptyToolbarBadge;
    if (reconnectCount > 0) badge = reconnectToolbarBadge(reconnectCount);
    else {
      try {
        const { accounts, settings } = await this.readStore();
        if (
          settings.showEventBadge &&
          accounts.some((account) => account.enabled)
        ) {
          const now = this.now();
          const { events, metadata } = await this.readEvents(now);
          badge = nextEventBadge(accounts, settings, events, metadata, now);
        }
      } catch {
        badge = {
          text: "!",
          color: "#b42335",
          title: "Calendar Checker — open settings to check local storage",
        };
      }
    }
    await chrome.action.setBadgeBackgroundColor({ color: badge.color });
    await chrome.action.setBadgeTextColor({
      color: badgeTextColor(badge.color),
    });
    await chrome.action.setBadgeText({ text: badge.text });
    await chrome.action.setTitle({ title: badge.title });
  }
}
