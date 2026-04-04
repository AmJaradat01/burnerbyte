"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AlertTriangle, CheckCircle2, Clock, Copy, Key, Plus, Trash2 } from "lucide-react";
import type { APIKey, PaginatedResponse } from "@/types";

const ALL_SCOPES = ["inbox:create", "inbox:read", "email:read", "email:delete"];
const EXPIRY_OPTIONS = [
  { label: "No expiration", value: "" },
  { label: "7 days", value: "168h" },
  { label: "30 days", value: "720h" },
  { label: "90 days", value: "2160h" },
  { label: "1 year", value: "8760h" },
];

export default function ApiKeysPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["api-keys", currentTeam?.id, page],
    queryFn: () => api.get<PaginatedResponse<APIKey>>(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/api-keys`, { page: String(page), per_page: "20" }),
    enabled: !!currentOrg && !!currentTeam,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/api-keys/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["api-keys"] });
      const key = ["api-keys", currentTeam?.id, page];
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: PaginatedResponse<APIKey> | undefined) =>
        old ? { ...old, data: old.data.filter((k) => k.id !== id) } : old
      );
      return { prev, key };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onSuccess: () => toast.success("API key revoked"),
  });

  if (!currentTeam) return <div className="text-center py-12 space-y-3"><p className="text-muted-foreground">Select a team to manage API keys.</p><Link href="/teams"><Button variant="outline" size="sm">Go to Teams</Button></Link></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data?.data?.length ? `${data.total ?? data.data.length} key${(data.total ?? data.data.length) !== 1 ? "s" : ""}` : "Manage programmatic access to your team's resources."}
          </p>
        </div>
        <CreateApiKeyDialog orgId={currentOrg!.id} teamId={currentTeam.id} />
      </div>

      {data?.data && data.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total", value: data.total, icon: Key, bg: "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400" },
            { label: "Active", value: data.data.filter(k => !k.expires_at || new Date(k.expires_at) >= new Date()).length, icon: CheckCircle2, bg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400" },
            { label: "Expired", value: data.data.filter(k => k.expires_at && new Date(k.expires_at) < new Date()).length, icon: Clock, bg: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-5 pb-4">
                <div className="flex justify-between mb-3">
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                  <div className={`flex items-center justify-center h-8 w-8 rounded-lg ${s.bg}`}><s.icon className="h-4 w-4" /></div>
                </div>
                <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isError ? <ErrorState message="Failed to load API keys" onRetry={() => refetch()} /> :
      isLoading ? <ApiKeyListSkeleton /> : (
      <>
        {(!data?.data || data.data.length === 0) ? (
          <EmptyState icon="🔑" title="No API keys" description="Create an API key for programmatic access to inboxes and emails." />
        ) : (
          <div className="space-y-4">
            {data.data.map((k) => (
              <ApiKeyCard key={k.id} apiKey={k} onRevoke={() => revoke.mutate(k.id)} />
            ))}
            <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
          </div>
        )}
      </>
      )}
    </div>
  );
}

function ApiKeyCard({ apiKey: k, onRevoke }: { apiKey: APIKey; onRevoke: () => void }) {
  const isExpired = k.expires_at && new Date(k.expires_at) < new Date();
  const copyPrefix = () => { copyToClipboard(k.key_prefix); toast.success("Prefix copied"); };

  return (
    <Card className={`hover:shadow-md transition-all ${isExpired ? "border-dashed opacity-60" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${isExpired ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" : "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"}`}><Key className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm truncate">{k.name}</CardTitle>
              {isExpired && <Badge variant="destructive" className="gap-1 shrink-0"><AlertTriangle className="h-3 w-3" /> Expired</Badge>}
            </div>
            <button onClick={copyPrefix} className="mt-1 flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors group">
              {k.key_prefix}•••
              <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            </div>
          </div>
          <ConfirmDialog
            trigger={<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive shrink-0"><Trash2 className="h-4 w-4" /></Button>}
            title="Revoke API key?"
            description={`"${k.name}" will immediately stop working. This cannot be undone.`}
            onConfirm={onRevoke}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {/* Scopes */}
        <div className="flex flex-wrap gap-1.5">
          {k.scopes?.map((s) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Created {new Date(k.created_at).toLocaleDateString()}
          </span>
          {k.expires_at && (
            <span>
              {isExpired ? "Expired" : "Expires"} {new Date(k.expires_at).toLocaleDateString()}
            </span>
          )}
          {!k.expires_at && <span>No expiration</span>}
          <span className="ml-auto">
            {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : "Never used"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiKeyListSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-1/4 mt-1" /></CardHeader>
          <CardContent><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2 mt-2" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

function CreateApiKeyDialog({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["inbox:read"]);
  const [expiresIn, setExpiresIn] = useState("");
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const toggleScope = (scope: string) =>
    setScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);

  const copyKey = () => {
    if (rawKey) { copyToClipboard(rawKey); toast.success("API key copied"); }
  };

  const create = async () => {
    if (!name.trim() || scopes.length === 0) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), scopes };
      if (expiresIn && expiresIn !== "none") body.expires_in = expiresIn;
      const res = await api.post<{ raw_key: string }>(`/orgs/${orgId}/teams/${teamId}/api-keys`, body);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setRawKey(res.raw_key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  const close = () => { setOpen(false); setRawKey(null); setName(""); setScopes(["inbox:read"]); setExpiresIn(""); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Create API Key</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rawKey ? "API Key Created" : "Create an API key"}</DialogTitle>
          {!rawKey && <DialogDescription>Keys are hashed with SHA-256 and cannot be recovered. Copy it immediately after creation.</DialogDescription>}
        </DialogHeader>
        {rawKey ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Copy this key now — it won&apos;t be shown again.</p>
            <button onClick={copyKey} className="w-full rounded-md bg-muted p-3 text-left font-mono text-sm break-all hover:bg-muted/80 transition-colors group">
              {rawKey}
              <Copy className="inline-block ml-2 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <Button onClick={close} className="w-full">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI Pipeline" onKeyDown={(e) => e.key === "Enter" && create()} />
            </div>
            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_SCOPES.map((s) => (
                  <Badge key={s} variant={scopes.includes(s) ? "default" : "outline"} className="cursor-pointer select-none" onClick={() => toggleScope(s)}>{s}</Badge>
                ))}
              </div>
              {scopes.length === 0 && <p className="text-xs text-destructive">Select at least one scope</p>}
            </div>
            <div className="space-y-2">
              <Label>Expiration</Label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger><SelectValue placeholder="No expiration" /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value || "none"} value={o.value || "none"}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={create} className="w-full" disabled={!name.trim() || scopes.length === 0 || creating}>
              {creating ? "Creating…" : "Create API Key"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
