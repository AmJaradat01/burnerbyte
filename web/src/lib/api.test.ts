import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api, setAccessToken, getAccessToken, ApiError } from "./api";

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

  it("refreshes and retries once on 401, carrying the new token", async () => {
    setAccessToken("expired");
    localStorage.setItem("refresh_token", "rt-1");
    const fetchMock = mockFetchSequence([
      { status: 401 }, // initial request rejected
      { json: { access_token: "new-at", refresh_token: "rt-2" } }, // /auth/refresh
      { json: { data: 42 } }, // retried request
    ]);
    const out = await api.get<{ data: number }>("/data");
    expect(out).toEqual({ data: 42 });
    expect(getAccessToken()).toBe("new-at");
    expect(localStorage.getItem("refresh_token")).toBe("rt-2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(authHeader(fetchMock.mock.calls[2])).toBe("Bearer new-at");
  });

  it("bootstraps from refresh_token on reload (no in-memory token)", async () => {
    // Hard refresh: access token is gone but the refresh_token persists.
    setAccessToken(null);
    localStorage.setItem("refresh_token", "rt-boot");
    mockFetchSequence([
      { status: 401 },
      { json: { access_token: "boot-at", refresh_token: "rt-boot2" } },
      { json: { user: "x" } },
    ]);
    const out = await api.get<{ user: string }>("/auth/me");
    expect(out).toEqual({ user: "x" });
    expect(getAccessToken()).toBe("boot-at");
  });

  it("clears the session and throws on 401 with no refresh token", async () => {
    setAccessToken("expired"); // no refresh_token in localStorage
    window.history.pushState({}, "", "/login"); // public path -> no navigation attempt
    mockFetchSequence([{ status: 401 }]);
    await expect(api.get("/data")).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
  });

  it("surfaces non-401 errors as ApiError without refreshing", async () => {
    setAccessToken("tok");
    const fetchMock = mockFetchSequence([{ status: 400, json: { error: "bad input" } }]);
    await expect(api.get("/data")).rejects.toMatchObject({ status: 400, message: "bad input" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt
  });
});
