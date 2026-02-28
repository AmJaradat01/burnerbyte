"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TableSkeleton } from "@/components/table-skeleton";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import type { Inbox } from "@/types";

interface DomainAssignment {
  id: string;
  domain_id: string;
  domain_name?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export default function InboxesPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["inboxes", currentOrg?.id, currentTeam?.id, page],
    queryFn: () => {
      if (currentTeam) return api.get<PaginatedResponse<Inbox>>(`/orgs/${currentOrg!.id}/teams/${currentTeam.id}/inboxes`, { page: String(page), per_page: "20" });
      return api.get<PaginatedResponse<Inbox>>(`/inboxes`, { page: String(page), per_page: "20" });
    },
    enabled: !!currentOrg,
  });

  const extend = useMutation({
    mutationFn: (id: string) => api.post(`/inboxes/${id}/extend`, { duration: "1h" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inboxes"] }); toast.success("TTL extended"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/inboxes/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["inboxes"] });
      const prev = qc.getQueryData(["inboxes", currentOrg?.id, currentTeam?.id, page]);
      qc.setQueryData(["inboxes", currentOrg?.id, currentTeam?.id, page], (old: any) =>
        old ? { ...old, data: old.data.filter((i: Inbox) => i.id !== id) } : old
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["inboxes", currentOrg?.id, currentTeam?.id, page], ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["inboxes"] }),
    onSuccess: () => toast.success("Inbox deleted"),
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inboxes</h1>
        {currentTeam && <CreateInboxDialog orgId={currentOrg.id} teamId={currentTeam.id} />}
      </div>
      {!currentTeam && <p className="text-sm text-muted-foreground">Select a team to create inboxes, or view all your inboxes below.</p>}
      {isError ? <ErrorState message="Failed to load inboxes" onRetry={() => refetch()} /> :
      isLoading ? <TableSkeleton rows={5} cols={4} /> : (
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.data?.map((inbox) => (
                <TableRow key={inbox.id}>
                  <TableCell>
                    <Link href={`/inboxes/${inbox.id}`} className="font-medium hover:underline">
                      {inbox.full_address || inbox.address}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={inbox.is_active ? "default" : "secondary"}>
                      {inbox.is_active ? "Active" : "Expired"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(inbox.expires_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {inbox.is_active && <Button variant="outline" size="sm" onClick={() => extend.mutate(inbox.id)}>Extend</Button>}
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm">Delete</Button>}
                      title="Delete inbox?"
                      description="This will permanently delete this inbox and all its emails."
                      onConfirm={() => remove.mutate(inbox.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <TableRow><TableCell colSpan={4} className="p-0">
                  <EmptyState icon="📭" title="No inboxes yet" description="Create your first temporary inbox to start receiving emails." />
                </TableCell></TableRow>
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

function CreateInboxDialog({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [alias, setAlias] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [ttl, setTtl] = useState("1h");
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: assignments } = useQuery({
    queryKey: ["domain-assignments", teamId],
    queryFn: () => api.get<{ data: DomainAssignment[] }>(`/orgs/${orgId}/teams/${teamId}/domains`),
    enabled: open,
  });

  const create = async () => {
    try {
      await api.post(`/inboxes`, { domain_assignment_id: assignmentId, alias: alias || undefined, ttl });
      qc.invalidateQueries({ queryKey: ["inboxes"] });
      toast.success("Inbox created");
      setOpen(false);
      setAlias("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Create inbox</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create an inbox</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Domain</Label>
            <Select value={assignmentId} onValueChange={setAssignmentId}>
              <SelectTrigger><SelectValue placeholder="Select domain…" /></SelectTrigger>
              <SelectContent>
                {assignments?.data?.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.domain_name || a.domain_id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Alias (optional, random if empty)</Label>
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="my-alias" />
          </div>
          <div className="space-y-2">
            <Label>TTL</Label>
            <Input value={ttl} onChange={(e) => setTtl(e.target.value)} placeholder="1h" />
          </div>
          <Button onClick={create} className="w-full" disabled={!assignmentId}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
