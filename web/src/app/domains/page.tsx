"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { NoOrgState } from "@/components/no-org-state";
import { copyToClipboard } from "@/lib/clipboard";
import { timeAgo } from "@/lib/time";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp,
  Circle, Copy, ExternalLink, Globe, Loader2, Plus, RefreshCw,
  Search, Trash2, X,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Domain, PaginatedResponse } from "@/types";

type StatusFilter = "all" | "verified" | "pending";
type SortOption = "name-asc" | "name-desc" | "newest" | "oldest" | "most-inboxes";

export default function DomainsPage() {
  const { currentOrg, hasPermission } = useOrgStore();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");

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
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/domains/${id}?force=true`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domains"] }); toast.success("Domain removed"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const domains = useMemo(() => data?.data ?? [], [data?.data]);
  const totalDomains = data?.total ?? 0;
  const verifiedCount = domains.filter((d) => d.mx_verified && d.txt_verified).length;
  const pendingCount = domains.length - verifiedCount;
  const totalInboxes = domains.reduce((sum, d) => sum + (d.active_inboxes ?? 0), 0);

  const filtered = useMemo(() => {
    let result = domains;
    if (search) result = result.filter((d) => d.domain_name.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter === "verified") result = result.filter((d) => d.mx_verified && d.txt_verified);
    else if (statusFilter === "pending") result = result.filter((d) => !d.mx_verified || !d.txt_verified);
    result = [...result].sort((a, b) => {
      switch (sort) {
        case "name-asc": return a.domain_name.localeCompare(b.domain_name);
        case "name-desc": return b.domain_name.localeCompare(a.domain_name);
        case "newest": return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "oldest": return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "most-inboxes": return (b.active_inboxes ?? 0) - (a.active_inboxes ?? 0);
        default: return 0;
      }
    });
    return result;
  }, [domains, search, statusFilter, sort]);

  if (!currentOrg) return <NoOrgState />;
  const isAdmin = hasPermission("org.domains.manage") || user?.is_system_admin;
  if (!isAdmin) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access this page.</p></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0" aria-hidden="true">
            <Globe className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-headline">Domains</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {totalDomains > 0
                ? `${totalDomains} ${totalDomains === 1 ? "domain" : "domains"} · ${verifiedCount} verified, ${pendingCount} pending · ${totalInboxes} active ${totalInboxes === 1 ? "inbox" : "inboxes"}`
                : "Add a domain to start receiving email."}
            </p>
          </div>
        </div>
        <AddDomainDialog orgId={currentOrg.id} />
      </header>

      {/* Filters */}
      {totalDomains > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Filter domains…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Filter domains by name"
            />
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1" role="tablist" aria-label="Status filter">
              {(["all", "verified", "pending"] as const).map((s) => {
                const count = s === "all" ? domains.length : s === "verified" ? verifiedCount : pendingCount;
                return (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                      statusFilter === s
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    {s === "all" ? "All" : s === "verified" ? "Verified" : "Pending"}
                    <span className="tabular-nums opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
              <SelectTrigger className="w-[150px] h-8 text-xs" aria-label="Sort domains">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">Name A-Z</SelectItem>
                <SelectItem value="name-desc">Name Z-A</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="most-inboxes">Most Inboxes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Domain list */}
      {isError ? <ErrorState message="Failed to load domains" onRetry={() => refetch()} /> :
      isLoading ? <DomainListSkeleton /> : (
      <>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Globe}
            title={search ? "No matching domains" : "No domains yet"}
            description={search ? "Try a different search term." : "Add a domain to start receiving email."}
          >
            {!search && (
              <div className="mt-5">
                <AddDomainDialog orgId={currentOrg.id} />
              </div>
            )}
          </EmptyState>
        ) : (
          <>
            {/* Desktop: table view */}
            <div className="hidden sm:block rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-medium">Domain</TableHead>
                    <TableHead className="text-xs font-medium">Status</TableHead>
                    <TableHead className="text-xs font-medium">DNS</TableHead>
                    <TableHead className="text-xs font-medium text-right">Inboxes</TableHead>
                    <TableHead className="text-xs font-medium">Added</TableHead>
                    <TableHead className="text-xs font-medium w-[100px]"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d) => (
                    <DomainTableRow
                      key={d.id}
                      domain={d}
                      onVerify={() => verify.mutate(d.id)}
                      onDelete={() => remove.mutate(d.id)}
                      verifying={verify.isPending && verify.variables === d.id}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked rows */}
            <div className="sm:hidden rounded-xl border divide-y">
              {filtered.map((d) => (
                <DomainMobileRow
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

/* ── Desktop table row ── */

function DomainTableRow({ domain: d, onVerify, onDelete, verifying }: {
  domain: Domain; onVerify: () => void; onDelete: () => void; verifying: boolean;
}) {
  const fullyVerified = d.mx_verified && d.txt_verified;

  return (
    <TableRow className="group">
      {/* Domain name */}
      <TableCell>
        <Link href={`/domains/${d.id}`} className="inline-flex items-center gap-2 group/link">
          <span className={cn(
            "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
            fullyVerified ? "bg-primary/10" : "bg-muted",
          )}>
            <Globe className={cn("h-3.5 w-3.5", fullyVerified ? "text-primary" : "text-muted-foreground")} />
          </span>
          <span className="font-mono text-sm font-medium group-hover/link:text-primary transition-colors duration-150">
            {d.domain_name}
          </span>
        </Link>
      </TableCell>

      {/* Status */}
      <TableCell>
        {fullyVerified ? (
          <Badge variant="success" className="gap-1 text-[10px]">
            <CheckCircle2 className="h-2.5 w-2.5" /> Verified
          </Badge>
        ) : (
          <Badge variant="warning" className="gap-1 text-[10px]">
            <Circle className="h-2.5 w-2.5" /> Pending
          </Badge>
        )}
      </TableCell>

      {/* DNS chips */}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <DnsChip verified={d.mx_verified} label="MX" />
          <DnsChip verified={d.txt_verified} label="TXT" />
        </div>
      </TableCell>

      {/* Inboxes */}
      <TableCell className="text-right">
        <span className="text-sm tabular-nums">{d.active_inboxes ?? 0}</span>
        <span className="text-xs text-muted-foreground ml-1">/ {d.inboxes_created_count ?? 0}</span>
      </TableCell>

      {/* Added */}
      <TableCell>
        <span className="text-xs text-muted-foreground">{timeAgo(d.created_at)}</span>
      </TableCell>

      {/* Actions */}
      <TableCell>
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {!fullyVerified && (
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onVerify} disabled={verifying} aria-label="Verify DNS">
              <RefreshCw className={cn("h-3.5 w-3.5", verifying && "animate-spin")} />
            </Button>
          )}
          <Link href={`/domains/${d.id}`}>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Manage domain">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <DeleteDomainDialog domain={d} onConfirm={onDelete} />
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ── Mobile stacked row ── */

function DomainMobileRow({ domain: d, onVerify, onDelete, verifying }: {
  domain: Domain; onVerify: () => void; onDelete: () => void; verifying: boolean;
}) {
  const fullyVerified = d.mx_verified && d.txt_verified;

  return (
    <div className="px-4 py-3 space-y-2">
      {/* Top: name + status */}
      <div className="flex items-center justify-between gap-2">
        <Link href={`/domains/${d.id}`} className="flex items-center gap-2 min-w-0 group/link">
          <span className={cn(
            "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
            fullyVerified ? "bg-primary/10" : "bg-muted",
          )}>
            <Globe className={cn("h-3.5 w-3.5", fullyVerified ? "text-primary" : "text-muted-foreground")} />
          </span>
          <span className="font-mono text-sm font-medium truncate group-hover/link:text-primary transition-colors duration-150">
            {d.domain_name}
          </span>
        </Link>
        {fullyVerified ? (
          <Badge variant="success" className="gap-1 text-[10px] shrink-0">
            <CheckCircle2 className="h-2.5 w-2.5" /> Verified
          </Badge>
        ) : (
          <Badge variant="warning" className="gap-1 text-[10px] shrink-0">
            <Circle className="h-2.5 w-2.5" /> Pending
          </Badge>
        )}
      </div>

      {/* Middle: meta row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <DnsChip verified={d.mx_verified} label="MX" />
          <DnsChip verified={d.txt_verified} label="TXT" />
        </div>
        <span className="tabular-nums">{d.active_inboxes ?? 0} active</span>
        <span className="ml-auto">{timeAgo(d.created_at)}</span>
      </div>

      {/* Bottom: actions */}
      <div className="flex items-center gap-1.5 pt-1">
        {!fullyVerified && (
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs flex-1" onClick={onVerify} disabled={verifying}>
            <RefreshCw className={cn("h-3 w-3", verifying && "animate-spin")} />
            {verifying ? "Verifying" : "Verify DNS"}
          </Button>
        )}
        <Link href={`/domains/${d.id}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full h-7 gap-1 text-xs">
            <ExternalLink className="h-3 w-3" /> Manage
          </Button>
        </Link>
        <DeleteDomainDialog domain={d} onConfirm={onDelete} />
      </div>
    </div>
  );
}

