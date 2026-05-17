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
  Filter, Globe, Inbox, Key, LogIn, LogOut, Mail, Search, Shield,
  User, Users, Webhook,
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

const RESOURCE_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  user:              { bg: "bg-info/10",    text: "text-info",    ring: "ring-info/20" },
  org:               { bg: "bg-warning/10",   text: "text-warning",   ring: "ring-warning/20" },
  team:              { bg: "bg-primary/10",  text: "text-primary",  ring: "ring-primary/20" },
  domain:            { bg: "bg-success/10", text: "text-success", ring: "ring-success/20" },
  domain_assignment: { bg: "bg-info/10",    text: "text-info",    ring: "ring-info/20" },
  inbox:             { bg: "bg-info/10",     text: "text-info",     ring: "ring-info/20" },
  email:             { bg: "bg-primary/10",    text: "text-primary",    ring: "ring-primary/20" },
  webhook:           { bg: "bg-warning/10",  text: "text-warning",  ring: "ring-warning/20" },
  api_key:           { bg: "bg-destructive/10",    text: "text-destructive",    ring: "ring-destructive/20" },
};

const ACTION_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  created:     { bg: "bg-success/5",  text: "text-success", border: "border-success/20", dot: "bg-success/50" },
  updated:     { bg: "bg-info/5",     text: "text-info",    border: "border-info/20",    dot: "bg-info/50" },
  deleted:     { bg: "bg-destructive/5",      text: "text-destructive",     border: "border-destructive/20",     dot: "bg-destructive/50" },
  revoked:     { bg: "bg-destructive/5",      text: "text-destructive",     border: "border-destructive/20",     dot: "bg-destructive/50" },
  verified:    { bg: "bg-success/5",  text: "text-success", border: "border-success/20", dot: "bg-success/50" },
  login:       { bg: "bg-primary/5",   text: "text-primary",  border: "border-primary/20",  dot: "bg-primary" },
  logout:      { bg: "bg-primary/5",   text: "text-primary",  border: "border-primary/20",  dot: "bg-primary" },
  invited:     { bg: "bg-primary/5",   text: "text-primary",  border: "border-primary/20",  dot: "bg-primary" },
  accepted:    { bg: "bg-success/5",  text: "text-success", border: "border-success/20", dot: "bg-success/50" },
  migrated:    { bg: "bg-info/5",     text: "text-info",    border: "border-info/20",    dot: "bg-info" },
  archived:    { bg: "bg-muted/50",     text: "text-foreground",    border: "border-border",    dot: "bg-muted-foreground" },
  restored:    { bg: "bg-success/5",  text: "text-success", border: "border-success/20", dot: "bg-success/50" },
  transferred: { bg: "bg-info/5",     text: "text-info",    border: "border-info/20",    dot: "bg-info/50" },
};

const DEFAULT_ACTION_COLOR = { bg: "bg-muted/50", text: "text-foreground", border: "border-border", dot: "bg-muted-foreground" };

function getActionColor(action: string) {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return color;
  }
  return DEFAULT_ACTION_COLOR;
}

