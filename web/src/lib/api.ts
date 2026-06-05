const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/api/v1/ws";

// Access token is kept in memory only — never persisted to localStorage.
// This mitigates XSS token theft. On page reload the app will use the
// refresh_token (localStorage) to obtain a new access_token.
let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  // Internal: set on the retried request after a token refresh so a dead
  // session can't trigger an endless refresh loop.
  _retry?: boolean;
}

let refreshPromise: Promise<boolean> | null = null;

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { params, _retry, ...init } = opts;
  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }

  const token = _accessToken;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  // Only set Content-Type for requests with a body
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { ...init, headers });

  // Attempt a refresh on any 401 — including the page-reload bootstrap, where
  // there is no in-memory token yet but a refresh_token sits in localStorage.
  // tryRefresh() returns false when there is no refresh_token, so this can't
  // loop; _retry caps it at a single retry.
  if (res.status === 401 && !_retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, _retry: true });
    if (typeof window !== "undefined") {
      _accessToken = null;
      localStorage.removeItem("refresh_token");
      const publicPrefixes = ["/login", "/register", "/invite", "/setup", "/onboarding", "/verify-email", "/forgot-password", "/reset-password"];
      const isPublic = publicPrefixes.some((p) => window.location.pathname.startsWith(p));
      if (!isPublic) {
        window.location.href = "/login";
      }
    }
    throw new ApiError("session expired", 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || res.statusText, res.status, body);
  }

  // Handle 204 No Content and empty responses
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return res.json();
}

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    // refresh_token remains in localStorage for now.
    // TODO: Move to httpOnly cookie once backend supports Set-Cookie on /auth/refresh.
    const refreshToken = typeof window !== "undefined" ? localStorage.getItem("refresh_token") : null;
    if (!refreshToken) return false;

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      _accessToken = data.access_token;
      localStorage.setItem("refresh_token", data.refresh_token);
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message);
  }
}

export const api = {
  get: <T>(path: string, params?: Record<string, string>) =>
    request<T>(path, { params }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body !== undefined ? JSON.stringify(body) : undefined }),
};

/** Fetch a short-lived one-time ticket for WebSocket authentication. */
export async function getWsTicket(): Promise<string> {
  const { ticket } = await api.post<{ ticket: string }>("/ws/ticket");
  return ticket;
}
