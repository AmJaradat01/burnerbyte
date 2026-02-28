"use client";

import { useState } from "react";
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
import { toast } from "sonner";
import { TableSkeleton } from "@/components/table-skeleton";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import type { Domain } from "@/types";

interface PaginatedResponse<T> { data: T[]; total: number; page: number; per_page: number; total_pages: number; }

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domains"] }); toast.success("Verification triggered"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/domains/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["domains"] });
      const prev = qc.getQueryData(["domains", currentOrg?.id, page]);
      qc.setQueryData(["domains", currentOrg?.id, page], (old: any) =>
        old ? { ...old, data: old.data.filter((d: Domain) => d.id !== id) } : old
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["domains", currentOrg?.id, page], ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["domains"] }),
    onSuccess: () => toast.success("Domain removed"),
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const filtered = data?.data?.filter((d) => d.domain_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Domains</h1>
        <AddDomainDialog orgId={currentOrg.id} />
      </div>
      <Input placeholder="Search domains…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      {isError ? <ErrorState message="Failed to load domains" onRetry={() => refetch()} /> :
      isLoading ? <TableSkeleton rows={5} cols={5} /> : (
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>MX</TableHead>
                <TableHead>TXT</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered?.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.domain_name}</TableCell>
                  <TableCell><Badge variant={d.mx_verified ? "default" : "secondary"}>{d.mx_verified ? "Verified" : "Pending"}</Badge></TableCell>
                  <TableCell><Badge variant={d.txt_verified ? "default" : "secondary"}>{d.txt_verified ? "Verified" : "Pending"}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => verify.mutate(d.id)}>Verify</Button>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm">Remove</Button>}
                      title="Remove domain?"
                      description="This will remove the domain and all its assignments."
                      onConfirm={() => remove.mutate(d.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {(!filtered || filtered.length === 0) && (
                <TableRow><TableCell colSpan={5} className="p-0">
                  <EmptyState icon="🌐" title={search ? "No matching domains" : "No domains yet"} description={search ? "Try a different search term." : "Add your first domain to get started."} />
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

function AddDomainDialog({ orgId }: { orgId: string }) {
  const [domain, setDomain] = useState("");
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const add = async () => {
    try {
      await api.post(`/orgs/${orgId}/domains`, { domain_name: domain });
      qc.invalidateQueries({ queryKey: ["domains"] });
      toast.success("Domain added");
      setOpen(false);
      setDomain("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Add domain</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a domain</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Domain name</Label>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
          </div>
          <Button onClick={add} className="w-full">Add domain</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
