"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Clock, Copy, Inbox as InboxIcon, Mail, MailOpen, Plus, Timer, Trash2 } from "lucide-react";
import type { Inbox, PaginatedResponse, DomainAssignment } from "@/types";

export default function InboxesPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("active");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["inboxes", currentOrg?.id, currentTeam?.id, page, status],
    queryFn: () => {
      const params = { page: String(page), per_page: "20", status };
      if (currentTeam) return api.get<PaginatedResponse<Inbox>>(`/orgs/${currentOrg!.id}/teams/${currentTeam.id}/inboxes`, params);
      return api.get<PaginatedResponse<Inbox>>(`/inboxes`, params);
    },
    enabled: !!currentOrg,
  });

  const extend = useMutation({
    mutationFn: (id: string) => api.post(`/inboxes/${id}/extend`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inboxes"] }); toast.success("Inbox renewed"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/inboxes/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["inboxes"] });
      const key = ["inboxes", currentOrg?.id, currentTeam?.id, page, status];
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: PaginatedResponse<Inbox> | undefined) =>
        old ? { ...old, data: old.data.filter((i) => i.id !== id) } : old
      );
      return { prev, key };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["inboxes"] }),
    onSuccess: () => toast.success("Inbox deleted"),
  });

  // Reset page when switching tabs
  useEffect(() => setPage(1), [status]);

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const activeCount = data?.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inboxes</h1>
        </div>
        <CreateInboxDialog />
      </div>

      {/* Status tabs */}
      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="expired">Expired</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Content */}
      {isError ? <ErrorState message="Failed to load inboxes" onRetry={() => refetch()} /> :
      isLoading ? <InboxGridSkeleton /> : (
      <>
        {(!data?.data || data.data.length === 0) ? (
          <EmptyState
            icon="📭"
            title={status === "active" ? "No active inboxes" : status === "expired" ? "No expired inboxes" : "No inboxes yet"}
            description={status === "active" ? "Create a temporary inbox to start receiving emails." : "Expired inboxes will appear here."}
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.data.map((inbox) => (
                <InboxCard
                  key={inbox.id}
                  inbox={inbox}
                  onExtend={() => extend.mutate(inbox.id)}
                  onDelete={() => remove.mutate(inbox.id)}
                />
              ))}
            </div>
            <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
          </>
        )}
      </>
      )}
    </div>
  );
}