/* ── DNS chip (compact) ── */

function DnsChip({ verified, label }: { verified: boolean; label: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
      verified ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
    )}>
      {verified ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Circle className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

/* ── Skeleton ── */

function DomainListSkeleton() {
  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="divide-y">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-7 w-7 rounded-md shrink-0" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-16 rounded-full ml-4" />
            <div className="flex gap-1.5 ml-4">
              <Skeleton className="h-5 w-10 rounded-full" />
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
            <Skeleton className="h-4 w-12 ml-auto" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Delete domain dialog with impact preview ── */

interface DomainImpact {
  active_inboxes: number;
  total_emails: number;
  inboxes: {
    id: string;
    address: string;
    full_address: string;
    created_by_email: string;
    email_count: number;
    expires_at: string;
  }[];
}

function DeleteDomainDialog({ domain: d, onConfirm }: { domain: Domain; onConfirm: () => void }) {
  const { currentOrg } = useOrgStore();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [expanded, setExpanded] = useState(false);

  const { data: impact, isLoading } = useQuery({
    queryKey: ["domain-impact", d.id],
    queryFn: () => api.get<DomainImpact>(`/orgs/${currentOrg!.id}/domains/${d.id}/impact`),
    enabled: open && !!currentOrg,
  });

  const handleDelete = () => {
    onConfirm();
    setOpen(false);
    setConfirmText("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setConfirmText(""); setExpanded(false); } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" aria-label={`Delete ${d.domain_name}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete {d.domain_name}
          </DialogTitle>
          <DialogDescription>
            This will permanently delete the domain, all inboxes, emails, and attachments.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : impact && impact.active_inboxes > 0 ? (
            <>
              <div className="rounded-lg border border-warning/20 bg-warning/5 p-3 text-sm text-warning flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>This domain has <strong>{impact.active_inboxes}</strong> active inbox{impact.active_inboxes !== 1 ? "es" : ""} receiving email ({impact.total_emails} total email{impact.total_emails !== 1 ? "s" : ""})</span>
              </div>
              <div>
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150"
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {expanded ? "Hide" : "Show"} affected inboxes
                </button>
                {expanded && (
                  <div className="mt-2 rounded-lg border max-h-48 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Address</TableHead>
                          <TableHead className="text-xs">Created By</TableHead>
                          <TableHead className="text-xs text-right">Emails</TableHead>
                          <TableHead className="text-xs text-right">Expires</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {impact.inboxes.map((inbox) => (
                          <TableRow key={inbox.id}>
                            <TableCell className="text-xs font-mono">{inbox.address}</TableCell>
                            <TableCell className="text-xs">{inbox.created_by_email}</TableCell>
                            <TableCell className="text-xs text-right">{inbox.email_count}</TableCell>
                            <TableCell className="text-xs text-right">{new Date(inbox.expires_at).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          ) : impact ? (
            <div className="rounded-lg border border-success/20 bg-success/5 p-3 text-sm text-success flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              No active inboxes on this domain
            </div>
          ) : null}

          <div className="space-y-2">
            <Label className="text-sm">Type <span className="font-mono font-semibold">{d.domain_name}</span> to confirm deletion</Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={d.domain_name}
            />
          </div>

          <Button
            variant="destructive"
            className="w-full gap-1.5"
            disabled={confirmText !== d.domain_name}
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
            Delete Domain
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Add domain dialog ── */

function sanitizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return d;
}

function validateDomain(input: string): string | null {
  if (!input) return null;
  if (input.length > 253) return "Domain too long (max 253 characters)";
  if (!input.includes(".")) return "Domain must contain at least one dot";
  const labels = input.split(".");
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld)) return "Invalid TLD: must be at least 2 letters";
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return "Each label must be 1-63 characters";
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return "Labels must be alphanumeric (hyphens allowed, not at start/end)";
  }
  return null;
}

function AddDomainDialog({ orgId }: { orgId: string }) {
  const [rawInput, setRawInput] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();

  const domain = sanitizeDomain(rawInput);
  const error = domain ? validateDomain(domain) : null;
  const isValid = !!domain && !error;

  const handleAdd = async () => {
    if (!isValid) return;
    setAdding(true);
    try {
      await api.post(`/orgs/${orgId}/domains`, { domain_name: domain });
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.success("Domain added. Configure DNS records to verify.");
      setOpen(false);
      setRawInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setRawInput(""); }}>
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
            <div className="relative">
              <Input
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="example.com"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className={cn(
                  domain && (isValid ? "pr-9 border-success/40 focus-visible:ring-success/40" : "pr-9 border-destructive focus-visible:ring-destructive"),
                )}
              />
              {domain && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {isValid
                    ? <Check className="h-4 w-4 text-success" />
                    : <X className="h-4 w-4 text-destructive" />}
                </span>
              )}
            </div>
            {rawInput && domain !== rawInput.trim().toLowerCase() && (
              <p className="text-xs text-muted-foreground">Will be added as: <span className="font-mono">{domain}</span></p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">Don&apos;t include http:// or www. Just the bare domain (e.g. example.com)</p>
          </div>

          <Button onClick={handleAdd} className="w-full" disabled={!isValid || adding}>
            {adding ? "Adding…" : "Add Domain"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
