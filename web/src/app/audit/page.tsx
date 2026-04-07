"use client";

import { useState } from "react";
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
import { Activity, Download, Globe, Inbox, Key, Shield, User, Users, Webhook } from "lucide-react";
import type { AuditEntry, PaginatedResponse } from "@/types";

const RESOURCE_TYPES = ["user", "org", "team", "domain", "domain_assignment", "inbox", "email", "webhook", "api_key"];

const ACTION_COLORS: Record<string, string> = {
  created: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  updated: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  deleted: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  revoked: "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  verified: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
};

function getActionColor(action: string): string {
  for (const [key, cls] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return cls;
  }
  return "";
}

const RESOURCE_ICONS: Record<string, typeof User> = {
  user: User, org: Shield, team: User, domain: Globe,
  domain_assignment: Globe, inbox: Inbox, webhook: Webhook, api_key: Key,
};

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

export default function AuditPage() {
  const { currentOrg, currentRole } = useOrgStore();
  const { user } = useAuthStore();
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const params: Record<string, string> = { page: String(page), per_page: "50" };
  if (action) params.action = action;
  if (resource) params.resource_type = resource;
  if (dateFrom) params.date_from = new Date(dateFrom).toISOString();
  if (dateTo) params.date_to = new Date(dateTo + "T23:59:59").toISOString();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit", currentOrg?.id, action, resource, dateFrom, dateTo, page],
    queryFn: () => api.get<PaginatedResponse<AuditEntry>>(`/orgs/${currentOrg!.id}/audit`, params),
    enabled: !!currentOrg,
  });

  const clearFilters = () => { setAction(""); setResource(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const hasFilters = action || resource || dateFrom || dateTo;

  const exportAll = async () => {
    if (!currentOrg) return;
    setExporting(true);
    try {
      const filterParams: Record<string, string> = {};
      if (action) filterParams.action = action;
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

  const isAdmin = currentRole === "owner" || currentRole === "admin" || user?.is_system_admin;
  if (!isAdmin) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access this page.</p></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{data?.total ?? 0} entries{hasFilters ? " (filtered)" : ""}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={exportAll} disabled={!data?.data?.length || exporting}>
          <Download className="h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Total Entries</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-blue-100 dark:bg-blue-900/30">
                <Shield className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">{data?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Actions (page)</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-emerald-100 dark:bg-emerald-900/30">
                <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">{new Set(data?.data?.map(e => e.action)).size ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Actors (page)</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-amber-100 dark:bg-amber-900/30">
                <Users className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">{new Set(data?.data?.map(e => e.actor_email)).size ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Action</Label>
              <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="e.g. domain.created" className="w-44 h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Resource</Label>
              <Select value={resource || "all"} onValueChange={(v) => { setResource(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All resources</SelectItem>
                  {RESOURCE_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
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

      {/* Entries */}
      {isError ? <ErrorState message="Failed to load audit log" onRetry={() => refetch()} /> :
      isLoading ? <AuditSkeleton /> : (
      <>
        {(!data?.data || data.data.length === 0) ? (
          <EmptyState icon="📋" title="No audit entries" description={hasFilters ? "Try adjusting your filters." : "Actions will appear here as they happen."} />
        ) : (
          <div className="space-y-2">
            {data.data.map((e) => <AuditRow key={e.id} entry={e} />)}
            <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
          </div>
        )}
      </>
      )}
    </div>
  );
}

function AuditRow({ entry: e }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = RESOURCE_ICONS[e.resource_type] || Shield;
  const colorCls = getActionColor(e.action);

  return (
    <Card className="cursor-pointer hover:shadow-sm transition-all duration-200" onClick={() => setExpanded(!expanded)}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <Badge variant="outline" className={`shrink-0 text-xs ${colorCls}`}>{e.action}</Badge>
          <span className="text-sm truncate flex-1">
            <span className="text-muted-foreground">{e.resource_type}/</span>
            <span className="font-mono">{e.resource_id.slice(0, 8)}</span>
          </span>
          <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
            {e.actor_email || (e.actor_id ? e.actor_id.slice(0, 8) : "system")}
          </span>
          {e.ip_address && <span className="text-xs font-mono text-muted-foreground shrink-0 hidden md:block">{e.ip_address}</span>}
          <span className="text-xs text-muted-foreground shrink-0" title={new Date(e.created_at).toLocaleString()}>
            {timeAgo(e.created_at)}
          </span>
        </div>
        {expanded && (
          <div className="mt-3 pt-3 border-t grid gap-2 text-xs sm:grid-cols-2">
            <div><span className="text-muted-foreground">Actor: </span>{e.actor_email || e.actor_id}</div>
            <div><span className="text-muted-foreground">Resource ID: </span><span className="font-mono text-[11px]">{e.resource_id}</span></div>
            <div><span className="text-muted-foreground">IP: </span><span className="font-mono">{e.ip_address || "—"}</span></div>
            <div><span className="text-muted-foreground">Time: </span>{new Date(e.created_at).toLocaleString()}</div>
            {e.metadata && typeof e.metadata === "object" && Object.keys(e.metadata).length > 0 && (
              <div className="sm:col-span-2 mt-1">
                <span className="text-muted-foreground block mb-1.5">Details:</span>
                <div className="rounded-lg bg-muted/50 border divide-y">
                  {Object.entries(e.metadata).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-muted-foreground">{k.replace(/_/g, " ")}</span>
                      <span className="font-mono text-[11px] text-right max-w-[60%] truncate">{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v ?? "—")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AuditSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i}><CardContent className="py-3 px-4"><Skeleton className="h-5 w-full" /></CardContent></Card>
      ))}
    </div>
  );
}
