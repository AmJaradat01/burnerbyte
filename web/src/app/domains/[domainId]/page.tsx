"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { NoOrgState } from "@/components/no-org-state";
import { useOrgStore } from "@/stores/org-store";
import { copyToClipboard } from "@/lib/clipboard";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCircle2, Circle, Clock, Copy, FileText, Globe, Inbox, RefreshCw } from "lucide-react";
import type { Domain, DomainAssignment, Team } from "@/types";

/* ── Copy helper ── */

function CopyableValue({ value, ariaLabel }: { value: string; ariaLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyToClipboard(value);
    setCopied(true);
    toast.success("Copied");
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-2 rounded-md bg-muted/50 border px-3 py-1.5 font-mono text-sm break-all text-left hover:bg-muted transition-colors duration-150 group flex-1 min-w-0 w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label={ariaLabel ?? `Copy ${value}`}
    >
      <span className="flex-1 truncate">{value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0" aria-hidden="true" />
      )}
    </button>
  );
}

/* ── DNS record card ── */

function DnsRecordCard({ title, icon: Icon, description, verified, records }: {
  title: string; icon: typeof Globe; description: string; verified: boolean;
  records: { label: string; value: string }[];
}) {
  return (
    <Card className={cn(verified ? "" : "border-dashed border-warning/30")}>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
              verified ? "bg-success/10" : "bg-warning/10",
            )}
            aria-hidden="true"
          >
            <Icon className={cn("h-4 w-4", verified ? "text-success" : "text-warning")} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-title">{title}</h3>
              {verified ? (
                <Badge variant="success" className="gap-1 text-[10px]">
                  <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" /> Verified
                </Badge>
              ) : (
                <Badge variant="warning" className="gap-1 text-[10px]">
                  <Circle className="h-2.5 w-2.5" aria-hidden="true" /> Pending
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>

        {/* Step instruction for pending records */}
        {!verified && (
          <div className="rounded-lg bg-warning/5 border border-warning/15 px-3 py-2 text-xs text-warning space-y-1">
            <p>Add the following record to your DNS provider, then click &quot;Verify DNS Records&quot; below.</p>
            <p className="text-warning/70">Some providers use <span className="font-mono">@</span> for the Host field when adding records to the root domain.</p>
          </div>
        )}

        <dl className="space-y-1.5">
          {records.map((r) => (
            <div key={r.label} className="flex items-center gap-3">
              <dt className="text-xs text-muted-foreground font-medium w-16 shrink-0">{r.label}</dt>
              <dd className="flex-1 min-w-0">
                <CopyableValue value={r.value} ariaLabel={`Copy ${title} ${r.label}: ${r.value}`} />
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
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
      await Promise.all(teams.map(async (team) => {
        try {
          const res = await api.get<{ data: DomainAssignment[] }>(`/orgs/${org!.id}/teams/${team.id}/domains`, { per_page: "200" });
          const match = res.data?.find((a) => a.domain_id === domainId);
          if (match) results.push({ team, assignment: match });
        } catch { /* team may not be accessible */ }
      }));
      return results;
    },
    enabled: !!org && teams.length > 0,
  });

  if (!org) return <NoOrgState />;
  if (isError) return <ErrorState message="Failed to load domain" onRetry={() => refetch()} />;

  const allVerified = domain?.mx_verified && domain?.txt_verified;

  const verifiedCount = domain ? [domain.mx_verified, domain.txt_verified].filter(Boolean).length : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <Link
          href="/domains"
          className="flex h-9 w-9 items-center justify-center rounded-lg border bg-card hover:bg-accent transition-colors duration-150 shrink-0"
          aria-label="Back to domains"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        {isLoading ? (
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ) : domain ? (
          <>
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0" aria-hidden="true">
              <Globe className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-headline font-mono">{domain.domain_name}</h1>
                {allVerified ? (
                  <Badge variant="success" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Verified
                  </Badge>
                ) : (
                  <Badge variant="warning" className="gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" /> Setup required
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                {domain.active_inboxes ?? 0} active · {domain.inboxes_created_count ?? 0} created · {domain.team_count ?? 0} {(domain.team_count ?? 0) === 1 ? "team" : "teams"}
                {" · Added "}
                {timeAgo(domain.created_at)}
                {domain.dns_last_checked_at && (
                  <> · DNS checked {timeAgo(domain.dns_last_checked_at)}</>
                )}
              </p>
            </div>
            {!allVerified && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 ml-auto"
                onClick={() => verify.mutate()}
                disabled={verify.isPending}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", verify.isPending && "animate-spin")} aria-hidden="true" />
                Verify DNS
              </Button>
            )}
          </>
        ) : null}
      </header>

      {domain && (
        <>
          {/* DNS Configuration section */}
          <section className="space-y-4" aria-labelledby="dns-config-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 id="dns-config-heading" className="text-title">DNS Configuration</h2>
                <p className="text-sm text-muted-foreground">
                  {allVerified
                    ? <>Your DNS records for <span className="font-mono">{domain.domain_name}</span> are correctly configured.</>
                    : <>Add these records to your DNS provider for <span className="font-mono">{domain.domain_name}</span>.</>
                  }
                </p>
              </div>
              {allVerified ? (
                <Badge variant="success" className="gap-1 text-xs">
                  <CheckCircle2 className="h-3 w-3" /> All records verified
                </Badge>
              ) : (
                <div className="text-sm tabular-nums text-muted-foreground">
                  {verifiedCount} of 2 verified
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <DnsRecordCard
                title="MX Record"
                icon={Inbox}
                description={allVerified ? `Routing email to ${domain.domain_name}` : `Routes incoming email for ${domain.domain_name}`}
                verified={domain.mx_verified}
                records={[
                  { label: "Type", value: "MX" },
                  { label: "Host", value: domain.domain_name },
                  { label: "Priority", value: "10" },
                  { label: "Value", value: domain.mx_target || "mail.burnerbyte.com" },
                ]}
              />
              <DnsRecordCard
                title="TXT Record"
                icon={FileText}
                description={allVerified ? "Domain ownership confirmed" : "Verifies domain ownership"}
                verified={domain.txt_verified}
                records={[
                  { label: "Type", value: "TXT" },
                  { label: "Host", value: domain.domain_name },
                  { label: "Value", value: domain.verification_record || "" },
                ]}
              />
            </div>

            {/* Actions: only show verify button when NOT fully verified */}
            {!allVerified && (
              <div className="flex items-center gap-3 flex-wrap">
                <Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending} className="gap-1.5">
                  <RefreshCw className={cn("h-3.5 w-3.5", verify.isPending && "animate-spin")} aria-hidden="true" />
                  {verify.isPending ? "Checking…" : "Verify DNS Records"}
                </Button>
                {needsPoll && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
                    Auto-checking every 30s
                  </span>
                )}
              </div>
            )}

            {/* Verified: show last-checked time and re-check option */}
            {allVerified && domain.dns_last_checked_at && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  Last verified {timeAgo(domain.dns_last_checked_at)}
                </span>
                <button
                  onClick={() => verify.mutate()}
                  disabled={verify.isPending}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 underline underline-offset-2"
                >
                  {verify.isPending ? "Re-checking…" : "Re-check"}
                </button>
              </div>
            )}
          </section>

          {/* Supporting context: teams, details, settings */}
          <section className="grid gap-6 lg:grid-cols-3" aria-label="Domain context">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-title">Assigned Teams</CardTitle>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {teamAssignments.data?.length ?? 0}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {teamAssignments.isLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                  </div>
                ) : teamAssignments.data && teamAssignments.data.length > 0 ? (
                  <div className="space-y-2">
                    {teamAssignments.data.map(({ team, assignment }) => (
                      <Link
                        key={team.id}
                        href="/teams"
                        className="flex items-center justify-between rounded-lg border px-3 py-2.5 hover:bg-accent/50 transition-colors duration-150 group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0" aria-hidden="true">
                            {team.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate group-hover:text-primary transition-colors duration-150">{team.name}</p>
                            <p className="text-[11px] text-muted-foreground tabular-nums">
                              {team.member_count} {team.member_count === 1 ? "member" : "members"}
                            </p>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">{assignment.access_level}</Badge>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={Globe}
                    title="No teams assigned"
                    description="Assign this domain to a team to start creating inboxes."
                    variant="compact"
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-title">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  <DetailRow label="Domain ID" value={domain.id} mono />
                  <DetailRow
                    label="Created"
                    value={new Date(domain.created_at).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
                  />
                  <DetailRow label="MX Target" value={domain.mx_target || "—"} mono />
                </div>
              </CardContent>
            </Card>

            <DomainSettingsCard domain={domain} orgId={org!.id} />
          </section>
        </>
      )}
    </div>
  );
}

/* ── Detail row ── */

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0 gap-4">
      <span className="text-sm font-medium text-muted-foreground shrink-0">{label}</span>
      <span className={cn("text-sm truncate max-w-[60%] text-right", mono && "font-mono text-xs")}>{value}</span>
    </div>
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
      qc.invalidateQueries({ queryKey: ["domain", orgId, d.id] });
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
        <CardTitle className="text-title">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="domain-attachments">Attachments</Label>
          <Select value={attachments} onValueChange={setAttachments}>
            <SelectTrigger id="domain-attachments" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit from org</SelectItem>
              <SelectItem value="enabled">Enabled</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Controls whether email attachments are stored for inboxes on this domain.</p>
        </div>
        {dirty && (
          <Button onClick={save} disabled={saving} size="sm" className="w-full">
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
