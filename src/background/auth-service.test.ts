import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../shared/errors";
import { emptyStore, type Account, type Store } from "../shared/model";
import { AuthService } from "./auth-service";
import { GoogleHttpError } from "./google";
import type { TokenRequest } from "./ports";

const at = "2026-11-01T12:00:00.000Z";
function savedAccount(id = "account-a"): Account {
  return {
    id,
    email: `${id}@example.com`,
    enabled: true,
    status: "connected",
    calendars: [
      {
        id: "calendar-a",
        summary: "Saved calendar",
        accessRole: "owner",
        primary: true,
      },
    ],
    connectedAt: at,
    lastCheckedAt: at,
    lastSuccessfulAt: at,
  };
}

function harness(initial: Store = emptyStore(), configured = true) {
  let stored = structuredClone(initial);
  const repository = {
    read: vi.fn(async () => structuredClone(stored)),
    write: vi.fn(async (value: Store) => {
      stored = structuredClone(value);
    }),
  };
  const identity = {
    getToken: vi.fn(async (_request: TokenRequest) => "private-access-token"),
    invalidateToken: vi.fn(async () => undefined),
  };
  const google = {
    getProfile: vi.fn(async () => ({
      id: "account-a",
      email: "account-a@example.com",
    })),
    listCalendars: vi.fn(async () => [
      {
        id: "new-calendar",
        summary: "Updated calendar",
        accessRole: "writer",
        primary: false,
      },
    ]),
  };
  const badge = { update: vi.fn(async () => undefined) };
  const deps = {
    identity,
    google,
    repository,
    badge,
    configuration: {
      extensionId: "test-extension",
      oauthConfigured: configured,
    },
    now: () => new Date(at),
  };
  return {
    service: new AuthService(deps),
    deps,
    identity,
    google,
    repository,
    badge,
    stored: () => structuredClone(stored),
  };
}

