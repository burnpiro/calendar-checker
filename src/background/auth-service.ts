import { AppError, asAppError, isReconnectError } from "../shared/errors";
import {
  needsReconnect,
  settingsSchema,
  type Account,
  type Configuration,
  type Diagnostic,
  type DiagnosticsReport,
  type Settings,
  type Snapshot,
  type Store,
} from "../shared/model";
import { GoogleHttpError } from "./google";
import type {
  Badge,
  GoogleGateway,
  IdentityProvider,
  Repository,
} from "./ports";

interface Dependencies {
  identity: IdentityProvider;
  google: GoogleGateway;
  repository: Repository;
  badge: Badge;
  configuration: Configuration;
  now?: () => Date;
}

/** All mutations are called through the worker's SerialQueue. Tokens stay on this stack. */
export class AuthService {
  private readonly now: () => Date;

  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  private requireSetup(): void {
    if (!this.deps.configuration.oauthConfigured)
      throw new AppError("setup-required");
  }

  async snapshot(): Promise<Snapshot> {
    const { accounts, settings } = await this.deps.repository.read();
    return { ...this.deps.configuration, accounts, settings };
  }

  async refreshBadge(): Promise<void> {
    const store = await this.deps.repository.read();
    await this.deps.badge.update(store.accounts.filter(needsReconnect).length);
  }

  private async save(store: Store): Promise<void> {
    await this.deps.repository.write(store);
    // A transient toolbar failure must not misreport a successful account write as a failed sign-in.
    await this.deps.badge
      .update(store.accounts.filter(needsReconnect).length)
      .catch(() => undefined);
  }

  private record(
    store: Store,
    action: Diagnostic["action"],
    error?: AppError,
  ): void {
    store.diagnostics = [
      ...store.diagnostics,
      {
        at: this.now().toISOString(),
        action,
        outcome: error ? ("failure" as const) : ("success" as const),
        ...(error ? { code: error.code, details: error.details } : {}),
      },
    ].slice(-50);
  }

  private async verifiedData(token: string, expectedId?: string) {
    const profile = await this.deps.google.getProfile(token);
    if (expectedId && profile.id !== expectedId)
      throw new AppError("account-mismatch", { stage: "account-details" });
    // Do not load any calendars until the account identity is verified.
    const calendars = await this.deps.google.listCalendars(token);
    return { profile, calendars };
  }

  private async loadAccount(
    accountId: string | undefined,
    interactive: boolean,
    freshToken = false,
  ) {
    let token = await this.deps.identity.getToken({
      interactive,
      ...(accountId ? { accountId } : { chooseAccount: true }),
    });
    if (freshToken) {
      await this.deps.identity.invalidateToken(token);
      token = await this.deps.identity.getToken({
        accountId,
        interactive: false,
      });
    }
    try {
      return await this.verifiedData(token, accountId);
    } catch (error) {
      if (!(error instanceof GoogleHttpError) || error.status !== 401)
        throw error;
      await this.deps.identity.invalidateToken(token);
      // Exactly one silent retry, always for the same selected account.
      // New-account onboarding has no verified ID yet, so it must not retry an unpinned chooser.
      if (!accountId) throw new AppError("reconnect-required", error.details);
      const renewed = await this.deps.identity.getToken({
        accountId,
        interactive: false,
      });
      return this.verifiedData(renewed, accountId);
    }
  }

  async connect(): Promise<void> {
    this.requireSetup();
    const store = await this.deps.repository.read();
    try {
      const { profile, calendars } = await this.loadAccount(undefined, true);
      const previous = store.accounts.find(
        (account) => account.id === profile.id,
      );
      const at = this.now().toISOString();
      const account: Account = {
        id: profile.id,
        email: profile.email,
        enabled: previous?.enabled ?? true,
        status: "connected",
        calendars,
        connectedAt: previous?.connectedAt ?? at,
        lastCheckedAt: at,
        lastSuccessfulAt: at,
      };
      store.accounts = [
        ...store.accounts.filter((item) => item.id !== profile.id),
        account,
      ];
      this.record(store, "connect");
    } catch (error) {
      const safe = asAppError(error);
      this.record(store, "connect", safe);
      await this.save(store);
      throw safe;
    }
    await this.save(store);
  }

  async check(
    accountId: string,
    options: { interactive?: boolean; freshToken?: boolean } = {},
  ): Promise<void> {
    this.requireSetup();
    const store = await this.deps.repository.read();
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) throw new AppError("unknown-account");
    const action = options.interactive
      ? "reconnect"
      : options.freshToken
        ? "fresh-token"
        : "check";
    account.lastCheckedAt = this.now().toISOString();
    try {
      const { profile, calendars } = await this.loadAccount(
        accountId,
        options.interactive ?? false,
        options.freshToken,
      );
      account.email = profile.email;
      account.calendars = calendars;
      account.status = "connected";
      account.lastSuccessfulAt = this.now().toISOString();
      delete account.errorCode;
      delete account.errorDetails;
      this.record(store, action);
    } catch (error) {
      const safe = asAppError(error);
      if (safe.code !== "auth-cancelled") {
        account.errorCode = safe.code;
        account.errorDetails = safe.details;
        account.status = isReconnectError(safe.code)
          ? "reconnect"
          : account.status === "reconnect"
            ? "reconnect"
            : safe.code === "network"
              ? "offline"
              : "error";
      }
      this.record(store, action, safe);
      await this.save(store);
      throw safe;
    }
    await this.save(store);
  }

  async checkEnabled(): Promise<void> {
    if (!this.deps.configuration.oauthConfigured) return;
    const { accounts } = await this.deps.repository.read();
    for (const account of accounts.filter((item) => item.enabled)) {
      try {
        await this.check(account.id);
      } catch (error) {
        // Account-specific failures must not prevent the remaining accounts from being checked.
        if (asAppError(error).code === "storage-error") throw error;
      }
    }
  }

  async setEnabled(accountId: string, enabled: boolean): Promise<void> {
    const store = await this.deps.repository.read();
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) throw new AppError("unknown-account");
    account.enabled = enabled;
    this.record(store, "toggle");
    await this.save(store);
  }

  async remove(accountId: string): Promise<void> {
    const store = await this.deps.repository.read();
    if (!store.accounts.some((account) => account.id === accountId))
      throw new AppError("unknown-account");
    store.accounts = store.accounts.filter(
      (account) => account.id !== accountId,
    );
    this.record(store, "remove");
    await this.save(store);
  }

  async updateSettings(settings: Settings): Promise<void> {
    const parsed = settingsSchema.safeParse(settings);
    if (!parsed.success) throw new AppError("invalid-request");
    const store = await this.deps.repository.read();
    store.settings = parsed.data;
    this.record(store, "settings");
    await this.save(store);
  }

  async diagnostics(): Promise<DiagnosticsReport> {
    const store = await this.deps.repository.read();
    return {
      formatVersion: 1,
      generatedAt: this.now().toISOString(),
      ...this.deps.configuration,
      accounts: {
        total: store.accounts.length,
        enabled: store.accounts.filter((account) => account.enabled).length,
        reconnectRequired: store.accounts.filter(needsReconnect).length,
      },
      settings: store.settings,
      checks: store.diagnostics,
      liveMultiAccountVerification: "requires-manual-validation",
    };
  }
}
