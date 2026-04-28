import { create } from "zustand";
import { api, ApiError } from "@/lib/api";
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
      localStorage.setItem("access_token", res.tokens.access_token);
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
    localStorage.setItem("access_token", res.tokens.access_token);
    localStorage.setItem("refresh_token", res.tokens.refresh_token);
    set({ user: res.user, loading: false });
  },

  logout: async () => {
    // Revoke all server sessions before clearing local state
    const token = localStorage.getItem("access_token");
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
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    set({ user: null });
    window.location.href = "/login";
  },

  fetchMe: async () => {
    try {
      const token = localStorage.getItem("access_token");
      if (!token) { set({ loading: false }); return; }
      const user = await api.get<User>("/auth/me");
      set({ user, loading: false });
    } catch (err) {
      // Only clear tokens on auth errors (401/403), not on network errors
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
      }
      set({ user: null, loading: false });
    }
  },

  clearSessionConflict: () => {
    set({ sessionConflict: null });
  },
}));
