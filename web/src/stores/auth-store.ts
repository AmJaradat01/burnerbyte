import { create } from "zustand";
import { api, ApiError, setAccessToken, getAccessToken, setSessionHint, hasSession, API_BASE } from "@/lib/api";
import type { User, TokenPair, Session } from "@/types";

export interface SessionConflictState {
  pendingToken: string;
  sessions: Session[];
  limit: number;
}

interface SessionConflictResponse {
  pending_token: string;
  sessions: Session[];
  limit: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  sessionConflict: SessionConflictState | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, inviteToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
  clearSessionConflict: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  sessionConflict: null,

  login: async (email, password) => {
    try {
      // use_cookie: the refresh token arrives as an httpOnly cookie and never
      // touches script-readable storage.
      const res = await api.post<{ user: User; tokens: TokenPair }>("/auth/login", { email, password, use_cookie: true });
      setAccessToken(res.tokens.access_token);
      setSessionHint(true);
      set({ user: res.user, loading: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const conflict = err.data as SessionConflictResponse;
        set({
          sessionConflict: {
            pendingToken: conflict.pending_token,
            sessions: conflict.sessions,
            limit: conflict.limit,
          },
        });
        return;
      }
      throw err;
    }
  },

  register: async (email, password, display_name, inviteToken) => {
    const res = await api.post<{ user: User; tokens: TokenPair }>("/auth/register", { email, password, display_name, invite_token: inviteToken, use_cookie: true });
    setAccessToken(res.tokens.access_token);
    setSessionHint(true);
    set({ user: res.user, loading: false });
  },

  logout: async () => {
    // POST /auth/logout revokes this device's session chain via the httpOnly
    // cookie and expires it server-side (scripts can't clear the cookie). It
    // needs no access token, so sign-out works even with a long-dead session.
    // Legacy pre-cookie sessions hand in their stored token for revocation.
    const legacyToken = typeof window !== "undefined" ? localStorage.getItem("refresh_token") : null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(legacyToken ? { refresh_token: legacyToken } : {}),
        signal: controller.signal,
      });
    } catch {
      // proceed with logout even if revocation fails
    } finally {
      clearTimeout(timeout);
    }
    setAccessToken(null);
    localStorage.removeItem("refresh_token");
    setSessionHint(false);
    set({ user: null });
    window.location.href = "/login";
  },

  fetchMe: async () => {
    try {
      // Without an access token in memory, only bootstrap when a session
      // plausibly exists (cookie hint or a legacy refresh token).
      if (!getAccessToken() && !hasSession()) { set({ loading: false }); return; }
      const user = await api.get<User>("/auth/me");
      set({ user, loading: false });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setAccessToken(null);
        localStorage.removeItem("refresh_token");
        setSessionHint(false);
      }
      set({ user: null, loading: false });
    }
  },

  clearSessionConflict: () => {
    set({ sessionConflict: null });
  },
}));
