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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CheckCircle2, Circle, Copy, Globe, Inbox, Plus, RefreshCw, Trash2, Users } from "lucide-react";
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["domains"] });
      const key = ["domains", currentOrg?.id, page];
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: PaginatedResponse<Domain> | undefined) =>
        old ? { ...old, data: old.data.filter((d) => d.id !== id) } : old
      );
      return { prev, key };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["domains"] }),
    onSuccess: () => toast.success("Domain removed"),
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const filtered = data?.data?.filter((d) => d.domain_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Domains</h1>
        <AddDomainDialog orgId={currentOrg.id} />
      </div>

      <Input placeholder="Filter domains…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />

      {isError ? <ErrorState message="Failed to load domains" onRetry={() => refetch()} /> :
      isLoading ? <DomainGridSkeleton /> : (
      <>
        {(!filtered || filtered.length === 0) ? (
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
                  verifying={verify.isPending}
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

function VerificationBadge({ verified, label }: { verified: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      {verified
        ? <CheckCircle2 className="h-4 w-4 text-green-500" />
        : <Circle className="h-4 w-4 text-muted-foreground" />
      }
      <span className={verified ? "text-green-600" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

function DomainCard({ domain: d, onVerify, onDelete, verifying }: { domain: Domain; onVerify: () => void; onDelete: () => void; verifying: boolean }) {
  const fullyVerified = d.mx_verified && d.txt_verified;
  const copyRecord = () => {
    if (d.verification_record) {
      copyToClipboard(d.verification_record);
      toast.success("Verification record copied");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link href={`/domains/${d.id}`}>
              <CardTitle className="text-sm font-mono truncate hover:underline cursor-pointer">{d.domain_name}</CardTitle>
            </Link>
            <CardDescription className="text-xs mt-0.5">
              Added {new Date(d.created_at).toLocaleDateString()}
            </CardDescription>
          </div>
          {fullyVerified ? (
            <Badge className="shrink-0 bg-green-100 text-green-700 border-green-200">Verified</Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0">Pending</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* DNS status */}
        <div className="flex items-center gap-4">
          <VerificationBadge verified={d.mx_verified} label="MX" />
          <VerificationBadge verified={d.txt_verified} label="TXT" />
        </div>

        {/* Verification record hint */}
        {!d.txt_verified && d.verification_record && (
          <button onClick={copyRecord} className="w-full rounded-md bg-muted px-3 py-2 text-left text-xs font-mono break-all hover:bg-muted/80 transition-colors group">
            <span className="text-muted-foreground">TXT: </span>
            {d.verification_record}
            <Copy className="inline-block ml-1 h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1" title="Active inboxes">
            <Inbox className="h-3.5 w-3.5" /> {d.active_inboxes ?? 0} inboxes
          </span>
          <span className="flex items-center gap-1" title="Assigned teams">
            <Users className="h-3.5 w-3.5" /> {d.team_count ?? 0} teams
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {!fullyVerified && (
            <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={onVerify} disabled={verifying}>
              <RefreshCw className={`h-3.5 w-3.5 ${verifying ? "animate-spin" : ""}`} /> Verify DNS
            </Button>
          )}
          <Link href={`/domains/${d.id}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Details
            </Button>
          </Link>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
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

function DomainGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/3 mt-1" /></CardHeader>
          <CardContent className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-8 w-full" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

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
    <Dialog open={open} onOpenChange={setOpen}>
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
