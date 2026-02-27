import { create } from "zustand";
import { api } from "@/lib/api";
import type { Organization, Team } from "@/types";

interface OrgState {
  orgs: Organization[];
  currentOrg: Organization | null;
  teams: Team[];
  currentTeam: Team | null;
  fetchOrgs: () => Promise<void>;
  setCurrentOrg: (org: Organization) => void;
  fetchTeams: (orgId: string) => Promise<void>;
  setCurrentTeam: (team: Team) => void;
}

export const useOrgStore = create<OrgState>((set) => ({
  orgs: [],
  currentOrg: null,
  teams: [],
  currentTeam: null,

  fetchOrgs: async () => {
    const res = await api.get<{ data: Organization[] }>("/orgs");
    set({ orgs: res.data ?? [] });
  },

  setCurrentOrg: (org) => set({ currentOrg: org, teams: [], currentTeam: null }),

  fetchTeams: async (orgId) => {
    const res = await api.get<{ data: Team[] }>(`/orgs/${orgId}/teams`);
    set({ teams: res.data ?? [] });
  },

  setCurrentTeam: (team) => set({ currentTeam: team }),
}));
