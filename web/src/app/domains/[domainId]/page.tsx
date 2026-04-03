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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, Circle, Clock, Copy, Globe, Inbox, RefreshCw, Shield, Users } from "lucide-react";
import type { Domain, DomainAssignment, Team } from "@/types";

/* ── Copy helper ── */

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { copyToClipboard(value); setCopied(true); toast.success("Copied"); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="grid grid-cols-[72px_1fr] gap-2 items-center">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <button onClick={copy} className="flex items-center gap-2 rounded-lg bg-muted/50 border px-3 py-1.5 font-mono text-sm break-all text-left hover:bg-muted transition-colors group">
        <span className="flex-1">{value}</span>
        {copied ? <Check className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />}
      </button>
    </div>
  );
}

/* ── DNS record section ── */

function DnsRecordSection({ title, description, verified, records }: {
  title: string; description: string; verified: boolean; records: { label: string; value: string }[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{title}</span>
          {verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 text-[11px] font-medium">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 text-[11px] font-medium">
              <Circle className="h-3 w-3" /> Pending
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="space-y-1.5">
        {records.map((r) => <CopyValue key={r.label} label={r.label} value={r.value} />)}
      </div>
    </div>
  );
}

/* ── Main page ── */

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
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/domains" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {isLoading ? <Skeleton className="h-8 w-48" /> : (
          <>
            <Globe className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold font-mono">{domain?.domain_name}</h1>
            {allVerified ? (
              <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                <CheckCircle2 className="h-3 w-3" /> Verified
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <Clock className="h-3 w-3" /> Setup Required
              </Badge>
            )}
          </>
        )}
      </div>

      {domain && (
        <>
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-3">
            <QuickStat icon={Inbox} label="Active Inboxes" value={domain.active_inboxes ?? 0} accent="text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400" />
            <QuickStat icon={Users} label="Teams" value={domain.team_count ?? 0} accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400" />
            <QuickStat icon={Shield} label="DNS Status" value={allVerified ? "✓ OK" : `${[domain.mx_verified, domain.txt_verified].filter(Boolean).length}/2`} accent={allVerified ? "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400" : "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400"} />
          </div>

          {/* DNS Records */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">DNS Configuration</CardTitle>
              <p className="text-sm text-muted-foreground">
                Add these records to your DNS provider for <strong className="font-mono">{domain.domain_name}</strong>
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <DnsRecordSection
                title="MX Record"
                description={`Routes incoming email for ${domain.domain_name} to your mail server`}
                verified={domain.mx_verified}
                records={[
                  { label: "Type", value: "MX" },
                  { label: "Name", value: domain.domain_name },
                  { label: "Priority", value: "10" },
                  { label: "Value", value: domain.mx_target || "mail.burnerbyte.com" },
                ]}
              />

              <div className="border-t" />

              <DnsRecordSection
                title="TXT Record"
                description="Verifies domain ownership"
                verified={domain.txt_verified}
                records={[
                  { label: "Type", value: "TXT" },
                  { label: "Name", value: domain.domain_name },
                  { label: "Value", value: domain.verification_record || "" },
                ]}
              />

              <div className="border-t" />

              {/* Verify action */}
              <div className="flex items-center gap-3 flex-wrap">
                <Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending} className="gap-1.5">
                  <RefreshCw className={`h-3.5 w-3.5 ${verify.isPending ? "animate-spin" : ""}`} />
                  {verify.isPending ? "Checking…" : "Verify DNS Records"}
                </Button>
                {needsPoll && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                    </span>
                    Auto-checking every 30s
                  </span>
                )}
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
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Assigned Teams</CardTitle>
            </CardHeader>
            <CardContent>
              {teamAssignments.isLoading ? (
                <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : teamAssignments.data && teamAssignments.data.length > 0 ? (
                <div className="space-y-2">
                  {teamAssignments.data.map(({ team, assignment }) => (
                    <div key={team.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {team.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{team.name}</p>
                          <p className="text-[11px] text-muted-foreground">{team.member_count} member{team.member_count !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[11px]">{assignment.access_level}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-2">Not assigned to any teams yet. Go to Teams → Domains to assign.</p>
              )}
            </CardContent>
          </Card>

          {/* Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[100px_1fr] gap-y-2 gap-x-3 text-sm">
                <dt className="text-muted-foreground">Domain ID</dt>
                <dd className="font-mono text-xs truncate">{domain.id}</dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(domain.created_at).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</dd>
                <dt className="text-muted-foreground">MX Target</dt>
                <dd className="font-mono text-xs">{domain.mx_target || "—"}</dd>
              </dl>
            </CardContent>
          </Card>

          {/* Domain Settings */}
          <DomainSettingsCard domain={domain} orgId={org!.id} />
        </>
      )}
    </div>
  );
}

/* ── Quick stat card ── */

function QuickStat({ icon: Icon, label, value, accent }: { icon: typeof Globe; label: string; value: number | string; accent: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-3 px-4">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-lg font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
          <p className="text-[11px] text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DomainSettingsCard({ domain: d, orgId }: { domain: Domain; orgId: string }) {
  const qc = useQueryClient();
  const [attachments, setAttachments] = useState(d.settings?.attachments_enabled ?? "inherit");
  const [saving, setSaving] = useState(false);

  const dirty = attachments !== (d.settings?.attachments_enabled ?? "inherit");

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/orgs/${orgId}/domains/${d.id}`, { settings: { attachments_enabled: attachments } });
      qc.invalidateQueries({ queryKey: ["domain", d.id] });
      toast.success("Domain settings updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Domain Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Attachments</Label>
          <Select value={attachments} onValueChange={setAttachments}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit from org</SelectItem>
              <SelectItem value="enabled">Enabled</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Controls whether email attachments are stored for inboxes on this domain.</p>
        </div>
        {dirty && (
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
