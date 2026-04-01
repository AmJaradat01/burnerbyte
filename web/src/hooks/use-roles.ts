import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface RoleInfo {
  value: string;
  label: string;
  description: string;
  rank: number;
}

interface RolesResponse {
  org_roles: RoleInfo[];
  team_roles: RoleInfo[];
}

export function useRoles() {
  const { data } = useQuery({
    queryKey: ["roles"],
    queryFn: () => api.get<RolesResponse>("/roles"),
    staleTime: Infinity, // Roles don't change at runtime
  });

  return {
    orgRoles: data?.org_roles ?? [],
    teamRoles: data?.team_roles ?? [],
  };
}
