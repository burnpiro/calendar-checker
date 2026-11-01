import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleWebIdentity, parseGoogleCallback } from "./web-identity";
import { ChromeIdentityProvider } from "./chrome-adapters";
import { SCOPES } from "../shared/model";

const redirect = "https://test-extension.chromiumapp.org/";
const client = "123456789-fixture.apps.googleusercontent.com";
const state = "expected-state";
function callback(changes: Record<string, string> = {}, path = redirect) {
  return `${path}#${new URLSearchParams({ state, access_token: "private-web-token", expires_in: "3600", token_type: "Bearer", scope: SCOPES.join(" "), ...changes })}`;
}
function harness() {
  const launches: URL[] = [];
  const identity = {
    getRedirectURL: vi.fn(() => redirect),
    launchWebAuthFlow: vi.fn(
      async ({ url }: chrome.identity.WebAuthFlowDetails) => {
        const request = new URL(url);
        launches.push(request);
        return callback({ state: request.searchParams.get("state")! });
      },
    ),
    getAuthToken: vi.fn(),
    clearAllCachedAuthTokens: vi.fn(),
    removeCachedAuthToken: vi.fn(),
  };
  vi.stubGlobal("chrome", { identity });
  return { identity, launches };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("explicit Google account chooser", () => {
  it("requests an explicit account choice with CSRF protection and never clears native tokens", async () => {
    const h = harness();
    const provider = new ChromeIdentityProvider();
    expect(
      await provider.getToken({
        interactive: true,
        chooseAccount: true,
        webClientId: client,
      }),
    ).toBe("private-web-token");
    expect(h.launches[0]?.origin).toBe("https://accounts.google.com");
    expect(h.launches[0]?.searchParams.get("prompt")).toBe("select_account");
    expect(h.launches[0]?.searchParams.get("client_id")).toBe(client);
    expect(h.launches[0]?.searchParams.get("redirect_uri")).toBe(redirect);
    expect(h.launches[0]?.searchParams.get("state")?.length).toBeGreaterThan(
      30,
    );
    expect(h.identity.getAuthToken).not.toHaveBeenCalled();
    expect(h.identity.clearAllCachedAuthTokens).not.toHaveBeenCalled();
    await provider.invalidateToken("private-web-token");
    expect(h.identity.removeCachedAuthToken).not.toHaveBeenCalled();
  });
  it("pins silent requests, bounds their duration, expires cached access and recovers after worker restart", async () => {
    const h = harness();
    vi.useFakeTimers({ toFake: ["Date"] });
    const request = {
      interactive: false,
      accountId: "account-b",
      webClientId: client,
    };
    const provider = new GoogleWebIdentity();
    await provider.getToken(request);
    await provider.getToken(request);
    expect(h.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1);
    expect(h.identity.launchWebAuthFlow).toHaveBeenCalledWith({
      url: expect.any(String),
      interactive: false,
      abortOnLoadForNonInteractive: false,
      timeoutMsForNonInteractive: 15000,
    });
    expect(h.launches[0]?.searchParams.get("prompt")).toBe("none");
    expect(h.launches[0]?.searchParams.get("login_hint")).toBe("account-b");
    vi.setSystemTime(Date.now() + 3600_000);
    await provider.getToken(request);
    expect(h.identity.launchWebAuthFlow).toHaveBeenCalledTimes(2);
    await new GoogleWebIdentity().getToken(request);
    expect(h.identity.launchWebAuthFlow).toHaveBeenCalledTimes(3);
    expect(h.launches[0]?.searchParams.get("state")).not.toBe(
      h.launches[1]?.searchParams.get("state"),
    );
  });
  it("keeps accounts/client caches independent and evicts rejected tokens", async () => {
    const h = harness();
    const provider = new GoogleWebIdentity();
    const request = { interactive: false, accountId: "a", webClientId: client };
    await provider.getToken(request);
    await provider.getToken({ ...request, accountId: "b" });
    expect(h.identity.launchWebAuthFlow).toHaveBeenCalledTimes(2);
    provider.invalidate("private-web-token");
    await provider.getToken(request);
    await provider.getToken({ ...request, interactive: true });
    expect(h.identity.launchWebAuthFlow).toHaveBeenCalledTimes(4);
  });
  it("rejects missing chooser configuration before opening a window", async () => {
    const h = harness();
    await expect(
      new GoogleWebIdentity().getToken({ interactive: true, webClientId: "" }),
    ).rejects.toMatchObject({ code: "chooser-setup-required" });
    expect(h.identity.launchWebAuthFlow).not.toHaveBeenCalled();
  });
  it("preserves cancellation and maps silent interaction requirements to reconnect without leaking callbacks", async () => {
    const h = harness();
    h.identity.launchWebAuthFlow.mockImplementation(async () => {
      throw new Error("The user did not approve access. private-web-token");
    });
    await expect(
      new GoogleWebIdentity().getToken({
        interactive: true,
        webClientId: client,
      }),
    ).rejects.toMatchObject({ code: "auth-cancelled" });
    await expect(
      new GoogleWebIdentity().getToken({
        interactive: false,
        accountId: "b",
        webClientId: client,
      }),
    ).rejects.toMatchObject({ code: "reconnect-required" });
  });
  it("keeps network failures separate from a reconnect requirement", async () => {
    const h = harness();
    h.identity.launchWebAuthFlow.mockImplementation(async () => {
      throw new Error("Network connection failed (-2) private-web-token");
    });
    await expect(
      new GoogleWebIdentity().getToken({
        interactive: false,
        webClientId: client,
      }),
    ).rejects.toMatchObject({
      code: "network",
      details: { stage: "authorization" },
    });
  });
});

describe("Google callback validation", () => {
  it("accepts only the expected callback and the complete grant, including Google's email alias", () => {
    expect(parseGoogleCallback(callback(), redirect, state, true)).toEqual({
      token: "private-web-token",
      seconds: 3600,
    });
    expect(
      parseGoogleCallback(
        callback({
          scope: SCOPES.join(" ").replace(
            "https://www.googleapis.com/auth/userinfo.email",
            "email",
          ),
        }),
        redirect,
        state,
        true,
      ),
    ).toEqual({ token: "private-web-token", seconds: 3600 });
  });
  it.each([
    callback({ state: "wrong" }),
    callback({}, "https://attacker.example/"),
    callback({}, redirect + "wrong-path"),
    callback({ expires_in: "NaN" }),
    callback({ expires_in: "0" }),
    callback({ token_type: "MAC" }),
    callback({ access_token: "" }),
    callback() + "&state=duplicate",
  ])(
    "rejects invalid callback variant %# without exposing its contents",
    (result) => {
      try {
        parseGoogleCallback(result, redirect, state, true);
        expect.fail("Should reject");
      } catch (error) {
        expect(error).toMatchObject({ code: "invalid-response" });
        expect(String(error)).not.toContain("private-web-token");
        expect(JSON.stringify(error)).not.toContain("attacker.example");
      }
    },
  );
  it("rejects partial consent and distinguishes cancelled interactive consent from expired silent sessions", () => {
    expect(() =>
      parseGoogleCallback(
        callback({ scope: "openid email" }),
        redirect,
        state,
        true,
      ),
    ).toThrow(expect.objectContaining({ code: "permission-required" }));
    const denied = `${redirect}#${new URLSearchParams({ state, error: "access_denied" })}`;
    expect(() => parseGoogleCallback(denied, redirect, state, true)).toThrow(
      expect.objectContaining({ code: "auth-cancelled" }),
    );
    expect(() => parseGoogleCallback(denied, redirect, state, false)).toThrow(
      expect.objectContaining({ code: "reconnect-required" }),
    );
  });
});
