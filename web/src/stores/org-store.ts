import { create } from "zustand";
import { api } from "@/lib/api";
import type { Organization, Team, Membership } from "@/types";

interface OrgState {
  orgs: Organization[];
  currentOrg: Organization | null;
  currentRole: string | null;
  teams: Team[];
  currentTeam: Team | null;
  fetchOrgs: () => Promise<void>;
  setCurrentOrg: (org: Organization) => void;
  fetchTeams: (orgId: string) => Promise<void>;
  fetchRole: (orgId: string, userId: string) => Promise<void>;
  setCurrentTeam: (team: Team) => void;
}

export const useOrgStore = create<OrgState>((set) => ({
  orgs: [],
  currentOrg: null,
  currentRole: null,
  teams: [],
  currentTeam: null,

  fetchOrgs: async () => {
    const res = await api.get<{ data: Organization[] }>("/orgs");
    set({ orgs: res.data ?? [] });
  },

  setCurrentOrg: (org) => set({ currentOrg: org, currentRole: null, teams: [], currentTeam: null }),

  fetchRole: async (orgId, userId) => {
    try {
      const res = await api.get<{ data: Membership[] }>(`/orgs/${orgId}/members`, { page: "1", per_page: "100" });
      const me = res.data?.find((m) => m.user_id === userId);
      set({ currentRole: me?.role ?? "member" });
    } catch {
      set({ currentRole: "member" });
    }
  },

  fetchTeams: async (orgId) => {
    const res = await api.get<{ data: Team[] }>(`/orgs/${orgId}/teams`);
    const teams = res.data ?? [];
    set((state) => ({ teams, currentTeam: state.currentTeam ?? teams[0] ?? null }));
  },

  setCurrentTeam: (team) => set({ currentTeam: team }),
}));
