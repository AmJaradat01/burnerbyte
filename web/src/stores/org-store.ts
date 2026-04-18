import { create } from "zustand";
import { api } from "@/lib/api";
import type { Organization, Team, Membership } from "@/types";

interface RoleInfo {
  id: string;
  scope: string;
  value: string;
  label: string;
  description: string;
  rank: number;
  is_system: boolean;
  permissions: string[];
}

interface RolesResponse {
  org_roles: RoleInfo[];
  team_roles: RoleInfo[];
  org_permissions: unknown[];
  team_permissions: unknown[];
}

interface OrgState {
  orgs: Organization[];
  currentOrg: Organization | null;
  currentRole: string | null;
  permissions: string[];
  teams: Team[];
  currentTeam: Team | null;
  fetchOrgs: () => Promise<void>;
  setCurrentOrg: (org: Organization) => void;
  fetchTeams: (orgId: string) => Promise<void>;
  fetchRole: (orgId: string, userId: string) => Promise<void>;
  setCurrentTeam: (team: Team) => void;
  hasPermission: (key: string) => boolean;
}

export const useOrgStore = create<OrgState>((set, get) => ({
  orgs: [],
  currentOrg: null,
  currentRole: null,
  permissions: [],
  teams: [],
  currentTeam: null,

  fetchOrgs: async () => {
    const res = await api.get<{ data: Organization[] }>("/orgs");
    set({ orgs: res.data ?? [] });
  },

  setCurrentOrg: (org) => set({ currentOrg: org, currentRole: null, permissions: [], teams: [], currentTeam: null }),

  fetchRole: async (orgId, userId) => {
    try {
      const res = await api.get<{ data: Membership[] }>(`/orgs/${orgId}/members`, { page: "1", per_page: "10000" });
      const me = res.data?.find((m) => m.user_id === userId);
      const role = me?.role ?? "member";
      set({ currentRole: role });

      // Resolve permissions from the roles endpoint
      try {
        const rolesRes = await api.get<RolesResponse>("/roles");
        const matchingRole = rolesRes.org_roles?.find((r) => r.value === role);
        set({ permissions: matchingRole?.permissions ?? [] });
      } catch {
        set({ permissions: [] });
      }
    } catch {
      set({ currentRole: "member", permissions: [] });
    }
  },

  fetchTeams: async (orgId) => {
    const res = await api.get<{ data: Team[] }>(`/orgs/${orgId}/teams`);
    const teams = res.data ?? [];
    set((state) => {
      if (state.currentOrg?.id !== orgId) return state;
      return { teams, currentTeam: state.currentTeam ?? teams[0] ?? null };
    });
  },

  setCurrentTeam: (team) => set({ currentTeam: team }),

  hasPermission: (key: string) => {
    return get().permissions.includes(key);
  },
}));
