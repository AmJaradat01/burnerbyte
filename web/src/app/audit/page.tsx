"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface AuditEntry {
  id: string;
  actor_id: string;
  actor_email?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export default function AuditPage() {
  const { currentOrg } = useOrgStore();
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [page, setPage] = useState(1);

  const params: Record<string, string> = { page: String(page), per_page: "50" };
  if (action) params.action = action;
  if (resource) params.resource_type = resource;

  const { data } = useQuery({
    queryKey: ["audit", currentOrg?.id, action, resource, page],
    queryFn: () => api.get<{ data: AuditEntry[]; total: number }>(`/orgs/${currentOrg!.id}/audit`, params),
    enabled: !!currentOrg,
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit Log</h1>
      <div className="flex gap-4">
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
              {["user", "org", "team", "domain", "inbox", "email", "webhook", "api_key"].map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
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
                  <TableCell className="text-muted-foreground text-sm">{new Date(e.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{e.actor_email || e.actor_id.slice(0, 8)}</TableCell>
                  <TableCell><Badge variant="outline">{e.action}</Badge></TableCell>
                  <TableCell className="text-sm">{e.resource_type}/{e.resource_id.slice(0, 8)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{e.ip_address}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
