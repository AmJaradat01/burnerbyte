"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
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
import { WebhookIllustration } from "@/components/illustrations";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, Code2, Copy, ExternalLink, Globe, Info, Link2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
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

const EVENT_INFO = [
  {
    key: "email.received",
    label: "Email Received",
    description: "Fires when a new email arrives at any inbox in this team.",
    icon: "📬",
    example: '{ "email_id": "...", "inbox_id": "...", "from": "sender@example.com", "subject": "..." }',
  },
  {
    key: "inbox.created",
    label: "Inbox Created",
    description: "Fires when a new temporary inbox is created by a team member.",
    icon: "📥",
    example: '{ "inbox_id": "...", "address": "abc@domain.com", "domain_assignment_id": "..." }',
  },
  {
    key: "inbox.expired",
    label: "Inbox Expired",
    description: "Fires when an inbox reaches its TTL and expires.",
    icon: "⏰",
    example: '{ "inbox_id": "...", "address": "abc@domain.com", "expired_at": "..." }',
  },
];

function isValidWebhookUrl(url: string): boolean {
  if (!url) return false;
  return url.startsWith("https://") || url.startsWith("http://localhost");
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

  if (!currentTeam) return <div className="text-center py-12 space-y-3"><p className="text-muted-foreground">Select a team to manage webhooks.</p><Link href="/teams"><Button variant="outline" size="sm">Go to Teams</Button></Link></div>;

  const isAdmin = hasPermission("org.settings.manage") || user?.is_system_admin;
  if (!isAdmin) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access this page.</p></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="card-header-accent">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-warning/50/10 flex items-center justify-center">
                <Globe className="h-4 w-4 text-warning" />
              </div>
              <div>
                <h1 className="text-base font-semibold">Webhooks</h1>
                <p className="text-sm text-muted-foreground">
                  {data?.data?.length ? `${data.total ?? data.data.length} webhook${(data.total ?? data.data.length) !== 1 ? "s" : ""} · ${data.data.filter(w => w.active).length} active · Receive HTTP callbacks when events occur.` : "Receive HTTP callbacks when events occur in your team."}
                </p>
              </div>
            </div>
            <CreateWebhookDialog orgId={currentOrg!.id} teamId={currentTeam.id} />
          </div>
        </CardContent>
      </Card>

      {data?.data && data.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total", value: data.total, icon: Globe, bg: "bg-info/10 text-info" },
            { label: "Active", value: data.data.filter(w => w.active).length, icon: CheckCircle2, bg: "bg-success/10 text-success" },
            { label: "Failing", value: data.data.filter(w => w.failure_count > 0).length, icon: AlertCircle, bg: "bg-destructive/10 text-destructive" },
          ].map((s) => (
            <Card key={s.label} className="transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:-translate-y-px">
              <CardContent className="pt-5 pb-4">
                <div className="flex justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
                  <div className={`flex items-center justify-center h-8 w-8 rounded-lg ${s.bg}`}><s.icon className="h-4 w-4" /></div>
                </div>
                <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isError ? <ErrorState message="Failed to load webhooks" onRetry={() => refetch()} /> :
      isLoading ? <WebhookListSkeleton /> : (
      <>
        {(!data?.data || data.data.length === 0) ? (
          <EmptyState illustration={<WebhookIllustration />} title="No webhooks" description="Add a webhook to receive event notifications via HTTP." />
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
  if (w.last_status && w.last_status >= 200 && w.last_status < 300) return <Badge className="gap-1 bg-success/10 text-success border-success/20"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>;
  return <Badge variant="outline">No deliveries</Badge>;
}

function WebhookCard({ webhook: w, expanded, onToggleExpand, onToggleActive, onDelete, orgId, teamId }: {
  webhook: Webhook; expanded: boolean; onToggleExpand: () => void; onToggleActive: (v: boolean) => void; onDelete: () => void; orgId: string; teamId: string;
}) {
  const isHealthy = w.active && w.last_status && w.last_status >= 200 && w.last_status < 300;
  const isFailing = w.failure_count > 0;
  const pillColor = !w.active
    ? "bg-muted text-muted-foreground"
    : isFailing
      ? "bg-destructive/10 text-destructive"
      : isHealthy
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground";

  return (
    <Card className={`hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all ${!w.active ? "border-dashed opacity-70" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1 space-y-1">
            <div className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${pillColor}`}><Link2 className="h-5 w-5" /></div>
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
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Switch checked={w.active} onCheckedChange={onToggleActive} aria-label="Toggle webhook" />
            <EditWebhookDialog orgId={orgId} teamId={teamId} webhook={w} />
            <ConfirmDialog
              trigger={<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label="Delete webhook"><Trash2 className="h-4 w-4" /></Button>}
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
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["webhook-deliveries", webhookId, logPage],
    queryFn: () => api.get<PaginatedResponse<DeliveryLog>>(
      `/orgs/${orgId}/teams/${teamId}/webhooks/${webhookId}/deliveries`,
      { page: String(logPage), per_page: "10" }
    ),
  });

  if (isLoading) return <div className="py-4 text-sm text-muted-foreground">Loading deliveries…</div>;
  if (isError) return <ErrorState message="Failed to load delivery logs" onRetry={() => refetch()} />;
  if (!data?.data?.length) return <div className="py-4 text-sm text-muted-foreground">No delivery logs yet.</div>;

  return (
    <div>
      <div className="overflow-x-auto">
      <Table className="table-striped">
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
                  ? <CheckCircle2 className="h-4 w-4 text-success" />
                  : <XCircle className="h-4 w-4 text-destructive" />
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

function EventCard({ info, selected, onToggle }: { info: typeof EVENT_INFO[number]; selected: boolean; onToggle: () => void }) {
  const [showExample, setShowExample] = useState(false);

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full text-left rounded-lg border p-3 transition-all ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted text-lg shrink-0 mt-0.5">
          {info.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div
              className={`h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                selected
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-muted-foreground/30"
              }`}
            >
              {selected && (
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span className="text-sm font-medium">{info.label}</span>
            <Badge variant="outline" className="text-[10px] font-mono ml-auto shrink-0">{info.key}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 ml-6">{info.description}</p>
          <div className="ml-6 mt-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowExample(!showExample); }}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Code2 className="h-3 w-3" />
              {showExample ? "Hide" : "Show"} example payload
              {showExample ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            {showExample && (
              <pre className="mt-1.5 rounded-md bg-muted p-2 text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                {info.example}
              </pre>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function UrlInput({ url, onChange }: { url: string; onChange: (v: string) => void }) {
  const showError = url.length > 0 && !isValidWebhookUrl(url);

  return (
    <div className="space-y-2">
      <Label>Endpoint URL</Label>
      <Input
        value={url}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://example.com/webhook"
        type="url"
        className={showError ? "border-destructive focus-visible:ring-destructive" : ""}
      />
      {showError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          URL must start with https:// or http://localhost
        </p>
      )}
    </div>
  );
}

function EventSelector({ events, onToggle }: { events: string[]; onToggle: (event: string) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">Select Events</Label>
        <p className="text-xs text-muted-foreground mt-0.5">Choose which events should trigger a delivery to your endpoint.</p>
      </div>
      <div className="space-y-2">
        {EVENT_INFO.map((info) => (
          <EventCard
            key={info.key}
            info={info}
            selected={events.includes(info.key)}
            onToggle={() => onToggle(info.key)}
          />
        ))}
      </div>
      {events.length === 0 && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Select at least one event
        </p>
      )}
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
          <div className="space-y-5">
            <UrlInput url={url} onChange={setUrl} />

            <EventSelector events={events} onToggle={toggleEvent} />

            <Button onClick={create} className="w-full" disabled={!canSubmit}>
              {creating ? "Creating…" : "Create Webhook"}
            </Button>

            <div className="rounded-lg border border-info/20 bg-info/5 p-3">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-info mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-info">Use Cases</p>
                  <ul className="text-xs text-info mt-1 space-y-0.5 list-disc list-inside">
                    <li>Forward incoming emails to Slack or Discord</li>
                    <li>Trigger CI/CD pipelines on new test emails</li>
                    <li>Log inbox activity to an external dashboard</li>
                    <li>Auto-archive expired inboxes in your system</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

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

  const statusInfo = !webhook.active
    ? { label: "Disabled", color: "bg-muted text-muted-foreground", icon: XCircle }
    : webhook.failure_count > 0
      ? { label: "Failing", color: "bg-destructive/10 text-destructive", icon: AlertTriangle }
      : webhook.last_status && webhook.last_status >= 200 && webhook.last_status < 300
        ? { label: "Healthy", color: "bg-success/10 text-success", icon: CheckCircle2 }
        : { label: "No deliveries", color: "bg-muted text-muted-foreground", icon: Globe };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setUrl(webhook.url); setEvents(webhook.events ?? []); } }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Edit webhook"><Pencil className="h-4 w-4" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit webhook</DialogTitle>
          <DialogDescription>Update the endpoint URL or subscribed events.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${statusInfo.color}`}>
            <statusInfo.icon className="h-4 w-4" />
            <span className="font-medium">Status: {statusInfo.label}</span>
            {webhook.failure_count > 0 && (
              <span className="text-xs ml-auto">{webhook.failure_count} consecutive failure{webhook.failure_count !== 1 ? "s" : ""}</span>
            )}
          </div>

          <UrlInput url={url} onChange={setUrl} />

          <EventSelector events={events} onToggle={toggleEvent} />

          <Button onClick={save} className="w-full" disabled={!canSubmit}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
