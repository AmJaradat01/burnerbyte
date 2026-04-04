"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Check, CheckCircle2, Circle, Copy, ExternalLink, Globe, Inbox, Plus, RefreshCw, Search, Shield, Trash2, Users } from "lucide-react";
import type { Domain, PaginatedResponse } from "@/types";

export default function DomainsPage() {
  const { currentOrg } = useOrgStore();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["domains", currentOrg?.id, page],
    queryFn: () => api.get<PaginatedResponse<Domain>>(`/orgs/${currentOrg!.id}/domains`, { page: String(page), per_page: "20" }),
    enabled: !!currentOrg,
  });

  const verify = useMutation({
    mutationFn: (id: string) => api.post(`/orgs/${currentOrg!.id}/domains/${id}/verify`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domains"] }); toast.success("DNS verification triggered"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/domains/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domains"] }); toast.success("Domain removed"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const domains = data?.data ?? [];
  const filtered = search ? domains.filter((d) => d.domain_name.toLowerCase().includes(search.toLowerCase())) : domains;
  const totalDomains = data?.total ?? 0;
  const verifiedCount = domains.filter((d) => d.mx_verified && d.txt_verified).length;
  const pendingCount = domains.length - verifiedCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Domains</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totalDomains > 0 ? `${totalDomains} domain${totalDomains !== 1 ? "s" : ""} · ${verifiedCount} verified · ${pendingCount} pending` : "Manage your email domains"}
          </p>
        </div>
        <AddDomainDialog orgId={currentOrg.id} />
      </div>

      {/* Summary cards */}
      {totalDomains > 0 && (
        <div className="grid gap-3 grid-cols-3">
          <MiniStat icon={Globe} label="Total" value={totalDomains} accent="text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400" />
          <MiniStat icon={CheckCircle2} label="Verified" value={verifiedCount} accent="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400" />
          <MiniStat icon={Shield} label="Pending" value={pendingCount} accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400" />
        </div>
      )}

      {/* Search */}
      {totalDomains > 3 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Filter domains…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      )}

      {/* Domain list */}
      {isError ? <ErrorState message="Failed to load domains" onRetry={() => refetch()} /> :
      isLoading ? <DomainGridSkeleton /> : (
      <>
        {filtered.length === 0 ? (
          <EmptyState
            icon="🌐"
            title={search ? "No matching domains" : "No domains yet"}
            description={search ? "Try a different search term." : "Add your first domain to start receiving emails."}
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((d) => (
                <DomainCard
                  key={d.id}
                  domain={d}
                  onVerify={() => verify.mutate(d.id)}
                  onDelete={() => remove.mutate(d.id)}
                  verifying={verify.isPending && verify.variables === d.id}
                />
              ))}
            </div>
            <Pagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
          </>
        )}
      </>
      )}
    </div>
  );
}

/* ── Mini stat ── */

function MiniStat({ icon: Icon, label, value, accent }: { icon: typeof Globe; label: string; value: number; accent: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">{label}</span>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

/* ── Domain card ── */

function DomainCard({ domain: d, onVerify, onDelete, verifying }: { domain: Domain; onVerify: () => void; onDelete: () => void; verifying: boolean }) {
  const [copied, setCopied] = useState(false);
  const fullyVerified = d.mx_verified && d.txt_verified;

  const copyRecord = () => {
    if (d.verification_record) {
      copyToClipboard(d.verification_record);
      setCopied(true);
      toast.success("Verification record copied");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card className="group hover:shadow-md hover:border-primary/20 transition-all">
      <CardContent className="pt-4 pb-3 space-y-3">
        {/* Domain name + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link href={`/domains/${d.id}`} className="flex items-center gap-1.5 group/link">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono text-sm font-semibold truncate group-hover/link:text-primary transition-colors">{d.domain_name}</span>
              <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover/link:opacity-100 transition-opacity shrink-0" />
            </Link>
            <p className="text-[11px] text-muted-foreground mt-0.5 pl-[22px]">
              Added {new Date(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
          {fullyVerified ? (
            <Badge className="shrink-0 gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0 gap-1">
              <Circle className="h-3 w-3" /> Pending
            </Badge>
          )}
        </div>

        {/* DNS verification status */}
        <div className="flex items-center gap-3 pl-[22px]">
          <DnsChip verified={d.mx_verified} label="MX" />
          <DnsChip verified={d.txt_verified} label="TXT" />
        </div>

        {/* Verification record hint */}
        {!d.txt_verified && d.verification_record && (
          <button onClick={copyRecord} className="w-full rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-left text-[11px] font-mono break-all hover:bg-muted/60 transition-colors group/copy">
            <span className="text-muted-foreground">TXT → </span>
            <span className="text-foreground/80">{d.verification_record}</span>
            {copied
              ? <Check className="inline-block ml-1.5 h-3 w-3 text-green-500" />
              : <Copy className="inline-block ml-1.5 h-3 w-3 text-muted-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity" />
            }
          </button>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pl-[22px]">
          <span className="flex items-center gap-1">
            <Inbox className="h-3 w-3" /> {d.active_inboxes ?? 0} inbox{(d.active_inboxes ?? 0) !== 1 ? "es" : ""}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" /> {d.team_count ?? 0} team{(d.team_count ?? 0) !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-1 border-t">
          {!fullyVerified && (
            <Button variant="outline" size="sm" className="gap-1.5 flex-1 h-8 text-xs" onClick={onVerify} disabled={verifying}>
              <RefreshCw className={`h-3 w-3 ${verifying ? "animate-spin" : ""}`} /> Verify DNS
            </Button>
          )}
          <Link href={`/domains/${d.id}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 text-xs">
              <Globe className="h-3 w-3" /> Manage
            </Button>
          </Link>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            }
            title="Remove domain?"
            description={`This will remove ${d.domain_name} and all its team assignments.`}
            onConfirm={onDelete}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/* ── DNS chip ── */

function DnsChip({ verified, label }: { verified: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
      verified
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
        : "bg-muted text-muted-foreground"
    }`}>
      {verified ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      {label}
    </span>
  );
}

/* ── Skeleton ── */

function DomainGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-4 pb-3 space-y-3">
            <div className="flex justify-between"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-5 w-16 rounded-full" /></div>
            <div className="flex gap-2"><Skeleton className="h-5 w-12 rounded-full" /><Skeleton className="h-5 w-12 rounded-full" /></div>
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ── Add domain dialog ── */

function AddDomainDialog({ orgId }: { orgId: string }) {
  const [domain, setDomain] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();

  const handleAdd = async () => {
    if (!domain.trim()) return;
    setAdding(true);
    try {
      await api.post(`/orgs/${orgId}/domains`, { domain_name: domain.trim().toLowerCase() });
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.success("Domain added — configure DNS records to verify");
      setOpen(false);
      setDomain("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setDomain(""); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Add Domain</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a domain</DialogTitle>
          <DialogDescription>Enter the domain you want to receive emails on. You&apos;ll need to add DNS records to verify ownership.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Domain name</Label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <p className="text-xs text-muted-foreground">Don&apos;t include http:// or www — just the bare domain.</p>
          </div>
          <Button onClick={handleAdd} className="w-full" disabled={!domain.trim() || adding}>
            {adding ? "Adding…" : "Add Domain"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
