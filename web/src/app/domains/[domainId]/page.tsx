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
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, Circle, Clock, Copy, FileText, Globe, Inbox, Info, RefreshCw, Settings2, Shield, Users } from "lucide-react";
import type { Domain, DomainAssignment, Team } from "@/types";

/* ── Copy helper ── */

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { copyToClipboard(value); setCopied(true); toast.success("Copied"); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground font-medium w-16 shrink-0">{label}</span>
      <button onClick={copy} className="flex items-center gap-2 rounded-lg bg-muted/50 border px-3 py-1.5 font-mono text-sm break-all text-left hover:bg-muted transition-colors group flex-1 min-w-0">
        <span className="flex-1 truncate">{value}</span>
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />}
      </button>
    </div>
  );
}

/* ── DNS record section ── */

function DnsRecordSection({ title, icon: Icon, description, verified, records }: {
  title: string; icon: typeof Globe; description: string; verified: boolean; records: { label: string; value: string }[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${verified ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}>
          <Icon className={`h-3.5 w-3.5 ${verified ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} />
        </div>
        <span className="text-sm font-semibold">{title}</span>
        {verified ? (
          <Badge className="gap-1 text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
            <CheckCircle2 className="h-2.5 w-2.5" /> Verified
          </Badge>
        ) : (
          <Badge className="gap-1 text-[10px] bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800">
            <Circle className="h-2.5 w-2.5" /> Pending
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground pl-9">{description}</p>
      <div className="space-y-1.5 pl-9">
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
        <Link href="/domains" className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card hover:bg-accent transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {isLoading ? (
          <div className="flex items-center gap-3"><Skeleton className="h-7 w-48" /><Skeleton className="h-5 w-20 rounded-full" /></div>
        ) : (
          <>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{domain?.domain_name}</h1>
                {allVerified ? (
                  <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                    <CheckCircle2 className="h-3 w-3" /> Verified
                  </Badge>
                ) : (
                  <Badge className="gap-1 bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800">
                    <Clock className="h-3 w-3" /> Setup Required
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Added {new Date(domain?.created_at ?? "").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                {domain?.dns_last_checked_at && <> · Last checked {new Date(domain.dns_last_checked_at).toLocaleTimeString()}</>}
              </p>
            </div>
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
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-blue-100 dark:bg-blue-900/30">
                  <Globe className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-base">DNS Configuration</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Add these records to your DNS provider</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <DnsRecordSection
                title="MX Record"
                icon={Inbox}
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
                icon={FileText}
                description="Verifies domain ownership"
                verified={domain.txt_verified}
                records={[
                  { label: "Type", value: "TXT" },
                  { label: "Name", value: domain.domain_name },
                  { label: "Value", value: domain.verification_record || "" },
                ]}
              />

              <div className="border-t pt-1" />

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
              </div>
            </CardContent>
          </Card>

          {/* Assigned Teams */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-violet-100 dark:bg-violet-900/30">
                  <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <CardTitle className="text-base">Assigned Teams</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">{teamAssignments.data?.length ?? 0} team{(teamAssignments.data?.length ?? 0) !== 1 ? "s" : ""} using this domain</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {teamAssignments.isLoading ? (
                <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
              ) : teamAssignments.data && teamAssignments.data.length > 0 ? (
                <div className="space-y-2">
                  {teamAssignments.data.map(({ team, assignment }) => (
                    <Link key={team.id} href="/teams" className="flex items-center justify-between rounded-lg border px-3 py-2.5 hover:bg-accent/50 transition-colors group">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {team.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium group-hover:text-primary transition-colors">{team.name}</p>
                          <p className="text-[11px] text-muted-foreground">{team.member_count} member{team.member_count !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{assignment.access_level}</Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon="👥" title="No teams assigned" description="Assign this domain to a team to start creating inboxes." />
              )}
            </CardContent>
          </Card>

          {/* Details */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-900/30">
                  <Info className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                </div>
                <CardTitle className="text-base">Details</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                <DetailRow label="Domain ID" value={domain.id} mono />
                <DetailRow label="Created" value={new Date(domain.created_at).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })} />
                <DetailRow label="MX Target" value={domain.mx_target || "—"} mono />
              </div>
            </CardContent>
          </Card>

          {/* Domain Settings */}
          <DomainSettingsCard domain={domain} orgId={org!.id} />
        </>
      )}
    </div>
  );
}

/* ── Detail row ── */

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm ${mono ? "font-mono text-xs" : ""} truncate max-w-[60%] text-right`}>{value}</span>
    </div>
  );
}

/* ── Quick stat card ── */

function QuickStat({ icon: Icon, label, value, accent }: { icon: typeof Globe; label: string; value: number | string; accent: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">{label}</span>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="text-2xl font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
      </CardContent>
    </Card>
  );
}

/* ── Domain Settings ── */

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
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-amber-100 dark:bg-amber-900/30">
            <Settings2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <CardTitle className="text-base">Domain Settings</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Configure behavior for this domain</p>
          </div>
        </div>
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
