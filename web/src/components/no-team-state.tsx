"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/empty-state";

/**
 * Shown on team-scoped pages (webhooks, API keys) when there is no current team.
 * Since the first team auto-selects, this means the organization has no teams
 * yet, so the path forward is to create one. `resource` is the plural noun for
 * the page (e.g. "Webhooks", "API keys").
 */
export function NoTeamState({ resource }: { resource: string }) {
  const router = useRouter();
  return (
    <EmptyState
      title="No team yet"
      description={`${resource} belong to a team. Create your first team to get started.`}
      action={{ label: "Go to Teams", onClick: () => router.push("/teams") }}
    />
  );
}
