import { create } from "zustand";
import { api } from "@/lib/api";
import type { User, TokenPair } from "@/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const res = await api.post<{ user: User; tokens: TokenPair }>("/auth/login", { email, password });
    localStorage.setItem("access_token", res.tokens.access_token);
    localStorage.setItem("refresh_token", res.tokens.refresh_token);
    set({ user: res.user, loading: false });
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
    } catch {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      set({ user: null, loading: false });
    }
  },
}));
