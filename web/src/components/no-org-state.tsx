"use client";

import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { EmptyState } from "@/components/empty-state";
import { Building2 } from "lucide-react";

/**
 * Shown on org-scoped pages when there is no current organization. Replaces the
 * old bare "Select an organization first." dead-end with a path forward: a system
 * admin can create the first organization; anyone else needs an invitation. With
 * the onboarding gate in place a zero-org user is normally redirected to
 * /onboarding, so this is the safety net for deep links and the brief moment
 * before the org is resolved.
 */
export function NoOrgState() {
  const router = useRouter();
  const isSystemAdmin = useAuthStore((s) => s.user?.is_system_admin);

  if (isSystemAdmin) {
    return (
      <EmptyState
        icon={Building2}
        title="No organization yet"
        description="Create your first organization to start adding domains, teams, and inboxes."
        action={{ label: "Create organization", onClick: () => router.push("/onboarding") }}
      />
    );
  }

  return (
    <EmptyState
      icon={Building2}
      title="No organization"
      description="You are not a member of any organization yet. Ask an admin to invite you; once you accept, it will appear here."
    />
  );
}