function InboxCard({ inbox, onExtend, onDelete }: { inbox: Inbox; onExtend: () => void; onDelete: () => void }) {
  const copyAddress = () => { navigator.clipboard.writeText(inbox.full_address || inbox.address); toast.success("Copied to clipboard"); };

  return (
    <Card className={`transition-colors ${!inbox.is_active ? "opacity-60" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link href={`/inboxes/${inbox.id}`}>
              <CardTitle className="text-sm font-mono truncate hover:underline cursor-pointer">
                {inbox.full_address || inbox.address}
              </CardTitle>
            </Link>
            {inbox.domain_name && (
              <CardDescription className="text-xs mt-0.5">@{inbox.domain_name}</CardDescription>
            )}
          </div>
          <Badge variant={inbox.is_active ? "default" : "secondary"} className="shrink-0">
            {inbox.is_active ? "Active" : "Expired"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1" title="Total emails">
            <Mail className="h-3.5 w-3.5" /> {inbox.email_count ?? 0}
          </span>
          {(inbox.unread_count ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-primary font-medium" title="Unread">
              <MailOpen className="h-3.5 w-3.5" /> {inbox.unread_count} unread
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto" title={inbox.is_active ? "Expires" : "Expired"}>
            <Clock className="h-3.5 w-3.5" />
            <ExpiryLabel expiresAt={inbox.expires_at} isActive={inbox.is_active} />
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={copyAddress}>
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
          {inbox.is_active && (
            <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={onExtend}>
              <Timer className="h-3.5 w-3.5" /> Renew
            </Button>
          )}
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            }
            title="Delete inbox?"
            description={`This will permanently delete ${inbox.full_address || inbox.address} and all its emails.`}
            onConfirm={onDelete}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ExpiryLabel({ expiresAt, isActive }: { expiresAt: string; isActive: boolean }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        const ago = Math.abs(diff);
        if (ago < 3600000) setLabel(`${Math.floor(ago / 60000)}m ago`);
        else if (ago < 86400000) setLabel(`${Math.floor(ago / 3600000)}h ago`);
        else setLabel(`${Math.floor(ago / 86400000)}d ago`);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      if (h > 24) setLabel(`${Math.floor(h / 24)}d ${h % 24}h`);
      else if (h > 0) setLabel(`${h}h ${m}m`);
      else setLabel(`${m}m`);
    };
    update();
    const interval = setInterval(update, isActive ? 60000 : 0);
    return () => clearInterval(interval);
  }, [expiresAt, isActive]);
  return <span className="text-xs font-mono">{label}</span>;
}

function InboxGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/3 mt-1" /></CardHeader>
          <CardContent className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-8 w-full" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

function durationToMinutes(d?: string): number {
  if (!d) return Infinity;
  let mins = 0;
  const h = d.match(/(\d+)h/);
  const m = d.match(/(\d+)m/);
  if (h) mins += parseInt(h[1]) * 60;
  if (m) mins += parseInt(m[1]);
  return mins || Infinity;
}

function formatDuration(d: string): string {
  const h = d.match(/(\d+)h/);
  const m = d.match(/(\d+)m/);
  const parts: string[] = [];
  if (h && parseInt(h[1]) > 0) parts.push(`${h[1]}h`);
  if (m && parseInt(m[1]) > 0) parts.push(`${m[1]}m`);
  return parts.join(" ") || d;
}

const ALL_PRESETS = [
  { mins: 10, value: "10m", label: "10 minutes" },
  { mins: 30, value: "30m", label: "30 minutes" },
  { mins: 60, value: "1h", label: "1 hour" },
  { mins: 360, value: "6h", label: "6 hours" },
  { mins: 720, value: "12h", label: "12 hours" },
  { mins: 1440, value: "24h", label: "24 hours" },
];

function CreateInboxDialog() {
  const [alias, setAlias] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [ttlPreset, setTtlPreset] = useState("");
  const [customTtl, setCustomTtl] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const { data: assignments } = useQuery({
    queryKey: ["my-domains"],
    queryFn: () => api.get<{ data: DomainAssignment[] }>("/my/domains"),
    enabled: open,
  });

  useEffect(() => {
    if (assignments?.data?.length && !assignmentId) setAssignmentId(assignments.data[0].id);
  }, [assignments, assignmentId]);

  const selected = assignments?.data?.find((a) => a.id === assignmentId);
  const maxMins = durationToMinutes(selected?.max_ttl);
  const defaultTtl = selected?.default_ttl;
  const availablePresets = ALL_PRESETS.filter((p) => p.mins <= maxMins);

  useEffect(() => {
    if (!defaultTtl) return;
    const mins = durationToMinutes(defaultTtl);
    const closest = availablePresets.reduce((prev, curr) =>
      Math.abs(curr.mins - mins) < Math.abs(prev.mins - mins) ? curr : prev
    , ALL_PRESETS[0]);
    setTtlPreset(closest?.value || "1h");
  }, [defaultTtl, maxMins]); // eslint-disable-line react-hooks/exhaustive-deps

  const ttl = ttlPreset === "custom" ? customTtl : ttlPreset;

  const create = async () => {
    if (!assignmentId || !ttl) return;
    setCreating(true);
    try {
      await api.post(`/inboxes`, { domain_assignment_id: assignmentId, alias: alias || undefined, ttl });
      qc.invalidateQueries({ queryKey: ["inboxes"] });
      qc.invalidateQueries({ queryKey: ["home-inboxes"] });
      toast.success("Inbox created");
      setOpen(false);
      setAlias("");
      setTtlPreset("");
      setCustomTtl("");
      setAssignmentId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Create Inbox</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create a temporary inbox</DialogTitle></DialogHeader>
        {assignments?.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No domains available. Ask your admin to assign a domain to your team.</p>
        ) : (
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
            <Label>Alias <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <div className="flex items-center gap-2">
              <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Leave empty for random address" className="flex-1" />
              {selected?.domain_name && <span className="text-sm text-muted-foreground shrink-0">@{selected.domain_name}</span>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Lifetime</Label>
            <Select value={ttlPreset} onValueChange={setTtlPreset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {availablePresets.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
            {ttlPreset === "custom" && <Input value={customTtl} onChange={(e) => setCustomTtl(e.target.value)} placeholder="e.g. 2h30m" className="mt-2" />}
            {selected?.max_ttl && <p className="text-xs text-muted-foreground">Maximum: {formatDuration(selected.max_ttl)}</p>}
          </div>
          <Button onClick={create} className="w-full" disabled={!assignmentId || !ttl || creating}>
            {creating ? "Creating…" : "Create Inbox"}
          </Button>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
