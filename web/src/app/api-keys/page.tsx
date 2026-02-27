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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at?: string;
  last_used_at?: string;
  created_at: string;
}

export default function ApiKeysPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["api-keys", currentTeam?.id],
    queryFn: () => api.get<{ data: ApiKey[] }>(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/api-keys`),
    enabled: !!currentOrg && !!currentTeam,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/api-keys/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-keys"] }); toast.success("API key revoked"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (!currentTeam) return <p className="text-muted-foreground">Select a team first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <CreateApiKeyDialog orgId={currentOrg!.id} teamId={currentTeam.id} />
      </div>
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
                  <TableCell className="font-mono text-sm">{k.prefix}…</TableCell>
                  <TableCell>{k.scopes?.map((s) => <Badge key={s} variant="outline" className="mr-1">{s}</Badge>)}</TableCell>
                  <TableCell className="text-muted-foreground">{k.expires_at ? new Date(k.expires_at).toLocaleDateString() : "Never"}</TableCell>
                  <TableCell className="text-muted-foreground">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" onClick={() => revoke.mutate(k.id)}>Revoke</Button></TableCell>
                </TableRow>
              ))}
              {(!data?.data || data.data.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No API keys</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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

  const toggleScope = (scope: string) => {
    setScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
  };

  const create = async () => {
    try {
      const res = await api.post<{ raw_key: string }>(`/orgs/${orgId}/teams/${teamId}/api-keys`, { name, scopes });
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setRawKey(res.raw_key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const close = () => {
    setOpen(false);
    setRawKey(null);
    setName("");
  };

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
                  <Badge key={s} variant={scopes.includes(s) ? "default" : "outline"} className="cursor-pointer" onClick={() => toggleScope(s)}>
                    {s}
                  </Badge>
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
