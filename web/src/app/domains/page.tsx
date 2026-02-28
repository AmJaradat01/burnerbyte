"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { Domain } from "@/types";

export default function DomainsPage() {
  const { currentOrg } = useOrgStore();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["domains", currentOrg?.id],
    queryFn: () => api.get<{ data: Domain[] }>(`/orgs/${currentOrg!.id}/domains`),
    enabled: !!currentOrg,
  });

  const verify = useMutation({
    mutationFn: (id: string) => api.post(`/orgs/${currentOrg!.id}/domains/${id}/verify`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domains"] }); toast.success("Verification triggered"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/domains/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domains"] }); toast.success("Domain removed"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Domains</h1>
        <AddDomainDialog orgId={currentOrg.id} />
      </div>
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
              {data?.data?.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.domain_name}</TableCell>
                  <TableCell><Badge variant={d.mx_verified ? "default" : "secondary"}>{d.mx_verified ? "Verified" : "Pending"}</Badge></TableCell>
                  <TableCell><Badge variant={d.txt_verified ? "default" : "secondary"}>{d.txt_verified ? "Verified" : "Pending"}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="outline" size="sm" onClick={() => verify.mutate(d.id)}>Verify</Button>
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate(d.id)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <TableRow><TableCell colSpan={5} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">🌐</span>
                    <p className="text-muted-foreground">No domains yet</p>
                    <p className="text-xs text-muted-foreground">Add a domain to start creating inboxes.</p>
                  </div>
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
