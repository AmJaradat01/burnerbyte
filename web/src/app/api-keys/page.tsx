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

interface ApiKey { id: string; name: string; key_prefix: string; scopes: string[]; expires_at?: string; last_used_at?: string; created_at: string; }
interface PaginatedResponse<T> { data: T[]; total: number; page: number; per_page: number; total_pages: number; }

export default function ApiKeysPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["api-keys", currentTeam?.id, page],
    queryFn: () => api.get<PaginatedResponse<ApiKey>>(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/api-keys`, { page: String(page), per_page: "20" }),
    enabled: !!currentOrg && !!currentTeam,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/api-keys/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["api-keys"] });
      const prev = qc.getQueryData(["api-keys", currentTeam?.id, page]);
      qc.setQueryData(["api-keys", currentTeam?.id, page], (old: any) =>
        old ? { ...old, data: old.data.filter((k: ApiKey) => k.id !== id) } : old
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["api-keys", currentTeam?.id, page], ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onSuccess: () => toast.success("API key revoked"),
  });

  if (!currentTeam) return <p className="text-muted-foreground">Select a team first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <CreateApiKeyDialog orgId={currentOrg!.id} teamId={currentTeam.id} />
      </div>
      {isError ? <ErrorState message="Failed to load API keys" onRetry={() => refetch()} /> :
      isLoading ? <TableSkeleton rows={5} cols={6} /> : (
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.data?.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-sm">{k.key_prefix}…</TableCell>
                  <TableCell>{k.scopes?.map((s) => <Badge key={s} variant="outline" className="mr-1">{s}</Badge>)}</TableCell>
                  <TableCell className="text-muted-foreground">{k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "Never"}</TableCell>
                  <TableCell className="text-muted-foreground">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}</TableCell>
                  <TableCell>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm">Revoke</Button>}
                      title="Revoke API key?"
                      description="This key will immediately stop working. This cannot be undone."
                      onConfirm={() => revoke.mutate(k.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <TableRow><TableCell colSpan={6} className="p-0">
                  <EmptyState icon="🔑" title="No API keys" description="Create an API key for programmatic access." />
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

function CreateApiKeyDialog({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["inbox:read"]);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const allScopes = ["inbox:read", "inbox:write", "email:read", "webhook:manage"];
  const toggleScope = (scope: string) => setScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);

  const create = async () => {
    try {
      const res = await api.post<{ raw_key: string }>(`/orgs/${orgId}/teams/${teamId}/api-keys`, { name, scopes });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setRawKey(res.raw_key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const close = () => { setOpen(false); setRawKey(null); setName(""); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else setOpen(true); }}>
      <DialogTrigger asChild><Button>Create API key</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{rawKey ? "API Key Created" : "Create API Key"}</DialogTitle></DialogHeader>
        {rawKey ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Copy this key now. You won't be able to see it again.</p>
            <code className="block rounded bg-muted p-3 text-sm break-all">{rawKey}</code>
            <Button onClick={close} className="w-full">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My API key" />
            </div>
            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="flex flex-wrap gap-2">
                {allScopes.map((s) => (
                  <Badge key={s} variant={scopes.includes(s) ? "default" : "outline"} className="cursor-pointer" onClick={() => toggleScope(s)}>{s}</Badge>
                ))}
              </div>
            </div>
            <Button onClick={create} className="w-full" disabled={!name}>Create</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
