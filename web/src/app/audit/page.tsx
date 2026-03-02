"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableSkeleton } from "@/components/table-skeleton";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { toast } from "sonner";
import { timeAgo } from "@/lib/time";
import type { PaginatedResponse } from "@/types";

interface AuditEntry {
  id: string; actor_id: string; actor_email?: string; action: string;
  resource_type: string; resource_id: string; metadata?: Record<string, unknown>;
  ip_address?: string; created_at: string;
}

function exportCSV(entries: AuditEntry[]) {
  const header = "Time,Actor,Action,Resource Type,Resource ID,IP Address";
  const rows = entries.map((e) =>
    [new Date(e.created_at).toISOString(), e.actor_email || e.actor_id, e.action, e.resource_type, e.resource_id, e.ip_address || ""]
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
  const { currentOrg } = useOrgStore();
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [page, setPage] = useState(1);

  const params: Record<string, string> = { page: String(page), per_page: "50" };
  if (action) params.action = action;
  if (resource) params.resource_type = resource;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit", currentOrg?.id, action, resource, page],
    queryFn: () => api.get<PaginatedResponse<AuditEntry>>(`/orgs/${currentOrg!.id}/audit`, params),
    enabled: !!currentOrg,
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <Button variant="outline" size="sm" onClick={() => data?.data && exportCSV(data.data)} disabled={!data?.data?.length}>
          Export CSV
        </Button>
      </div>
      <div className="flex gap-4 flex-wrap">
        <div className="space-y-1">
          <Label>Action</Label>
          <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Filter by action…" className="w-48" />
        </div>
        <div className="space-y-1">
          <Label>Resource</Label>
          <Select value={resource} onValueChange={(v) => { setResource(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All resources" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {["user", "org", "team", "domain", "domain_assignment", "inbox", "email", "webhook", "api_key"].map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {isError ? <ErrorState message="Failed to load audit log" onRetry={() => refetch()} /> :
      isLoading ? <TableSkeleton rows={10} cols={5} /> : (
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.data?.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground text-sm" title={new Date(e.created_at).toLocaleString()}>{timeAgo(e.created_at)}</TableCell>
                  <TableCell className="text-sm">{e.actor_email || e.actor_id.slice(0, 8)}</TableCell>
                  <TableCell><Badge variant="outline">{e.action}</Badge></TableCell>
                  <TableCell className="text-sm">{e.resource_type}/{e.resource_id.slice(0, 8)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{e.ip_address}</TableCell>
                </TableRow>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No audit entries found</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
        </CardContent>
      </Card>
      )}
    </div>
  );
}
