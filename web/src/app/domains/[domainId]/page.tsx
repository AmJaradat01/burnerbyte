"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { toast } from "sonner";
import { Check, Copy, CheckCircle2, Clock, ArrowLeft } from "lucide-react";
import type { Domain, DomainAssignment, Team } from "@/types";

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
      <span className="flex-1">{value}</span>
      <button
        onClick={() => { copyToClipboard(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Copy"
      >
        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function StatusBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Verified</Badge>
  ) : (
    <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>
  );
}

export default function DomainDetailPage() {
  const { domainId } = useParams<{ domainId: string }>();
  const org = useOrgStore((s) => s.currentOrg);
  const teams = useOrgStore((s) => s.teams);
  const qc = useQueryClient();

  const { data: domain, isLoading, isError, refetch } = useQuery({
    queryKey: ["domain", org?.id, domainId],
    queryFn: () => api.get<Domain>(`/orgs/${org!.id}/domains/${domainId}`),
    enabled: !!org,
  });

  const needsPoll = domain && (!domain.mx_verified || !domain.txt_verified);
  useEffect(() => {
    if (!needsPoll) return;
    const iv = setInterval(() => qc.invalidateQueries({ queryKey: ["domain", org?.id, domainId] }), 30000);
    return () => clearInterval(iv);
  }, [needsPoll, qc, org?.id, domainId]);

  const verify = useMutation({
    mutationFn: () => api.post(`/orgs/${org!.id}/domains/${domainId}/verify`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domain", org?.id, domainId] }); toast.success("Verification triggered"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const teamAssignments = useQuery({
    queryKey: ["domain-teams", org?.id, domainId],
    queryFn: async () => {
      const results: { team: Team; assignment: DomainAssignment }[] = [];
      for (const team of teams) {
        try {
          const res = await api.get<{ data: DomainAssignment[] }>(`/orgs/${org!.id}/teams/${team.id}/domains`);
          const match = res.data?.find((a) => a.domain_id === domainId);
          if (match) results.push({ team, assignment: match });
        } catch { /* skip */ }
      }
      return results;
    },
    enabled: !!org && teams.length > 0,
  });

  if (!org) return <p className="text-muted-foreground">Select an organization.</p>;
  if (isError) return <ErrorState message="Failed to load domain" onRetry={() => refetch()} />;

  const allVerified = domain?.mx_verified && domain?.txt_verified;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/domains" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-bold">{isLoading ? <Skeleton className="h-8 w-48" /> : domain?.domain_name}</h1>
        {domain && (allVerified
          ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Fully Verified</Badge>
          : <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Setup Required</Badge>
        )}
      </div>

      {domain && (
        <>
          {/* DNS Records */}
          <Card>
            <CardHeader>
              <CardTitle>DNS Records</CardTitle>
              <p className="text-sm text-muted-foreground">
                Add these records to your DNS provider for <strong>{domain.domain_name}</strong>
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* MX Record */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">MX Record</span>
                    <StatusBadge verified={domain.mx_verified} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Routes incoming email for {domain.domain_name} to your mail server
                </p>
                <div className="grid gap-2 text-sm">
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                    <span className="text-muted-foreground">Type</span>
                    <CopyValue value="MX" />
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                    <span className="text-muted-foreground">Name</span>
                    <CopyValue value={domain.domain_name} />
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                    <span className="text-muted-foreground">Priority</span>
                    <CopyValue value="10" />
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                    <span className="text-muted-foreground">Value</span>
                    <CopyValue value={domain.mx_target || "mail.example.com"} />
                  </div>
                </div>
              </div>

              <hr />

              {/* TXT Record */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">TXT Record</span>
                    <StatusBadge verified={domain.txt_verified} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Verifies domain ownership
                </p>
                <div className="grid gap-2 text-sm">
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                    <span className="text-muted-foreground">Type</span>
                    <CopyValue value="TXT" />
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                    <span className="text-muted-foreground">Name</span>
                    <CopyValue value={domain.domain_name} />
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-2 items-center">
                    <span className="text-muted-foreground">Value</span>
                    <CopyValue value={domain.verification_record || ""} />
                  </div>
                </div>
              </div>

              <hr />

              {/* Verify button */}
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}>
                  {verify.isPending ? "Verifying…" : "Verify DNS Records"}
                </Button>
                {needsPoll && <span className="text-xs text-muted-foreground">Auto-checking every 30s…</span>}
                {domain.dns_last_checked_at && (
                  <span className="text-xs text-muted-foreground">
                    Last checked: {new Date(domain.dns_last_checked_at).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Assigned Teams */}
          <Card>
            <CardHeader><CardTitle>Assigned Teams</CardTitle></CardHeader>
            <CardContent>
              {teamAssignments.isLoading ? (
                <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
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

          {/* Details */}
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Domain ID:</span> <code className="text-xs">{domain.id}</code></p>
              <p><span className="text-muted-foreground">Created:</span> {new Date(domain.created_at).toLocaleString()}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
