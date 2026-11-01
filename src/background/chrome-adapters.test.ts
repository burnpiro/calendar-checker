import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeIdentityProvider, ChromeRepository } from "./chrome-adapters";
import { SCOPES, STORAGE_KEY } from "../shared/model";

afterEach(() => vi.unstubAllGlobals());

function mockIdentity() {
  const identity = {
    getAuthToken: vi.fn(async () => ({
      token: "private-token",
      grantedScopes: [...SCOPES],
    })),
    clearAllCachedAuthTokens: vi.fn(async () => undefined),
    removeCachedAuthToken: vi.fn(async () => undefined),
  };
  vi.stubGlobal("chrome", { identity });
  return identity;
}

describe("Chrome-managed identity", () => {
  it("pins noninteractive requests to the known account and never resets the chooser", async () => {
    const identity = mockIdentity();
    await new ChromeIdentityProvider().getToken({
      accountId: "expected",
      interactive: false,
    });
    expect(identity.getAuthToken).toHaveBeenCalledWith({
      account: { id: "expected" },
      interactive: false,
      scopes: [...SCOPES],
    });
    expect(identity.clearAllCachedAuthTokens).not.toHaveBeenCalled();
  });

  it("resets remembered selection only for explicit add-account requests", async () => {
    const identity = mockIdentity();
    await new ChromeIdentityProvider().getToken({
      interactive: true,
      chooseAccount: true,
    });
    expect(identity.clearAllCachedAuthTokens).toHaveBeenCalledTimes(1);
    expect(identity.getAuthToken).toHaveBeenCalledWith({
      interactive: true,
      scopes: [...SCOPES],
    });
  });

  it("rejects partial consent and invalidates its cached token", async () => {
    const identity = mockIdentity();
    identity.getAuthToken.mockResolvedValue({
      token: "private-token",
      grantedScopes: ["openid"],
    });
    await expect(
      new ChromeIdentityProvider().getToken({ interactive: true }),
    ).rejects.toMatchObject({ code: "permission-required" });
    expect(identity.removeCachedAuthToken).toHaveBeenCalledWith({
      token: "private-token",
    });
  });

  it("maps background consent rejection to reconnect and preserves interactive cancellation", async () => {
    const identity = mockIdentity();
    identity.getAuthToken.mockRejectedValue(
      new Error("The user did not approve access"),
    );
    await expect(
      new ChromeIdentityProvider().getToken({
        interactive: false,
        accountId: "a",
      }),
    ).rejects.toMatchObject({ code: "reconnect-required" });
    await expect(
      new ChromeIdentityProvider().getToken({ interactive: true }),
    ).rejects.toMatchObject({ code: "auth-cancelled" });
  });

  it("keeps identity network failures separate from revoked consent", async () => {
    const identity = mockIdentity();
    identity.getAuthToken.mockRejectedValue(new Error("Network error"));
    await expect(
      new ChromeIdentityProvider().getToken({ interactive: false }),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("retains only the safe native network code and authorization step", async () => {
    const identity = mockIdentity();
    identity.getAuthToken.mockRejectedValue(
      new Error(
        "OAuth2 request failed: Connection failed (-2). private-token=user-secret",
      ),
    );
    try {
      await new ChromeIdentityProvider().getToken({ interactive: true });
      expect.fail("Expected a connection failure");
    } catch (error) {
      expect(error).toMatchObject({
        code: "network",
        details: {
          stage: "authorization",
          networkFailure: "request-failed",
          browserNetworkCode: -2,
        },
      });
      expect(String(error)).not.toContain("user-secret");
      expect(JSON.stringify(error)).not.toContain("user-secret");
    }
  });
});

describe("local persistence", () => {
  it("never clears or overwrites an unsupported stored schema", async () => {
    const local = {
      get: vi.fn(async () => ({ [STORAGE_KEY]: { schemaVersion: 99 } })),
      set: vi.fn(),
      clear: vi.fn(),
    };
    vi.stubGlobal("chrome", { storage: { local } });
    await expect(new ChromeRepository().read()).rejects.toMatchObject({
      code: "storage-error",
    });
    expect(local.set).not.toHaveBeenCalled();
    expect(local.clear).not.toHaveBeenCalled();
  });
});
