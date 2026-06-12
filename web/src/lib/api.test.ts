import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api, setAccessToken, getAccessToken, setSessionHint, hasSession, ApiError } from "./api";

type MockResp = { status?: number; ok?: boolean; json?: unknown };

function mockFetchSequence(responses: MockResp[]) {
  const fn = vi.fn();
  for (const r of responses) {
    const status = r.status ?? 200;
    fn.mockResolvedValueOnce({
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      json: async () => r.json ?? {},
      headers: { get: () => null },
    } as unknown as Response);
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

const authHeader = (call: unknown[]) =>
  ((call[1] as RequestInit).headers as Record<string, string>).Authorization;
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const credentialsOf = (call: unknown[]) => (call[1] as RequestInit).credentials;

describe("api request / token refresh", () => {
  beforeEach(() => {
    setAccessToken(null);
    localStorage.clear();
    // Default to a non-public path so the failure case would attempt a redirect.
    window.history.pushState({}, "", "/inboxes");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the bearer token and returns parsed JSON", async () => {
    setAccessToken("tok-123");
    const fetchMock = mockFetchSequence([{ json: { ok: true } }]);
    const out = await api.get<{ ok: boolean }>("/me");
    expect(out).toEqual({ ok: true });
    expect(authHeader(fetchMock.mock.calls[0])).toBe("Bearer tok-123");
  });

  it("refreshes via the httpOnly cookie and retries once on 401", async () => {
    setAccessToken("expired");
    setSessionHint(true);
    const fetchMock = mockFetchSequence([
      { status: 401 }, // initial request rejected
      { json: { access_token: "new-at" } }, // /auth/refresh (cookie mode: no refresh_token in body)
      { json: { data: 42 } }, // retried request
    ]);
    const out = await api.get<{ data: number }>("/data");
    expect(out).toEqual({ data: 42 });
    expect(getAccessToken()).toBe("new-at");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The refresh call must carry the cookie and ask for cookie mode.
    const refreshCall = fetchMock.mock.calls[1];
    expect(refreshCall[0]).toContain("/auth/refresh");
    expect(credentialsOf(refreshCall)).toBe("include");
    expect(bodyOf(refreshCall)).toEqual({ use_cookie: true });
    expect(authHeader(fetchMock.mock.calls[2])).toBe("Bearer new-at");
  });

  it("migrates a legacy localStorage refresh token into cookie mode", async () => {
    setAccessToken("expired");
    localStorage.setItem("refresh_token", "rt-legacy"); // pre-cookie deploy
    const fetchMock = mockFetchSequence([
      { status: 401 },
      { json: { access_token: "new-at" } },
      { json: { ok: true } },
    ]);
    await api.get("/data");
    // The stored token is handed in once, with the cookie opt-in…
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ refresh_token: "rt-legacy", use_cookie: true });
    // …and never persists again: the rotated token lives in the cookie now.
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(hasSession()).toBe(true);
  });

  it("bootstraps from the session hint on reload (no in-memory token)", async () => {
    // Hard refresh: the access token is gone, the cookie + hint persist.
    setAccessToken(null);
    setSessionHint(true);
    mockFetchSequence([
      { status: 401 },
      { json: { access_token: "boot-at" } },
      { json: { user: "x" } },
    ]);
    const out = await api.get<{ user: string }>("/auth/me");
    expect(out).toEqual({ user: "x" });
    expect(getAccessToken()).toBe("boot-at");
  });

  it("does not attempt a refresh without any session signal", async () => {
    setAccessToken("expired"); // no hint, no legacy token
    window.history.pushState({}, "", "/login"); // public path -> no navigation attempt
    const fetchMock = mockFetchSequence([{ status: 401 }]);
    await expect(api.get("/data")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no network refresh fired
    expect(getAccessToken()).toBeNull();
    expect(hasSession()).toBe(false);
  });

  it("clears all session state when the cookie refresh fails", async () => {
    setAccessToken("expired");
    setSessionHint(true);
    localStorage.setItem("refresh_token", "rt-dead");
    window.history.pushState({}, "", "/login"); // public path -> no navigation attempt
    mockFetchSequence([
      { status: 401 }, // initial request
      { status: 401 }, // refresh rejected (session revoked server-side)
    ]);
    await expect(api.get("/data")).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(hasSession()).toBe(false);
  });

  it("surfaces non-401 errors as ApiError without refreshing", async () => {
    setAccessToken("tok");
    const fetchMock = mockFetchSequence([{ status: 400, json: { error: "bad input" } }]);
    await expect(api.get("/data")).rejects.toMatchObject({ status: 400, message: "bad input" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt
  });

  it("attaches credentials only to auth and setup endpoints", async () => {
    setAccessToken("tok");
    const fetchMock = mockFetchSequence([{ json: {} }, { json: {} }]);
    await api.get("/inboxes");
    await api.get("/auth/sessions");
    expect(credentialsOf(fetchMock.mock.calls[0])).toBeUndefined();
    expect(credentialsOf(fetchMock.mock.calls[1])).toBe("include");
  });
});