const QUICK_FILTERS: { label: string; value: string; color: string; activeColor: string; icon: typeof Activity }[] = [
  { label: "Created",  value: "created",  color: "text-success border-success/20 hover:bg-success/5", activeColor: "bg-success/10 text-success border-success/30", icon: Activity },
  { label: "Updated",  value: "updated",  color: "text-info border-info/20 hover:bg-info/5",         activeColor: "bg-info/10 text-info border-info/30",         icon: Activity },
  { label: "Deleted",  value: "deleted",  color: "text-destructive border-destructive/20 hover:bg-destructive/5",             activeColor: "bg-destructive/10 text-destructive border-destructive/30",             icon: Activity },
  { label: "Login",    value: "login",    color: "text-primary border-primary/20 hover:bg-primary/5",   activeColor: "bg-primary/10 text-primary border-primary/30",   icon: LogIn },
  { label: "Invited",  value: "invited",  color: "text-primary border-primary/20 hover:bg-primary/5",   activeColor: "bg-primary/10 text-primary border-primary/30",   icon: Activity },
  { label: "Settings", value: "settings", color: "text-muted-foreground border-border hover:bg-muted/50",       activeColor: "bg-muted text-foreground border-border",       icon: Activity },
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const params: Record<string, string> = { page: String(page), per_page: "50" };
  if (action) params.action = action;
  if (actorEmail) params.actor_email = actorEmail;
  if (resource) params.resource_type = resource;
  if (dateFrom) params.date_from = new Date(dateFrom).toISOString();
  if (dateTo) params.date_to = new Date(dateTo + "T23:59:59").toISOString();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit", currentOrg?.id, action, actorEmail, resource, dateFrom, dateTo, page],
    queryFn: () => api.get<PaginatedResponse<AuditEntry>>(`/orgs/${currentOrg!.id}/audit`, params),
    enabled: !!currentOrg,
  });

  const clearFilters = () => { setAction(""); setActorEmail(""); setResource(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const hasFilters = action || actorEmail || resource || dateFrom || dateTo;

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-warning/50/10 flex items-center justify-center">
                <Shield className="h-4 w-4 text-warning" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight">Audit Log</h1>
                <p className="text-sm text-muted-foreground">{data?.total ?? 0} entries{hasFilters ? " (filtered)" : ""} · Track all actions across your organization.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportAll} disabled={!data?.data?.length || exporting}>
              <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Total Entries</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-info/10">
                <Shield className="h-4 w-4 text-info" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">{data?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Actions (page)</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-success/10">
                <Activity className="h-4 w-4 text-success" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">{new Set(data?.data?.map(e => e.action)).size ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Actors (page)</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-warning/10">
                <Users className="h-4 w-4 text-warning" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">{new Set(data?.data?.map(e => e.actor_email)).size ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filters</span>
          </div>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Action</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="e.g. domain.created" className="w-48 h-8 pl-8" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Actor</Label>
              <div className="relative">
                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={actorEmail} onChange={(e) => { setActorEmail(e.target.value); setPage(1); }} placeholder="e.g. admin@example.com" className="w-48 h-8 pl-8" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Resource</Label>
              <Select value={resource || "all"} onValueChange={(v) => { setResource(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
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
              <Label className="text-xs">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-40 h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-40 h-8" />
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Filter Chips */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground self-center mr-1">Quick filters:</span>
        {QUICK_FILTERS.map((qf) => {
          const isActive = action === qf.value;
          return (
            <button
              key={qf.value}
              onClick={() => handleQuickFilter(qf.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150 cursor-pointer ${
                isActive ? qf.activeColor : qf.color
              }`}
            >
              <qf.icon className="h-3 w-3" />
              {qf.label}
            </button>
          );
        })}
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
  const resourceColor = RESOURCE_COLORS[e.resource_type] || { bg: "bg-muted", text: "text-muted-foreground", ring: "ring-border" };
  const actorInitial = getActorInitial(e);

  return (
    <div className="relative flex gap-4 group">
      {/* Timeline column */}
      <div className="flex flex-col items-center w-8 shrink-0">
        {/* Line above dot */}
        {!isFirst && (
          <div className="w-px flex-1 bg-border group-hover:bg-muted-foreground/30 transition-colors" />
        )}
        {isFirst && <div className="flex-1" />}

        {/* Timeline dot */}
        <div className={`w-3 h-3 rounded-full ${actionColor.dot} ring-4 ring-background shrink-0`} />

        {/* Line below dot */}
        {!isLast && (
          <div className="w-px flex-1 bg-border group-hover:bg-muted-foreground/30 transition-colors" />
        )}
        {isLast && <div className="flex-1" />}
      </div>

      {/* Content */}
      <div className={`flex-1 mb-3 ${isFirst ? "" : ""}`}>
        <Card
          className="cursor-pointer transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-3">
              {/* Resource icon in colored container */}
              <div className={`h-9 w-9 rounded-lg ${resourceColor.bg} flex items-center justify-center shrink-0 ring-1 ${resourceColor.ring}`}>
                <Icon className={`h-4 w-4 ${resourceColor.text}`} />
              </div>

              {/* Action badge */}
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

              {/* Actor avatar */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                  {actorInitial}
                </div>
                <span className="text-xs text-muted-foreground max-w-[140px] truncate">
                  {e.actor_email || (e.actor_id ? e.actor_id.slice(0, 8) : "system")}
                </span>
              </div>

              {/* IP address */}
              {e.ip_address && (
                <span className="text-xs font-mono text-muted-foreground shrink-0 hidden md:block">
                  {e.ip_address}
                </span>
              )}

              {/* Timestamp */}
              <div className="flex items-center gap-1 shrink-0" title={new Date(e.created_at).toLocaleString()}>
                <Clock className="h-3 w-3 text-muted-foreground hidden sm:block" />
                <span className="text-xs text-muted-foreground">
                  {timeAgo(e.created_at)}
                </span>
              </div>

              {/* Expand/collapse chevron */}
              <div className="shrink-0 text-muted-foreground">
                {expanded ? (
                  <ChevronDown className="h-4 w-4 transition-transform" />
                ) : (
                  <ChevronRight className="h-4 w-4 transition-transform" />
                )}
              </div>
            </div>

            {/* Expanded details */}
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
