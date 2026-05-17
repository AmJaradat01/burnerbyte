"use client";

import { useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";
import { timeAgo } from "@/lib/time";
import {
  Activity, ChevronDown, ChevronRight, Clock, Copy, Download,
  Globe, Inbox, Key, Mail, Search, Shield, User, Users, Webhook,
} from "lucide-react";
import type { AuditEntry, PaginatedResponse } from "@/types";

/* ─── Constants ─── */

const RESOURCE_TYPES = ["user", "org", "team", "domain", "domain_assignment", "inbox", "email", "webhook", "api_key"];

const RESOURCE_LABELS: Record<string, string> = {
  user: "User",
  org: "Organization",
  team: "Team",
  domain: "Domain",
  domain_assignment: "Domain Assignment",
  inbox: "Inbox",
  email: "Email",
  webhook: "Webhook",
  api_key: "API Key",
};

const RESOURCE_ICONS: Record<string, typeof User> = {
  user: User,
  org: Shield,
  team: Users,
  domain: Globe,
  domain_assignment: Globe,
  inbox: Inbox,
  email: Mail,
  webhook: Webhook,
  api_key: Key,
};

/* Action color: the single signal carried on the action badge. Resource type uses
   a neutral icon swatch; timeline dots are neutral. One color signal per row,
   not three. */
const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  created:     { bg: "bg-success/10",     text: "text-success",     border: "border-success/20" },
  updated:     { bg: "bg-info/10",        text: "text-info",        border: "border-info/20" },
  deleted:     { bg: "bg-destructive/10", text: "text-destructive", border: "border-destructive/20" },
  revoked:     { bg: "bg-destructive/10", text: "text-destructive", border: "border-destructive/20" },
  verified:    { bg: "bg-success/10",     text: "text-success",     border: "border-success/20" },
  login:       { bg: "bg-primary/10",     text: "text-primary",     border: "border-primary/20" },
  logout:      { bg: "bg-muted",          text: "text-muted-foreground", border: "border-border" },
  invited:     { bg: "bg-primary/10",     text: "text-primary",     border: "border-primary/20" },
  accepted:    { bg: "bg-success/10",     text: "text-success",     border: "border-success/20" },
  migrated:    { bg: "bg-info/10",        text: "text-info",        border: "border-info/20" },
  archived:    { bg: "bg-muted",          text: "text-muted-foreground", border: "border-border" },
  restored:    { bg: "bg-success/10",     text: "text-success",     border: "border-success/20" },
  transferred: { bg: "bg-info/10",        text: "text-info",        border: "border-info/20" },
};

const DEFAULT_ACTION_COLOR = { bg: "bg-muted", text: "text-muted-foreground", border: "border-border" };

function getActionColor(action: string) {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return color;
  }
  return DEFAULT_ACTION_COLOR;
}

const QUICK_FILTERS: { label: string; value: string }[] = [
  { label: "Created",  value: "created"  },
  { label: "Updated",  value: "updated"  },
  { label: "Deleted",  value: "deleted"  },
  { label: "Login",    value: "login"    },
  { label: "Invited",  value: "invited"  },
  { label: "Settings", value: "settings" },
];

/* ─── Helpers ─── */

