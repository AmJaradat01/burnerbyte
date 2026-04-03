import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface RoleInfo {
  id: string;
  scope: string;
  value: string;
  label: string;
  description: string;
  rank: number;
  is_system: boolean;
  permissions: string[];
}

export interface PermissionInfo {
  id: string;
  scope: string;
  key: string;
  label: string;
  description: string;
}

interface RolesResponse {
  org_roles: RoleInfo[];
  team_roles: RoleInfo[];
  org_permissions: PermissionInfo[];
  team_permissions: PermissionInfo[];
}

export function useRoles() {
  const { data, refetch } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get<RolesResponse>("/roles"),
    staleTime: 60000,
  });

  return {
    orgRoles: data?.org_roles ?? [],
    teamRoles: data?.team_roles ?? [],
    orgPermissions: data?.org_permissions ?? [],
    teamPermissions: data?.team_permissions ?? [],
    refetch,
  };
}
