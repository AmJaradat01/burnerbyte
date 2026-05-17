"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { timeAgo } from "@/lib/time";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { DomainIllustration } from "@/components/illustrations";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, Copy, Globe, Inbox, Loader2, Plus, RefreshCw, Search, Shield, Trash2, Users, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Domain, PaginatedResponse } from "@/types";

type StatusFilter = "all" | "verified" | "pending";
type SortOption = "name-asc" | "name-desc" | "newest" | "oldest" | "most-inboxes";

export default function DomainsPage() {
  const { currentOrg, currentRole, hasPermission } = useOrgStore();
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

  const domains = data?.data ?? [];
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

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;
  const isAdmin = hasPermission("org.domains.manage") || user?.is_system_admin;
  if (!isAdmin) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access this page.</p></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-success/50/10 flex items-center justify-center">
                <Globe className="h-4 w-4 text-success" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight">Domains</h1>
                <p className="text-sm text-muted-foreground">
                  {totalDomains > 0 ? `${totalDomains} domain${totalDomains !== 1 ? "s" : ""} · ${verifiedCount} verified · ${pendingCount} pending · Manage your email domains.` : "Manage your email domains and DNS verification."}
                </p>
              </div>
            </div>
            <AddDomainDialog orgId={currentOrg.id} />
          </div>
        </CardContent>
      </Card>

      {/* Summary cards — 4 cards */}
      {totalDomains > 0 && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <MiniStat icon={Globe} label="Total" value={totalDomains} accent="text-info bg-info/10" />
          <MiniStat icon={CheckCircle2} label="Verified" value={verifiedCount} accent="text-success bg-success/10" />
          <MiniStat icon={Shield} label="Pending" value={pendingCount} accent="text-warning bg-warning/10" />
          <MiniStat icon={Inbox} label="Total Inboxes" value={totalInboxes} accent="text-primary bg-primary/10" />
        </div>
      )}

      {/* Search + Sort + Status filter */}
      {totalDomains > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Filter domains…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex items-center gap-2">
            {/* Status filter badges */}
            <div className="flex items-center gap-1">
              {(["all", "verified", "pending"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {s === "all" ? "All" : s === "verified" ? "Verified" : "Pending"}
                </button>
              ))}
            </div>
            {/* Sort dropdown */}
            <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
              <SelectTrigger className="w-[150px] h-8 text-xs">
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
      isLoading ? <DomainGridSkeleton /> : (
      <>
        {filtered.length === 0 ? (
          <EmptyState
            illustration={<DomainIllustration />}
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
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shadow-sm shrink-0 ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

/* ── Domain card ── */

function DomainCard({ domain: d, onVerify, onDelete, verifying }: {
  domain: Domain; onVerify: () => void; onDelete: () => void; verifying: boolean;
}) {
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
    <Card className={`group ${fullyVerified ? "" : "border-dashed"}`}>

      {/* Header with icon + domain name */}
      <CardContent className="pt-5 pb-0 pl-10">
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${fullyVerified ? "bg-success/10" : "bg-warning/10"}`}>
            <Globe className={`h-5 w-5 ${fullyVerified ? "text-success" : "text-warning"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <Link href={`/domains/${d.id}`} className="group/link">
              <span className="font-semibold text-sm truncate block group-hover/link:text-primary transition-colors">{d.domain_name}</span>
            </Link>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Added {new Date(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {fullyVerified ? (
              <Badge className="gap-1 text-[10px] bg-success/10 text-success border-success/20">
                <CheckCircle2 className="h-2.5 w-2.5" /> Verified
              </Badge>
            ) : (
              <Badge className="gap-1 text-[10px] bg-warning/10 text-warning border-warning/20">
                <Circle className="h-2.5 w-2.5" /> Pending
              </Badge>
            )}
          </div>
        </div>
      </CardContent>

      {/* DNS chips + stats */}
      <CardContent className="pt-3 pb-0">
        <div className="flex items-center gap-2 mb-3">
          <DnsChipWithCopy verified={d.mx_verified} label="MX" value={d.mx_target ?? "mail.burnerbyte.com"} />
          <DnsChipWithCopy verified={d.txt_verified} label="TXT" value={d.verification_record} />
          {d.dns_last_checked_at && (
            <span className="ml-auto text-[10px] text-muted-foreground" title={new Date(d.dns_last_checked_at).toLocaleString()}>
              {timeAgo(d.dns_last_checked_at)}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5">
          <div className="text-center">
            <p className="text-lg font-bold tabular-nums">{d.active_inboxes ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Active</p>
          </div>
          <div className="text-center border-x border-border/50">
            <p className="text-lg font-bold tabular-nums">{d.inboxes_created_count ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Created</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold tabular-nums">{d.team_count ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Teams</p>
          </div>
        </div>
      </CardContent>

      {/* TXT record hint for pending */}
      {!d.txt_verified && d.verification_record && (
        <CardContent className="pt-3 pb-0">
          <button onClick={copyRecord} className="w-full rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-left text-[11px] font-mono break-all hover:bg-muted/60 transition-colors group/copy">
            <span className="text-muted-foreground">TXT → </span>
            <span className="text-foreground/80">{d.verification_record}</span>
            {copied
              ? <Check className="inline-block ml-1.5 h-3 w-3 text-success" />
              : <Copy className="inline-block ml-1.5 h-3 w-3 text-muted-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity" />
            }
          </button>
        </CardContent>
      )}

      {/* Actions */}
      <CardContent className="pt-3 pb-4">
        <div className="flex items-center gap-1.5">
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
          <DeleteDomainDialog domain={d} onConfirm={onDelete} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ── DNS chip with copy ── */

function DnsChipWithCopy({ verified, label, value }: { verified: boolean; label: string; value?: string }) {
  const [justCopied, setJustCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!value) return;
    copyToClipboard(value);
    setJustCopied(true);
    toast.success(`${label} record copied`);
    setTimeout(() => setJustCopied(false), 2000);
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
      verified
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground"
    }`}>
      {verified ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
      {label}
      {value && (
        <button onClick={handleCopy} className="ml-0.5 hover:opacity-70 transition-opacity" title={`Copy ${label} record`}>
          {justCopied ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
        </button>
      )}
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
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive">
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
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
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
  if (!/^[a-z]{2,}$/.test(tld)) return "Invalid TLD — must be at least 2 letters";
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return "Each label must be 1–63 characters";
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
      toast.success("Domain added — configure DNS records to verify");
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
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Add a domain</DialogTitle>
              <DialogDescription>Enter the domain you want to receive emails on. You&apos;ll need to add DNS records to verify ownership.</DialogDescription>
            </div>
          </div>
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
                className={domain ? (isValid ? "pr-9 border-success/40 focus-visible:ring-success/40" : "pr-9 border-destructive focus-visible:ring-destructive") : ""}
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
            <p className="text-xs text-muted-foreground">Don&apos;t include http:// or www — just the bare domain (e.g. example.com)</p>
          </div>

          <Button onClick={handleAdd} className="w-full" disabled={!isValid || adding}>
            {adding ? "Adding…" : "Add Domain"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
