"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { timeAgo } from "@/lib/time";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { NoTeamState } from "@/components/no-team-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Code2, Copy, ExternalLink, Inbox, Link2, Mail, Pencil,
  Plus, Trash2, Webhook as WebhookIcon, XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

const EVENT_INFO: { key: string; label: string; description: string; icon: LucideIcon; example: string }[] = [
  {
    key: "email.received",
    label: "Email Received",
    description: "Fires when a new email arrives at any inbox in this team.",
    icon: Mail,
    example: '{ "email_id": "...", "inbox_id": "...", "from": "sender@example.com", "subject": "..." }',
  },
  {
    key: "inbox.created",
    label: "Inbox Created",
    description: "Fires when a new temporary inbox is created by a team member.",
    icon: Inbox,
    example: '{ "inbox_id": "...", "address": "abc@domain.com", "domain_assignment_id": "..." }',
  },
  {
    key: "inbox.expired",
    label: "Inbox Expired",
    description: "Fires when an inbox reaches its TTL and expires.",
    icon: Clock,
    example: '{ "inbox_id": "...", "address": "abc@domain.com", "expired_at": "..." }',
  },
];

function isValidWebhookUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default function WebhooksPage() {
  const { currentOrg, currentTeam, hasPermission } = useOrgStore();
  const { user } = useAuthStore();
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

  if (!currentTeam) return <NoTeamState resource="Webhooks" />;

  const isAdmin = hasPermission("org.settings.manage") || user?.is_system_admin;
  if (!isAdmin) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access this page.</p></div>;

  const total = data?.total ?? data?.data?.length ?? 0;
  const activeCount = (data?.data ?? []).filter((w) => w.active).length;
  const failingCount = (data?.data ?? []).filter((w) => w.failure_count > 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0" aria-hidden="true">
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-headline">Webhooks</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {total > 0
                ? `${total} ${total === 1 ? "webhook" : "webhooks"} · ${activeCount} active${failingCount > 0 ? `, ${failingCount} failing` : ""} · ${currentTeam.name}`
                : `HTTP callbacks for events in ${currentTeam.name}.`}
            </p>
          </div>
        </div>
        <CreateWebhookDialog orgId={currentOrg!.id} teamId={currentTeam.id} />
      </header>

      {isError ? <ErrorState message="Failed to load webhooks" onRetry={() => refetch()} /> :
      isLoading ? <WebhookListSkeleton /> : (
      <>
        {(!data?.data || data.data.length === 0) ? (
          <EmptyState icon={WebhookIcon} title="No webhooks" description="Add a webhook to receive event notifications via HTTP POST when emails arrive or inboxes change." />
        ) : (
          <div className="space-y-3">
            {/* Desktop: table */}
            <div className="hidden sm:block rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs font-medium">Endpoint</TableHead>
                    <TableHead className="text-xs font-medium">Status</TableHead>
                    <TableHead className="text-xs font-medium">Events</TableHead>
                    <TableHead className="text-xs font-medium">Last Delivery</TableHead>
                    <TableHead className="text-xs font-medium w-[140px]"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((w) => (
                    <WebhookTableRow
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
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked rows */}
            <div className="sm:hidden rounded-xl border divide-y">
              {data.data.map((w) => (
                <WebhookMobileRow
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
            </div>

            <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
          </div>
        )}
      </>
      )}
    </div>
  );
}

/* ── Status badge ── */

function WebhookStatusBadge({ webhook: w }: { webhook: Webhook }) {
  if (!w.active) return <Badge variant="secondary" className="text-[10px]">Disabled</Badge>;
  if (w.failure_count > 0) {
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <AlertTriangle className="h-2.5 w-2.5" /> Failing
      </Badge>
    );
  }
  if (w.last_status && w.last_status >= 200 && w.last_status < 300) {
    return (
      <Badge variant="success" className="gap-1 text-[10px]">
        <CheckCircle2 className="h-2.5 w-2.5" /> Healthy
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-[10px]">No deliveries</Badge>;
}

/* ── Desktop table row ── */

interface WebhookStats {
  total_deliveries: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_response_time_ms: number;
  last_delivery_at?: string;
}

function WebhookTableRow({ webhook: w, expanded, onToggleExpand, onToggleActive, onDelete, orgId, teamId }: {
  webhook: Webhook; expanded: boolean; onToggleExpand: () => void; onToggleActive: (v: boolean) => void; onDelete: () => void; orgId: string; teamId: string;
}) {
  const { data: stats } = useQuery({
    queryKey: ["webhook-stats", w.id],
    queryFn: () => api.get<WebhookStats>(`/orgs/${orgId}/teams/${teamId}/webhooks/${w.id}/stats`),
    enabled: expanded,
    staleTime: 30000,
  });

  return (
    <>
      <TableRow className={cn("group", !w.active && "opacity-60")}>
        {/* Endpoint */}
        <TableCell>
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn(
              "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
              w.active ? (w.failure_count > 0 ? "bg-destructive/10" : "bg-primary/10") : "bg-muted",
            )}>
              <Link2 className={cn(
                "h-3.5 w-3.5",
                w.active ? (w.failure_count > 0 ? "text-destructive" : "text-primary") : "text-muted-foreground",
              )} />
            </span>
            <span className="font-mono text-sm truncate">{w.url}</span>
          </div>
        </TableCell>

        {/* Status */}
        <TableCell>
          <WebhookStatusBadge webhook={w} />
        </TableCell>

        {/* Events */}
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {w.events?.map((e) => (
              <span key={e} className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {e.split(".")[1]}
              </span>
            ))}
          </div>
        </TableCell>

        {/* Last delivery */}
        <TableCell>
          {w.last_attempt_at ? (
            <div className="text-xs text-muted-foreground space-y-0.5">
              <span>{timeAgo(w.last_attempt_at)}</span>
              {w.last_status && (
                <span className={cn(
                  "ml-1.5 font-mono tabular-nums",
                  w.last_status >= 200 && w.last_status < 300 ? "text-success" : "text-destructive",
                )}>{w.last_status}</span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Never</span>
          )}
        </TableCell>

        {/* Actions */}
        <TableCell>
          <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <Switch checked={w.active} onCheckedChange={onToggleActive} aria-label={w.active ? "Disable" : "Enable"} size="sm" />
            <button
              onClick={onToggleExpand}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors duration-150"
              aria-expanded={expanded}
              aria-label="Toggle delivery logs"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <EditWebhookDialog orgId={orgId} teamId={teamId} webhook={w} />
            <ConfirmDialog
              trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>}
              title="Delete webhook?"
              description={`${w.url} will stop receiving events.`}
              onConfirm={onDelete}
            />
          </div>
        </TableCell>
      </TableRow>
      {/* Expanded: stats + delivery logs */}
      {expanded && (
        <TableRow>
          <TableCell colSpan={5} className="p-0 border-t-0">
            <div className="px-4 py-3 bg-muted/20 animate-in fade-in slide-in-from-top-1 duration-150 space-y-3">
              {/* Stats summary */}
              {stats && stats.total_deliveries > 0 && (
                <div className="flex items-center gap-4 text-xs text-muted-foreground pb-2 border-b">
                  <span className="tabular-nums"><strong className="text-foreground">{stats.total_deliveries}</strong> deliveries</span>
                  <span className={cn("tabular-nums", stats.success_rate >= 95 ? "text-success" : stats.success_rate >= 80 ? "text-warning" : "text-destructive")}>
                    {stats.success_rate.toFixed(1)}% success
                  </span>
                  <span className="tabular-nums">{Math.round(stats.avg_response_time_ms)}ms avg</span>
                  {stats.failure_count > 0 && (
                    <span className="text-destructive tabular-nums">{stats.failure_count} failed</span>
                  )}
                </div>
              )}
              <DeliveryLogPanel orgId={orgId} teamId={teamId} webhookId={w.id} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ── Mobile stacked row ── */

function WebhookMobileRow({ webhook: w, expanded, onToggleExpand, onToggleActive, onDelete, orgId, teamId }: {
  webhook: Webhook; expanded: boolean; onToggleExpand: () => void; onToggleActive: (v: boolean) => void; onDelete: () => void; orgId: string; teamId: string;
}) {
  return (
    <div className={cn("px-4 py-3 space-y-2", !w.active && "opacity-60")}>
      {/* Top: URL + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn(
            "h-7 w-7 rounded-md flex items-center justify-center shrink-0",
            w.active ? (w.failure_count > 0 ? "bg-destructive/10" : "bg-primary/10") : "bg-muted",
          )}>
            <Link2 className={cn(
              "h-3.5 w-3.5",
              w.active ? (w.failure_count > 0 ? "text-destructive" : "text-primary") : "text-muted-foreground",
            )} />
          </span>
          <span className="font-mono text-sm truncate">{w.url}</span>
        </div>
        <WebhookStatusBadge webhook={w} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground pl-9">
        <div className="flex flex-wrap gap-1">
          {w.events?.map((e) => (
            <span key={e} className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {e.split(".")[1]}
            </span>
          ))}
        </div>
        {w.last_attempt_at && (
          <span className="ml-auto shrink-0">{timeAgo(w.last_attempt_at)}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1 border-t">
        <Switch checked={w.active} onCheckedChange={onToggleActive} aria-label={w.active ? "Disable" : "Enable"} size="sm" />
        <button
          onClick={onToggleExpand}
          className="h-7 px-2 flex items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Logs
        </button>
        <div className="ml-auto flex items-center gap-1">
          <EditWebhookDialog orgId={orgId} teamId={teamId} webhook={w} />
          <ConfirmDialog
            trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>}
            title="Delete webhook?"
            description={`${w.url} will stop receiving events.`}
            onConfirm={onDelete}
          />
        </div>
      </div>

      {/* Expanded delivery logs */}
      {expanded && (
        <div className="border-t pt-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <DeliveryLogPanel orgId={orgId} teamId={teamId} webhookId={w.id} />
        </div>
      )}
    </div>
  );
}

/* ── Delivery log panel ── */

function DeliveryLogPanel({ orgId, teamId, webhookId }: { orgId: string; teamId: string; webhookId: string }) {
  const [logPage, setLogPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["webhook-deliveries", webhookId, logPage],
    queryFn: () => api.get<PaginatedResponse<DeliveryLog>>(
      `/orgs/${orgId}/teams/${teamId}/webhooks/${webhookId}/deliveries`,
      { page: String(logPage), per_page: "10" }
    ),
  });

  if (isLoading) return <div className="py-3 text-xs text-muted-foreground">Loading deliveries…</div>;
  if (isError) return <ErrorState message="Failed to load delivery logs" onRetry={() => refetch()} />;
  if (!data?.data?.length) return <div className="py-3 text-xs text-muted-foreground">No delivery logs yet.</div>;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[11px]">Time</TableHead>
              <TableHead className="text-[11px]">Event</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px]">Latency</TableHead>
              <TableHead className="text-[11px]">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs text-muted-foreground">{timeAgo(l.created_at)}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {l.event.split(".")[1]}
                  </span>
                </TableCell>
                <TableCell className={cn(
                  "text-xs font-mono tabular-nums",
                  l.response_status && l.response_status >= 200 && l.response_status < 300 ? "text-success" : l.response_status ? "text-destructive" : "text-muted-foreground",
                )}>
                  {l.response_status ?? "timeout"}
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {l.response_time_ms != null ? `${l.response_time_ms}ms` : "—"}
                </TableCell>
                <TableCell>
                  {l.success
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="Success" />
                    : <XCircle className="h-3.5 w-3.5 text-destructive" aria-label="Failed" />
                  }
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {(data.total_pages ?? 1) > 1 && <Pagination page={logPage} totalPages={data.total_pages} onPageChange={setLogPage} />}
    </div>
  );
}

/* ── Skeleton ── */

function WebhookListSkeleton() {
  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="divide-y">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-7 w-7 rounded-md shrink-0" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-16 rounded-full ml-4" />
            <div className="flex gap-1 ml-4">
              <Skeleton className="h-4 w-14 rounded-full" />
              <Skeleton className="h-4 w-12 rounded-full" />
            </div>
            <Skeleton className="h-4 w-16 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Event card (for create/edit dialogs) ── */

function EventCard({ info, selected, onToggle }: { info: typeof EVENT_INFO[number]; selected: boolean; onToggle: () => void }) {
  const [showExample, setShowExample] = useState(false);
  const Icon = info.icon;

  return (
    <div className={cn(
      "rounded-lg border p-3 transition-colors duration-150",
      selected ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40",
    )}>
      <label className="flex items-start gap-3 cursor-pointer">
        <div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted shrink-0 mt-0.5" aria-hidden="true">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{info.label}</span>
            <Badge variant="outline" className="text-[10px] font-mono ml-auto shrink-0">{info.key}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{info.description}</p>
        </div>
        <Switch checked={selected} onCheckedChange={onToggle} className="mt-1 shrink-0" aria-label={`Subscribe to ${info.label}`} />
      </label>
      <button
        type="button"
        onClick={() => setShowExample(!showExample)}
        className="ml-11 mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-150 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-expanded={showExample}
      >
        <Code2 className="h-3 w-3" aria-hidden="true" />
        {showExample ? "Hide" : "Show"} example payload
        {showExample ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {showExample && (
        <pre className="ml-11 mt-1.5 rounded-md bg-muted p-2 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
          {info.example}
        </pre>
      )}
    </div>
  );
}

/* ── URL input ── */

function UrlInput({ url, onChange }: { url: string; onChange: (v: string) => void }) {
  const showError = url.length > 0 && !isValidWebhookUrl(url);

  return (
    <div className="space-y-2">
      <Label>Endpoint URL</Label>
      <Input
        value={url}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://your-server.com/webhooks/burnerbyte"
        type="url"
        className={showError ? "border-destructive focus-visible:ring-destructive" : ""}
      />
      {showError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          URL must use https:// (required for signature verification)
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Payloads are signed with HMAC-SHA256. Localhost and private IPs are blocked.</p>
    </div>
  );
}

/* ── Event selector ── */

function EventSelector({ events, onToggle }: { events: string[]; onToggle: (event: string) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">Events</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Which events should trigger a delivery.</p>
      </div>
      <div className="space-y-2">
        {EVENT_INFO.map((info) => (
          <EventCard key={info.key} info={info} selected={events.includes(info.key)} onToggle={() => onToggle(info.key)} />
        ))}
      </div>
      {events.length === 0 && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> Select at least one event
        </p>
      )}
    </div>
  );
}

/* ── Create dialog ── */

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

  const urlValid = isValidWebhookUrl(url);
  const canSubmit = urlValid && events.length > 0 && !creating;

  const create = async () => {
    if (!canSubmit) return;
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
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{secret ? "Webhook Created" : "Create a webhook"}</DialogTitle>
          {!secret && <DialogDescription>We&apos;ll send an HTTP POST to your URL when selected events occur.</DialogDescription>}
        </DialogHeader>
        {secret ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-warning/20 bg-warning/5 p-3 text-sm text-warning flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Copy this signing secret now. It won&apos;t be shown again.</span>
            </div>
            <button onClick={copySecret} className="w-full rounded-md bg-muted border p-3 text-left font-mono text-sm break-all hover:bg-muted/80 transition-colors duration-150 group">
              {secret}
              <Copy className="inline-block ml-2 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
            </button>
            <p className="text-xs text-muted-foreground">Use this secret to verify webhook signatures via the <span className="font-mono">X-BurnerByte-Signature</span> header.</p>
            <Button onClick={close} className="w-full">Done</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <UrlInput url={url} onChange={setUrl} />
            <EventSelector events={events} onToggle={toggleEvent} />
            <Button onClick={create} className="w-full" disabled={!canSubmit}>
              {creating ? "Creating…" : "Create Webhook"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Edit dialog ── */

function EditWebhookDialog({ orgId, teamId, webhook }: { orgId: string; teamId: string; webhook: Webhook }) {
  const [url, setUrl] = useState(webhook.url);
  const [events, setEvents] = useState<string[]>(webhook.events ?? []);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const toggleEvent = (event: string) =>
    setEvents((prev) => prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]);

  const urlValid = isValidWebhookUrl(url);
  const canSubmit = urlValid && events.length > 0 && !saving;

  const save = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.patch(`/orgs/${orgId}/teams/${teamId}/webhooks/${webhook.id}`, { url, events });
      qc.invalidateQueries({ queryKey: ["webhooks"] });
      toast.success("Webhook updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update webhook");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setUrl(webhook.url); setEvents(webhook.events ?? []); } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Edit webhook"><Pencil className="h-3.5 w-3.5" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit webhook</DialogTitle>
          <DialogDescription>Update the endpoint URL or subscribed events.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {/* Status banner */}
          <div className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
            !webhook.active ? "bg-muted text-muted-foreground" :
            webhook.failure_count > 0 ? "bg-destructive/10 text-destructive" :
            webhook.last_status && webhook.last_status >= 200 && webhook.last_status < 300 ? "bg-success/10 text-success" :
            "bg-muted text-muted-foreground",
          )}>
            {!webhook.active ? <XCircle className="h-4 w-4" /> :
             webhook.failure_count > 0 ? <AlertTriangle className="h-4 w-4" /> :
             webhook.last_status && webhook.last_status >= 200 && webhook.last_status < 300 ? <CheckCircle2 className="h-4 w-4" /> :
             <Link2 className="h-4 w-4" />}
            <span className="font-medium">
              {!webhook.active ? "Disabled" :
               webhook.failure_count > 0 ? `Failing (${webhook.failure_count} consecutive)` :
               webhook.last_status && webhook.last_status >= 200 && webhook.last_status < 300 ? "Healthy" :
               "No deliveries yet"}
            </span>
          </div>

          <UrlInput url={url} onChange={setUrl} />
          <EventSelector events={events} onToggle={toggleEvent} />

          <Button onClick={save} className="w-full" disabled={!canSubmit}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
