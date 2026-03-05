"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, ExternalLink, Plus, Trash2, XCircle } from "lucide-react";
import type { Webhook, PaginatedResponse } from "@/types";

interface DeliveryLog {
  id: string;
  event: string;
  response_status?: number;
  response_time_ms?: number;
  success: boolean;
  attempt: number;
  created_at: string;
}

const ALL_EVENTS = ["email.received", "inbox.created", "inbox.expired"];

export default function WebhooksPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["webhooks", currentTeam?.id, page],
    queryFn: () => api.get<PaginatedResponse<Webhook>>(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/webhooks`, { page: String(page), per_page: "20" }),
    enabled: !!currentOrg && !!currentTeam,
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/webhooks/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/webhooks/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["webhooks"] });
      const key = ["webhooks", currentTeam?.id, page];
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: PaginatedResponse<Webhook> | undefined) =>
        old ? { ...old, data: old.data.filter((w) => w.id !== id) } : old
      );
      return { prev, key };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
    onSuccess: () => toast.success("Webhook deleted"),
  });

  if (!currentTeam) return <p className="text-muted-foreground">Select a team to manage webhooks.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Webhooks</h1>
          <p className="text-sm text-muted-foreground mt-1">Receive HTTP callbacks when events occur in your team.</p>
        </div>
        <CreateWebhookDialog orgId={currentOrg!.id} teamId={currentTeam.id} />
      </div>

      {isError ? <ErrorState message="Failed to load webhooks" onRetry={() => refetch()} /> :
      isLoading ? <WebhookListSkeleton /> : (
      <>
        {(!data?.data || data.data.length === 0) ? (
          <EmptyState icon="🔗" title="No webhooks" description="Add a webhook to receive event notifications via HTTP." />
        ) : (
          <div className="space-y-4">
            {data.data.map((w) => (
              <WebhookCard
                key={w.id}
                webhook={w}
                expanded={expandedId === w.id}
                onToggleExpand={() => setExpandedId(expandedId === w.id ? null : w.id)}
                onToggleActive={(active) => toggle.mutate({ id: w.id, active })}
                onDelete={() => remove.mutate(w.id)}
                orgId={currentOrg!.id}
                teamId={currentTeam.id}
              />
            ))}
            <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
          </div>
        )}
      </>
      )}
    </div>
  );
}

function WebhookStatusIndicator({ webhook: w }: { webhook: Webhook }) {
  if (!w.active) return <Badge variant="secondary">Disabled</Badge>;
  if (w.failure_count > 0) return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> {w.failure_count} failures</Badge>;
  if (w.last_status && w.last_status >= 200 && w.last_status < 300) return <Badge className="gap-1 bg-green-100 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>;
  return <Badge variant="outline">No deliveries</Badge>;
}

function WebhookCard({ webhook: w, expanded, onToggleExpand, onToggleActive, onDelete, orgId, teamId }: {
  webhook: Webhook; expanded: boolean; onToggleExpand: () => void; onToggleActive: (v: boolean) => void; onDelete: () => void; orgId: string; teamId: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-mono truncate">{w.url}</CardTitle>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <WebhookStatusIndicator webhook={w} />
              {w.events?.map((e) => <Badge key={e} variant="outline" className="text-xs">{e}</Badge>)}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Switch checked={w.active} onCheckedChange={onToggleActive} aria-label="Toggle webhook" />
            <ConfirmDialog
              trigger={<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>}
              title="Delete webhook?"
              description={`${w.url} will stop receiving events.`}
              onConfirm={onDelete}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {w.last_attempt_at && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last delivery: {new Date(w.last_attempt_at).toLocaleString()}
            </span>
          )}
          {w.last_status && (
            <span className="font-mono">HTTP {w.last_status}</span>
          )}
          <button onClick={onToggleExpand} className="ml-auto flex items-center gap-1 hover:text-foreground transition-colors">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Delivery logs
          </button>
        </div>
        {expanded && (
          <div className="mt-3 border-t pt-3">
            <DeliveryLogPanel orgId={orgId} teamId={teamId} webhookId={w.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryLogPanel({ orgId, teamId, webhookId }: { orgId: string; teamId: string; webhookId: string }) {
  const [logPage, setLogPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["webhook-deliveries", webhookId, logPage],
    queryFn: () => api.get<PaginatedResponse<DeliveryLog>>(
      `/orgs/${orgId}/teams/${teamId}/webhooks/${webhookId}/deliveries`,
      { page: String(logPage), per_page: "10" }
    ),
  });

  if (isLoading) return <div className="py-4 text-sm text-muted-foreground">Loading deliveries…</div>;
  if (!data?.data?.length) return <div className="py-4 text-sm text-muted-foreground">No delivery logs yet.</div>;

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Time</TableHead>
            <TableHead className="text-xs">Event</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Latency</TableHead>
            <TableHead className="text-xs">Attempt</TableHead>
            <TableHead className="text-xs">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.data.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</TableCell>
              <TableCell className="text-xs">{l.event}</TableCell>
              <TableCell className="text-xs font-mono">{l.response_status ?? "—"}</TableCell>
              <TableCell className="text-xs">{l.response_time_ms != null ? `${l.response_time_ms}ms` : "—"}</TableCell>
              <TableCell className="text-xs">{l.attempt}</TableCell>
              <TableCell>
                {l.success
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                  : <XCircle className="h-4 w-4 text-destructive" />
                }
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(data.total_pages ?? 1) > 1 && <Pagination page={logPage} totalPages={data.total_pages} onPageChange={setLogPage} />}
    </div>
  );
}

function WebhookListSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/3 mt-2" /></CardHeader>
          <CardContent><Skeleton className="h-3 w-1/2" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

function CreateWebhookDialog({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["email.received"]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const qc = useQueryClient();

  const toggleEvent = (event: string) =>
    setEvents((prev) => prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]);

  const copySecret = () => {
    if (secret) { copyToClipboard(secret); toast.success("Secret copied"); }
  };

  const create = async () => {
    if (!url || events.length === 0) return;
    setCreating(true);
    try {
      const res = await api.post<{ secret: string }>(`/orgs/${orgId}/teams/${teamId}/webhooks`, { url, events });
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      setSecret(res.secret);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  const close = () => { setOpen(false); setSecret(null); setUrl(""); setEvents(["email.received"]); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Add Webhook</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{secret ? "Webhook Created" : "Create a webhook"}</DialogTitle>
          {!secret && <DialogDescription>We&apos;ll send an HTTP POST to your URL when selected events occur. Payloads are signed with HMAC-SHA256.</DialogDescription>}
        </DialogHeader>
        {secret ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Copy this signing secret now — it won&apos;t be shown again.</p>
            <button onClick={copySecret} className="w-full rounded-md bg-muted p-3 text-left font-mono text-sm break-all hover:bg-muted/80 transition-colors group">
              {secret}
              <Copy className="inline-block ml-2 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <Button onClick={close} className="w-full">Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Endpoint URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhook" type="url" />
            </div>
            <div className="space-y-2">
              <Label>Events</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_EVENTS.map((e) => (
                  <Badge
                    key={e}
                    variant={events.includes(e) ? "default" : "outline"}
                    className="cursor-pointer select-none"
                    onClick={() => toggleEvent(e)}
                  >
                    {e}
                  </Badge>
                ))}
              </div>
              {events.length === 0 && <p className="text-xs text-destructive">Select at least one event</p>}
            </div>
            <Button onClick={create} className="w-full" disabled={!url || events.length === 0 || creating}>
              {creating ? "Creating…" : "Create Webhook"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
