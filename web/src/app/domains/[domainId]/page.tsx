"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import type { Domain, DomainAssignment, Team } from "@/types";

export default function DomainDetailPage() {
  const { domainId } = useParams<{ domainId: string }>();
  const org = useOrgStore((s) => s.currentOrg);
  const teams = useOrgStore((s) => s.teams);
  const qc = useQueryClient();

  const { data: domain, isLoading } = useQuery({
    queryKey: ["domain", org?.id, domainId],
    queryFn: () => api.get<Domain>(`/orgs/${org!.id}/domains/${domainId}`),
    enabled: !!org,
  });

  const verify = useMutation({
    mutationFn: () => api.post(`/orgs/${org!.id}/domains/${domainId}/verify`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domain", org?.id, domainId] }); toast.success("Verification triggered"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Find which teams have this domain assigned
  const teamAssignments = useQuery({
    queryKey: ["domain-teams", org?.id, domainId],
    queryFn: async () => {
      const results: { team: Team; assignment: DomainAssignment }[] = [];
      for (const team of teams) {
        try {
          const res = await api.get<{ data: DomainAssignment[] }>(`/orgs/${org!.id}/teams/${team.id}/domains`);
          const match = res.data?.find((a) => a.domain_id === domainId);
          if (match) results.push({ team, assignment: match });
        } catch { /* team may not have assignments */ }
      }
      return results;
    },
    enabled: !!org && teams.length > 0,
  });

  if (!org) return <p className="text-muted-foreground">Select an organization.</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/domains" className="text-sm text-muted-foreground hover:underline">← Domains</Link>
        <h1 className="text-2xl font-bold">{isLoading ? <Skeleton className="h-8 w-48" /> : domain?.domain_name}</h1>
      </div>

      {domain && (
        <>
          <Card>
            <CardHeader><CardTitle>DNS Verification</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-sm">MX Record:</span>
                <Badge variant={domain.mx_verified ? "default" : "secondary"}>
                  {domain.mx_verified ? "Verified" : "Pending"}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm">TXT Record:</span>
                <Badge variant={domain.txt_verified ? "default" : "secondary"}>
                  {domain.txt_verified ? "Verified" : "Pending"}
                </Badge>
              </div>
              {domain.verification_record && (
                <div className="rounded bg-muted p-3">
                  <p className="text-xs text-muted-foreground mb-1">Add this TXT record to your DNS:</p>
                  <code className="text-sm break-all">{domain.verification_record}</code>
                </div>
              )}
              <Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}>
                {verify.isPending ? "Verifying…" : "Re-verify DNS"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Assigned Teams</CardTitle></CardHeader>
            <CardContent>
              {teamAssignments.isLoading ? (
                <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : teamAssignments.data && teamAssignments.data.length > 0 ? (
                <ul className="space-y-2">
                  {teamAssignments.data.map(({ team }) => (
                    <li key={team.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline">{team.name}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Not assigned to any teams yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Domain ID:</span> <code>{domain.id}</code></p>
              <p><span className="text-muted-foreground">Created:</span> {new Date(domain.created_at).toLocaleString()}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
