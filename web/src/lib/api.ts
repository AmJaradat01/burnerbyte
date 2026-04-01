const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/api/v1/ws";

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
}

let refreshPromise: Promise<boolean> | null = null;

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { params, ...init } = opts;
  let url = `${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  // Only set Content-Type for requests with a body
  if (init.body) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { ...init, headers });

  if (res.status === 401 && token) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, opts);
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
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
    throw new ApiError(body.error || res.statusText, res.status);
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
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      localStorage.setItem("access_token", data.access_token);
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
  constructor(message: string, public status: number) {
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
