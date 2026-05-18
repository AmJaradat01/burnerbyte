import { create } from "zustand";
import { api, ApiError, setAccessToken, getAccessToken } from "@/lib/api";
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
  register: (email: string, password: string, displayName: string) => Promise<void>;
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
      const res = await api.post<{ user: User; tokens: TokenPair }>("/auth/login", { email, password });
      setAccessToken(res.tokens.access_token);
      // refresh_token stays in localStorage — TODO: move to httpOnly cookie
      localStorage.setItem("refresh_token", res.tokens.refresh_token);
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

  register: async (email, password, display_name) => {
    const res = await api.post<{ user: User; tokens: TokenPair }>("/auth/register", { email, password, display_name });
    setAccessToken(res.tokens.access_token);
    // refresh_token stays in localStorage — TODO: move to httpOnly cookie
    localStorage.setItem("refresh_token", res.tokens.refresh_token);
    set({ user: res.user, loading: false });
  },

  logout: async () => {
    const token = getAccessToken();
    if (token) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"}/auth/sessions`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      } catch {
        // proceed with logout even if revocation fails
      } finally {
        clearTimeout(timeout);
      }
    }
    setAccessToken(null);
    localStorage.removeItem("refresh_token");
    set({ user: null });
    window.location.href = "/login";
  },

  fetchMe: async () => {
    try {
      // If no access token in memory, check if we have a refresh token to bootstrap
      const token = getAccessToken() || (typeof window !== "undefined" ? localStorage.getItem("refresh_token") : null);
      if (!token) { set({ loading: false }); return; }
      const user = await api.get<User>("/auth/me");
      set({ user, loading: false });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setAccessToken(null);
        localStorage.removeItem("refresh_token");
      }
      set({ user: null, loading: false });
    }
  },

  clearSessionConflict: () => {
    set({ sessionConflict: null });
  },
}));
