export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/api/v1/ws";

/** The API server's origin, without the /api/v1 prefix. The health endpoints
 *  (/healthz, /readyz) and /metrics are served at the root, not under the API
 *  version prefix, so they cannot be reached through API_BASE. A relative
 *  fetch("/readyz") hits the Next.js server instead and 404s. */
export const API_ORIGIN = API_BASE.replace(/\/api\/v1\/?$/, "");

// Access token is kept in memory only — never persisted to localStorage.
// This mitigates XSS token theft. The refresh token lives in an httpOnly
// cookie set by the backend (use_cookie mode), so no credential survives in
// script-readable storage; on page reload the cookie mints a new access token.
let _accessToken: string | null = null;

// The httpOnly cookie is invisible to JavaScript, so this non-sensitive flag
// records that a session exists. It only gates whether the app bothers
// attempting a refresh — the cookie itself remains the credential.
const SESSION_HINT_KEY = "bb_has_session";

export function setSessionHint(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) localStorage.setItem(SESSION_HINT_KEY, "1");
  else localStorage.removeItem(SESSION_HINT_KEY);
}

/** Whether a session plausibly exists: the cookie-era hint, or a legacy
 * pre-cookie refresh token that can still be migrated. */
export function hasSession(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SESSION_HINT_KEY) === "1" || localStorage.getItem("refresh_token") !== null;
}

function clearSessionState() {
  _accessToken = null;
  if (typeof window === "undefined") return;
  localStorage.removeItem("refresh_token"); // legacy pre-cookie storage
  localStorage.removeItem(SESSION_HINT_KEY);
}

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

  // Auth and setup endpoints exchange the httpOnly refresh cookie; everything
  // else stays credential-free so the cookie is never attached to (or relied
  // on by) regular API traffic.
  const withCredentials = path.startsWith("/auth/") || path.startsWith("/setup/");
  const res = await fetch(url, {
    ...init,
    headers,
    ...(withCredentials ? { credentials: "include" as const } : {}),
  });

  // Attempt a refresh on any 401 — including the page-reload bootstrap, where
  // there is no in-memory token yet but the refresh cookie persists.
  // tryRefresh() returns false when no session plausibly exists, so this
  // can't loop; _retry caps it at a single retry.
  if (res.status === 401 && !_retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, _retry: true });
    if (typeof window !== "undefined") {
      clearSessionState();
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
    if (typeof window === "undefined") return false;
    // Legacy sessions (pre-cookie deploys) still hold a refresh token in
    // localStorage. Hand it in once with use_cookie — the rotated token comes
    // back as an httpOnly cookie and the localStorage copy is retired.
    const legacyToken = localStorage.getItem("refresh_token");
    if (!legacyToken && localStorage.getItem(SESSION_HINT_KEY) !== "1") return false;

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(legacyToken ? { refresh_token: legacyToken, use_cookie: true } : { use_cookie: true }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      _accessToken = data.access_token;
      localStorage.removeItem("refresh_token");
      setSessionHint(true);
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

/* ── Public "try it" demo (landing page, unauthenticated) ──
   Plain fetch, deliberately bypassing the auth interceptor: these run for
   logged-out visitors and must never trigger the 401 refresh/redirect flow.
   They return null when demo mode is disabled or unreachable so the caller
   can fall back to the simulated demo. */

export interface TryInboxInfo {
  inbox_id: string;
  address: string;
  expires_at: string;
}

export interface TryEmail {
  id: string;
  from_address: string;
  subject?: string;
  snippet: string;
  received_at: string;
}

export async function tryGetStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/try/status`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.enabled === true;
  } catch {
    return false;
  }
}

export async function tryCreateInbox(): Promise<TryInboxInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/try/inbox`, { method: "POST" });
    if (!res.ok) return null;
    return (await res.json()) as TryInboxInfo;
  } catch {
    return null;
  }
}

export async function tryGetEmails(inboxId: string): Promise<TryEmail[] | null> {
  try {
    const res = await fetch(`${API_BASE}/try/inbox/${encodeURIComponent(inboxId)}/emails`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.emails ?? []) as TryEmail[];
  } catch {
    return null;
  }
}