describe("account authentication", () => {
  let state: Store;
  beforeEach(() => {
    state = emptyStore();
    state.accounts = [savedAccount()];
  });

  it("connects multiple accounts without persisting tokens or duplicating the same identity", async () => {
    const h = harness(state);
    h.google.getProfile.mockResolvedValue({
      id: "account-b",
      email: "b@example.com",
    });
    await h.service.connect();
    await h.service.connect();
    expect(h.stored().accounts.map((account) => account.id)).toEqual([
      "account-a",
      "account-b",
    ]);
    expect(h.identity.getToken).toHaveBeenCalledWith({
      interactive: true,
      chooseAccount: true,
    });
    expect(JSON.stringify(h.stored())).not.toContain("private-access-token");
    expect(JSON.stringify(await h.service.snapshot())).not.toContain(
      "private-access-token",
    );
  });

  it("requires setup before opening a Google authorization flow", async () => {
    const h = harness(state, false);
    await expect(h.service.connect()).rejects.toMatchObject({
      code: "setup-required",
    });
    expect(h.identity.getToken).not.toHaveBeenCalled();
    expect(h.repository.write).not.toHaveBeenCalled();
  });

  it("checks identity before loading calendars, preserving saved data on a mismatch", async () => {
    const h = harness(state);
    h.google.getProfile.mockResolvedValue({
      id: "wrong-account",
      email: "wrong@example.com",
    });
    await expect(h.service.check("account-a")).rejects.toMatchObject({
      code: "account-mismatch",
    });
    expect(h.google.listCalendars).not.toHaveBeenCalled();
    expect(h.stored().accounts[0]).toMatchObject({
      id: "account-a",
      email: "account-a@example.com",
      status: "reconnect",
      calendars: state.accounts[0]!.calendars,
    });
    expect(h.badge.update).toHaveBeenLastCalledWith(1);
  });

  it("renews a rejected token once for the same account without opening a prompt", async () => {
    const h = harness(state);
    h.google.getProfile.mockRejectedValueOnce(
      new GoogleHttpError(401, "reconnect-required"),
    );
    await h.service.check("account-a");
    expect(h.identity.invalidateToken).toHaveBeenCalledExactlyOnceWith(
      "private-access-token",
    );
    expect(h.identity.getToken).toHaveBeenCalledTimes(2);
    for (const [request] of h.identity.getToken.mock.calls)
      expect(request).toEqual({ accountId: "account-a", interactive: false });
    expect(h.stored().accounts[0]?.status).toBe("connected");
  });

  it("does not retry indefinitely when renewed tokens are still rejected", async () => {
    const h = harness(state);
    h.google.getProfile.mockRejectedValue(
      new GoogleHttpError(401, "reconnect-required"),
    );
    await expect(h.service.check("account-a")).rejects.toMatchObject({
      code: "reconnect-required",
    });
    expect(h.identity.getToken).toHaveBeenCalledTimes(2);
    expect(h.stored().accounts[0]?.status).toBe("reconnect");
  });

  it("tests fresh-token acquisition without clearing other accounts' token caches", async () => {
    const h = harness(state);
    await h.service.check("account-a", { freshToken: true });
    expect(h.identity.invalidateToken).toHaveBeenCalledTimes(1);
    expect(h.identity.getToken).toHaveBeenCalledTimes(2);
    expect(
      h.identity.getToken.mock.calls.every(
        ([request]) => !request.chooseAccount,
      ),
    ).toBe(true);
    expect(h.stored().diagnostics.at(-1)?.action).toBe("fresh-token");
  });

  it("keeps cached calendars during an outage without requesting reconnection", async () => {
    const h = harness(state);
    h.google.listCalendars.mockRejectedValue(new AppError("network"));
    await expect(h.service.check("account-a")).rejects.toMatchObject({
      code: "network",
    });
    expect(h.stored().accounts[0]).toMatchObject({
      status: "offline",
      calendars: state.accounts[0]!.calendars,
      lastSuccessfulAt: at,
    });
    expect(h.badge.update).toHaveBeenLastCalledWith(0);
    expect(h.identity.invalidateToken).not.toHaveBeenCalled();
  });

  it("does not hide an existing reconnect requirement when the network also fails", async () => {
    state.accounts[0]!.status = "reconnect";
    const h = harness(state);
    h.identity.getToken.mockRejectedValue(new AppError("network"));
    await expect(h.service.check("account-a")).rejects.toMatchObject({
      code: "network",
    });
    expect(h.stored().accounts[0]?.status).toBe("reconnect");
    expect(h.badge.update).toHaveBeenLastCalledWith(1);
  });

  it("checks other enabled accounts when one requires sign-in and skips disabled accounts", async () => {
    state.accounts.push(savedAccount("account-b"), {
      ...savedAccount("account-c"),
      enabled: false,
    });
    const h = harness(state);
    h.identity.getToken.mockRejectedValueOnce(
      new AppError("reconnect-required"),
    );
    h.google.getProfile.mockResolvedValue({
      id: "account-b",
      email: "b@example.com",
    });
    await h.service.checkEnabled();
    expect(h.identity.getToken).toHaveBeenCalledTimes(2);
    expect(h.stored().accounts[0]?.status).toBe("reconnect");
    expect(h.stored().accounts[1]?.status).toBe("connected");
    expect(h.stored().accounts[2]?.lastSuccessfulAt).toBe(at);
    expect(h.badge.update).toHaveBeenLastCalledWith(1);
  });

  it("cancelling reconnect keeps the account's cached data and state", async () => {
    state.accounts[0]!.status = "reconnect";
    const h = harness(state);
    h.identity.getToken.mockRejectedValue(new AppError("auth-cancelled"));
    await expect(
      h.service.check("account-a", { interactive: true }),
    ).rejects.toMatchObject({ code: "auth-cancelled" });
    expect(h.stored().accounts).toEqual(state.accounts);
  });

  it("successful reconnect clears only that account's error and updates the badge", async () => {
    state.accounts[0]!.status = "reconnect";
    state.accounts[0]!.errorCode = "reconnect-required";
    state.accounts[0]!.errorDetails = {
      stage: "authorization",
      networkFailure: "request-failed",
    };
    state.accounts.push({ ...savedAccount("account-b"), status: "reconnect" });
    const h = harness(state);
    await h.service.check("account-a", { interactive: true });
    expect(h.identity.getToken).toHaveBeenCalledWith({
      accountId: "account-a",
      interactive: true,
    });
    expect(h.stored().accounts[0]?.errorCode).toBeUndefined();
    expect(h.stored().accounts[0]?.errorDetails).toBeUndefined();
    expect(h.stored().accounts[1]?.status).toBe("reconnect");
    expect(h.badge.update).toHaveBeenLastCalledWith(1);
  });

  it("keeps safe failure-step diagnostics and cached data when an API request fails", async () => {
    const h = harness(state);
    h.google.listCalendars.mockRejectedValue(
      new AppError("network", {
        stage: "calendar-list",
        networkFailure: "timeout",
      }),
    );
    await expect(h.service.check("account-a")).rejects.toMatchObject({
      code: "network",
    });
    expect(h.stored().accounts[0]).toMatchObject({
      status: "offline",
      errorDetails: { stage: "calendar-list", networkFailure: "timeout" },
      calendars: state.accounts[0]!.calendars,
    });
    const report = await h.service.diagnostics();
    expect(report.checks.at(-1)?.details).toEqual({
      stage: "calendar-list",
      networkFailure: "timeout",
    });
    expect(JSON.stringify(report)).not.toContain("private-access-token");
    expect(JSON.stringify(report)).not.toContain("account-a");
  });

  it("reconstructs account state and badges after a service worker restart", async () => {
    state.accounts[0]!.status = "reconnect";
    const h = harness(state);
    const restarted = new AuthService(h.deps);
    await restarted.refreshBadge();
    expect((await restarted.snapshot()).accounts).toEqual(state.accounts);
    expect(h.badge.update).toHaveBeenCalledWith(1);
    expect(h.identity.getToken).not.toHaveBeenCalled();
  });

  it("pausing/removing accounts updates the badge without signing out of Google", async () => {
    state.accounts[0]!.status = "reconnect";
    const h = harness(state);
    await h.service.setEnabled("account-a", false);
    expect(h.badge.update).toHaveBeenLastCalledWith(0);
    await h.service.remove("account-a");
    expect(h.stored().accounts).toEqual([]);
    expect(h.identity.getToken).not.toHaveBeenCalled();
    expect(h.identity.invalidateToken).not.toHaveBeenCalled();
  });

  it("rejects invalid settings without overwriting the saved preferences", async () => {
    const h = harness(state);
    await expect(
      h.service.updateSettings({
        connectionCheckMinutes: 0,
        staleAfterMinutes: 15,
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(h.repository.write).not.toHaveBeenCalled();
  });

  it("merges preference patches without resetting other settings or leaking visibility keys into diagnostics", async () => {
    const h = harness(state);
    await h.service.updateSettings({
      theme: "dark",
      calendarVisibility: { "private-account-and-calendar": false },
    });
    await h.service.updateSettings({ connectionCheckMinutes: 12 });
    await h.service.updateSettings({
      calendarVisibility: { "another-calendar": true },
    });
    expect(h.stored().settings).toMatchObject({
      theme: "dark",
      connectionCheckMinutes: 12,
      calendarVisibility: {
        "private-account-and-calendar": false,
        "another-calendar": true,
      },
    });
    expect(h.stored().accounts).toEqual(state.accounts);
    expect(JSON.stringify(await h.service.diagnostics())).not.toContain(
      "private-account-and-calendar",
    );
  });

  it("diagnostics exclude account identities and calendars, and retain at most 50 results", async () => {
    state.diagnostics = Array.from({ length: 50 }, () => ({
      at,
      action: "check" as const,
      outcome: "success" as const,
    }));
    const h = harness(state);
    await h.service.check("account-a");
    const report = await h.service.diagnostics();
    expect(report.checks).toHaveLength(50);
    expect(report.accounts.total).toBe(1);
    const json = JSON.stringify(report);
    for (const sensitive of [
      "account-a",
      "example.com",
      "Updated calendar",
      "private-access-token",
    ])
      expect(json).not.toContain(sensitive);
    expect(report.liveMultiAccountVerification).toBe(
      "requires-manual-validation",
    );
  });

  it("does not claim failure after data was saved when toolbar badge rendering fails", async () => {
    const h = harness(state);
    h.badge.update.mockRejectedValue(new Error("Toolbar unavailable"));
    await expect(h.service.check("account-a")).resolves.toBeUndefined();
    expect(h.stored().accounts[0]?.calendars[0]?.id).toBe("new-calendar");
  });

  it("does not overwrite a store that could not be read", async () => {
    const h = harness(state);
    h.repository.read.mockRejectedValue(new AppError("storage-error"));
    await expect(h.service.connect()).rejects.toMatchObject({
      code: "storage-error",
    });
    expect(h.repository.write).not.toHaveBeenCalled();
    expect(h.identity.getToken).not.toHaveBeenCalled();
  });
});