function exportCSV(entries: AuditEntry[]) {
  const header = "Time,Actor,Action,Resource Type,Resource ID,IP Address,Details";
  const rows = entries.map((e) =>
    [new Date(e.created_at).toISOString(), e.actor_email || e.actor_id, e.action, e.resource_type, e.resource_id, e.ip_address || "", e.metadata ? JSON.stringify(e.metadata) : ""]
      .map((v) => `"${(v ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("CSV exported");
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard"));
}

function getActorInitial(entry: AuditEntry): string {
  if (entry.actor_email) return entry.actor_email[0].toUpperCase();
  return "S";
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function isBeforeAfterMetadata(metadata: Record<string, unknown>): boolean {
  return (
    typeof metadata.before === "object" &&
    metadata.before !== null &&
    typeof metadata.after === "object" &&
    metadata.after !== null
  );
}

/* ─── Main Page ─── */

export default function AuditPage() {
  const { currentOrg, hasPermission } = useOrgStore();
  const { user } = useAuthStore();
  const [action, setAction] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [resource, setResource] = useState("");
  const [resourceName, setResourceName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const params: Record<string, string> = { page: String(page), per_page: "50" };
  if (action) params.action = action;
  if (actorEmail) params.actor_email = actorEmail;
  if (resource) params.resource_type = resource;
  if (resourceName) params.resource_name = resourceName;
  if (dateFrom) params.date_from = new Date(dateFrom).toISOString();
  if (dateTo) params.date_to = new Date(dateTo + "T23:59:59").toISOString();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit", currentOrg?.id, action, actorEmail, resource, resourceName, dateFrom, dateTo, page],
    queryFn: () => api.get<PaginatedResponse<AuditEntry>>(`/orgs/${currentOrg!.id}/audit`, params),
    enabled: !!currentOrg,
  });

  const clearFilters = () => { setAction(""); setActorEmail(""); setResource(""); setResourceName(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const hasFilters = action || actorEmail || resource || resourceName || dateFrom || dateTo;

  const handleQuickFilter = useCallback((value: string) => {
    setAction((prev) => (prev === value ? "" : value));
    setPage(1);
  }, []);

  const exportAll = async () => {
    if (!currentOrg) return;
    setExporting(true);
    try {
      const filterParams: Record<string, string> = {};
      if (action) filterParams.action = action;
      if (actorEmail) filterParams.actor_email = actorEmail;
      if (resource) filterParams.resource_type = resource;
      if (resourceName) filterParams.resource_name = resourceName;
      if (dateFrom) filterParams.date_from = new Date(dateFrom).toISOString();
      if (dateTo) filterParams.date_to = new Date(dateTo + "T23:59:59").toISOString();

      const first = await api.get<PaginatedResponse<AuditEntry>>(`/orgs/${currentOrg.id}/audit`, { ...filterParams, page: "1", per_page: "100" });
      let all = first.data ?? [];
      for (let p = 2; p <= (first.total_pages ?? 1); p++) {
        const res = await api.get<PaginatedResponse<AuditEntry>>(`/orgs/${currentOrg.id}/audit`, { ...filterParams, page: String(p), per_page: "100" });
        all = all.concat(res.data ?? []);
      }
      exportCSV(all);
    } catch {
      toast.error("Failed to export audit log");
    } finally {
      setExporting(false);
    }
  };

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const isAdmin = hasPermission("org.audit.view") || user?.is_system_admin;
  if (!isAdmin) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access this page.</p></div>;

  const uniqueActors = new Set(data?.data?.map((e) => e.actor_email)).size;
  const uniqueActions = new Set(data?.data?.map((e) => e.action)).size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0" aria-hidden="true">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-headline">Audit Log</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {(data?.total ?? 0) > 0
                ? `${data?.total} ${data?.total === 1 ? "entry" : "entries"}${hasFilters ? " (filtered)" : ""} · ${uniqueActions} ${uniqueActions === 1 ? "action" : "actions"}, ${uniqueActors} ${uniqueActors === 1 ? "actor" : "actors"} on this page`
                : "Track all actions across your organization."}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={exportAll}
          disabled={!data?.data?.length || exporting}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </header>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <Input
                value={action}
                onChange={(e) => { setAction(e.target.value); setPage(1); }}
                placeholder="e.g. domain.created"
                className="w-48 h-8 pl-8"
                aria-label="Filter by action"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Actor</Label>
            <div className="relative">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <Input
                value={actorEmail}
                onChange={(e) => { setActorEmail(e.target.value); setPage(1); }}
                placeholder="e.g. admin@example.com"
                className="w-48 h-8 pl-8"
                aria-label="Filter by actor email"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Resource</Label>
            <Select value={resource || "all"} onValueChange={(v) => { setResource(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-48 h-8" aria-label="Filter by resource type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All resources</SelectItem>
                {RESOURCE_TYPES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {RESOURCE_LABELS[r] || r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Email / Name</Label>
            <Input
              value={resourceName}
              onChange={(e) => { setResourceName(e.target.value); setPage(1); }}
              placeholder="e.g. 952yyl0m@gurl.ink"
              className="w-52 h-8"
              aria-label="Search by inbox address or resource name"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-40 h-8" aria-label="Filter from date" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-40 h-8" aria-label="Filter to date" />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
          )}
        </div>

        {/* Quick Filter Chips */}
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Quick action filter">
          <span className="text-xs text-muted-foreground mr-1">Quick:</span>
          {QUICK_FILTERS.map((qf) => {
            const isActive = action === qf.value;
            return (
              <button
                key={qf.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleQuickFilter(qf.value)}
                className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {qf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Entries */}
      {isError ? <ErrorState message="Failed to load audit log" onRetry={() => refetch()} /> :
      isLoading ? <AuditSkeleton /> : (
      <>
        {(!data?.data || data.data.length === 0) ? (
          <EmptyState title="No audit entries" description={hasFilters ? "Try adjusting your filters." : "Actions will appear here as they happen."} />
        ) : (
          <div>
            {/* Timeline container */}
            <div className="relative">
              {data.data.map((e, idx) => (
                <AuditRow
                  key={e.id}
                  entry={e}
                  isFirst={idx === 0}
                  isLast={idx === data.data.length - 1}
                />
              ))}
            </div>
            <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
          </div>
        )}
      </>
      )}
    </div>
  );
}


/* ─── Timeline Audit Row ─── */

function AuditRow({ entry: e, isFirst, isLast }: { entry: AuditEntry; isFirst: boolean; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = RESOURCE_ICONS[e.resource_type] || Shield;
  const actionColor = getActionColor(e.action);
  const actorInitial = getActorInitial(e);

  return (
    <div className="relative flex gap-4 group">
      {/* Timeline column: neutral dot, full-height line */}
      <div className="flex flex-col items-center w-8 shrink-0">
        {!isFirst && <div className="w-px flex-1 bg-border" aria-hidden="true" />}
        {isFirst && <div className="flex-1" />}
        <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/40 ring-4 ring-background shrink-0" aria-hidden="true" />
        {!isLast && <div className="w-px flex-1 bg-border" aria-hidden="true" />}
        {isLast && <div className="flex-1" />}
      </div>

      <div className="flex-1 mb-3">
        <Card
          className="cursor-pointer transition-colors"
          onClick={() => setExpanded(!expanded)}
          role="button"
          tabIndex={0}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setExpanded(!expanded); } }}
          aria-expanded={expanded}
          aria-label={`Audit entry ${e.action} on ${RESOURCE_LABELS[e.resource_type] || e.resource_type}`}
        >
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-3">
              {/* Resource icon: neutral swatch (action color is the single signal) */}
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0" aria-hidden="true">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>

              {/* Action badge: the one colored signal per row */}
              <Badge
                variant="outline"
                className={`shrink-0 text-xs ${actionColor.bg} ${actionColor.text} ${actionColor.border}`}
              >
                {e.action}
              </Badge>

              {/* Resource info */}
              <span className="text-sm truncate flex-1">
                <span className="text-muted-foreground">{RESOURCE_LABELS[e.resource_type] || e.resource_type} / </span>
                <span className="font-mono text-xs">{e.resource_id.slice(0, 8)}</span>
              </span>

              {/* Actor */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground" aria-hidden="true">
                  {actorInitial}
                </div>
                <span className="text-xs text-muted-foreground max-w-[140px] truncate">
                  {e.actor_email || (e.actor_id ? e.actor_id.slice(0, 8) : "system")}
                </span>
              </div>

              {e.ip_address && (
                <span className="text-xs font-mono text-muted-foreground shrink-0 hidden md:block tabular-nums">
                  {e.ip_address}
                </span>
              )}

              <div className="flex items-center gap-1 shrink-0" title={new Date(e.created_at).toLocaleString()}>
                <Clock className="h-3 w-3 text-muted-foreground hidden sm:block" aria-hidden="true" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {timeAgo(e.created_at)}
                </span>
              </div>

              <div className="shrink-0 text-muted-foreground" aria-hidden="true">
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
            </div>

            {expanded && <ExpandedDetails entry={e} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ─── Expanded Details Panel ─── */

function ExpandedDetails({ entry: e }: { entry: AuditEntry }) {
  return (
    <div className="mt-3 pt-3 border-t space-y-3" onClick={(ev) => ev.stopPropagation()}>
      {/* Info grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailField label="Actor" value={e.actor_email || e.actor_id} />
        <DetailField label="Resource ID" value={e.resource_id} mono copyable />
        <DetailField label="IP Address" value={e.ip_address || "—"} mono />
        <DetailField label="Timestamp" value={new Date(e.created_at).toLocaleString()} />
        <DetailField label="Resource Type" value={RESOURCE_LABELS[e.resource_type] || e.resource_type} />
        <DetailField label="Action" value={e.action} />
      </div>

      {/* Metadata */}
      {e.metadata && typeof e.metadata === "object" && Object.keys(e.metadata).length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Details</span>

          {isBeforeAfterMetadata(e.metadata) ? (
            <BeforeAfterDiff
              before={e.metadata.before as Record<string, unknown>}
              after={e.metadata.after as Record<string, unknown>}
            />
          ) : (
            <MetadataTable metadata={e.metadata} />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Detail Field ─── */

function DetailField({ label, value, mono, copyable }: { label: string; value: string; mono?: boolean; copyable?: boolean }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className={`text-sm truncate ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
        {copyable && (
          <button
            onClick={() => copyToClipboard(value)}
            className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
            title="Copy to clipboard"
          >
            <Copy className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Metadata Table ─── */

function MetadataTable({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <div className="rounded-lg border bg-muted/20 divide-y overflow-hidden">
      {Object.entries(metadata).map(([key, value]) => (
        <div key={key} className="flex items-start justify-between px-3 py-2 gap-4">
          <span className="text-xs text-muted-foreground shrink-0 capitalize">{key.replace(/_/g, " ")}</span>
          <span className="text-xs font-mono text-right break-all max-w-[65%]">
            {typeof value === "object" && value !== null ? (
              <pre className="text-[11px] whitespace-pre-wrap text-left bg-muted/50 rounded p-1.5 mt-0.5">
                {JSON.stringify(value, null, 2)}
              </pre>
            ) : (
              formatMetadataValue(value)
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Before/After Diff ─── */

function BeforeAfterDiff({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changedKeys = allKeys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));

  if (changedKeys.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        No changes detected in metadata.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[1fr_1fr_1fr] bg-muted/40 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium border-b">
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      {/* Rows */}
      <div className="divide-y">
        {changedKeys.map((key) => (
          <div key={key} className="grid grid-cols-[1fr_1fr_1fr] px-3 py-2 gap-2 text-xs">
            <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
            <span className="font-mono text-[11px] text-destructive bg-destructive/5 rounded px-1.5 py-0.5 break-all">
              {formatMetadataValue(before[key])}
            </span>
            <span className="font-mono text-[11px] text-success bg-success/5 rounded px-1.5 py-0.5 break-all">
              {formatMetadataValue(after[key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Skeleton ─── */

function AuditSkeleton() {
  return (
    <div className="relative">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="relative flex gap-4">
          <div className="flex flex-col items-center w-8 shrink-0">
            {i > 0 && <div className="w-px flex-1 bg-border" />}
            {i === 0 && <div className="flex-1" />}
            <div className="w-3 h-3 rounded-full bg-muted shrink-0 ring-4 ring-background" />
            {i < 7 && <div className="w-px flex-1 bg-border" />}
            {i === 7 && <div className="flex-1" />}
          </div>
          <div className="flex-1 mb-3">
            <Card>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <div className="flex-1" />
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ))}
    </div>
  );
}
