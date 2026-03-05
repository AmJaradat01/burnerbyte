"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Pagination } from "@/components/pagination";
import { Clock, Copy, Mail, MailOpen, Plus, Timer, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { WS_BASE } from "@/lib/api";
import { LocaleSwitcher } from "@/components/locale-switcher";
import type { Inbox, PaginatedResponse, DomainAssignment } from "@/types";

export default function RootPage() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  if (loading) return null;
  if (user) return <HomePage />;
  return <LandingPage />;
}

/* ── Authenticated home ── */

function HomePage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("active");
  const t = useTranslations("home");
  const tc = useTranslations("common");

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t("goodMorning");
    if (h < 18) return t("goodAfternoon");
    return t("goodEvening");
  })();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["home-inboxes", page, status],
    queryFn: () => api.get<PaginatedResponse<Inbox>>(`/inboxes`, { page: String(page), per_page: "12", status }),
  });

  // Live refresh via WebSocket
  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const ws = new WebSocket(`${WS_BASE}/notifications?token=${token}`);
    ws.onmessage = () => { qc.invalidateQueries({ queryKey: ["home-inboxes"] }); };
    return () => { ws.close(); };
  }, [qc]);

  const extend = useMutation({
    mutationFn: (id: string) => api.post(`/inboxes/${id}/extend`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home-inboxes"] }); toast.success(t("extendedBy1h")); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/inboxes/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["home-inboxes"] });
      const key = ["home-inboxes", page, status];
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["home-inboxes"] }),
    onSuccess: () => toast.success(t("inboxDeleted")),
  });

  useEffect(() => setPage(1), [status]);

  const statusLabel = status === "active"
    ? t("activeInboxes", { count: data?.total ?? 0 })
    : status === "expired"
    ? t("expiredInboxes", { count: data?.total ?? 0 })
    : t("totalInboxes", { count: data?.total ?? 0 });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{greeting}, {user?.display_name?.split(" ")[0] || "there"}</h1>
          {data && <p className="text-sm text-muted-foreground">{statusLabel}</p>}
        </div>
        <CreateInboxDialog />
      </div>

      <Tabs value={status} onValueChange={setStatus}>
        <TabsList>
          <TabsTrigger value="active">{tc("active")}</TabsTrigger>
          <TabsTrigger value="expired">{tc("expired")}</TabsTrigger>
          <TabsTrigger value="all">{tc("all")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {isError ? <ErrorState message="Failed to load inboxes" onRetry={() => refetch()} /> :
       isLoading ? <InboxGridSkeleton /> :
       (!data?.data || data.data.length === 0) ? (
        <EmptyState
          icon="📭"
          title={status === "active" ? t("noActiveInboxes") : status === "expired" ? t("noExpiredInboxes") : t("noInboxes")}
          description={t("createToStart")}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((inbox) => (
              <InboxCard key={inbox.id} inbox={inbox} onExtend={() => extend.mutate(inbox.id)} onDelete={() => remove.mutate(inbox.id)} />
            ))}
          </div>
          <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}

/* ── Inbox card ── */

function InboxCard({ inbox, onExtend, onDelete }: { inbox: Inbox; onExtend: () => void; onDelete: () => void }) {
  const tc = useTranslations("common");
  const t = useTranslations("home");
  const copyAddress = () => { navigator.clipboard.writeText(inbox.full_address || inbox.address); toast.success(tc("copied")); };

  return (
    <Card className={!inbox.is_active ? "opacity-60" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link href={`/inboxes/${inbox.id}`}>
              <CardTitle className="text-sm font-mono truncate hover:underline cursor-pointer">{inbox.full_address || inbox.address}</CardTitle>
            </Link>
            {inbox.domain_name && <CardDescription className="text-xs mt-0.5">@{inbox.domain_name}</CardDescription>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(inbox.unread_count ?? 0) > 0 && <Badge>{t("new", { count: inbox.unread_count })}</Badge>}
            <Badge variant={inbox.is_active ? "outline" : "secondary"}>{inbox.is_active ? tc("active") : tc("expired")}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {inbox.email_count ?? 0}</span>
          {(inbox.unread_count ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-primary font-medium"><MailOpen className="h-3.5 w-3.5" /> {t("unread", { count: inbox.unread_count })}</span>
          )}
          <span className="flex items-center gap-1 ml-auto"><Clock className="h-3.5 w-3.5" /><ExpiryLabel expiresAt={inbox.expires_at} isActive={inbox.is_active} /></span>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={copyAddress}><Copy className="h-3.5 w-3.5" /> {tc("copy")}</Button>
          {inbox.is_active && <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={onExtend}><Timer className="h-3.5 w-3.5" /> {t("renew")}</Button>}
          <ConfirmDialog
            trigger={<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
            title={t("deleteInbox")}
            description={t("deleteInboxDesc", { address: inbox.full_address || inbox.address })}
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
    if (isActive) { const iv = setInterval(update, 60000); return () => clearInterval(iv); }
  }, [expiresAt, isActive]);
  return <span className="text-xs font-mono">{label}</span>;
}

function InboxGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/3 mt-1" /></CardHeader>
          <CardContent><Skeleton className="h-4 w-full" /><Skeleton className="h-8 w-full mt-2" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ── Create inbox dialog — fetches user's available domains from BE ── */

/** Parse Go duration string (e.g. "1h0m0s", "10m0s") to minutes */
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
  { mins: 10, value: "10m", key: "10m" as const },
  { mins: 30, value: "30m", key: "30m" as const },
  { mins: 60, value: "1h", key: "1h" as const },
  { mins: 360, value: "6h", key: "6h" as const },
  { mins: 720, value: "12h", key: "12h" as const },
  { mins: 1440, value: "24h", key: "24h" as const },
];

function CreateInboxDialog() {
  const [alias, setAlias] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [ttlPreset, setTtlPreset] = useState("");
  const [customTtl, setCustomTtl] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const t = useTranslations("createInbox");
  const th = useTranslations("home");

  const { data: assignments } = useQuery({
    queryKey: ["my-domains"],
    queryFn: () => api.get<{ data: DomainAssignment[] }>("/my/domains"),
    enabled: open,
  });

  // Auto-select first assignment and set default TTL preset
  useEffect(() => {
    if (assignments?.data?.length && !assignmentId) {
      const first = assignments.data[0];
      setAssignmentId(first.id);
    }
  }, [assignments, assignmentId]);

  const selected = assignments?.data?.find((a) => a.id === assignmentId);
  const maxMins = durationToMinutes(selected?.max_ttl);
  const defaultTtl = selected?.default_ttl;

  // Filter presets to those within max TTL, add custom option
  const presetLabels: Record<string, string> = {
    "10m": t("10m"), "30m": t("30m"), "1h": t("1h"),
    "6h": t("6h"), "12h": t("12h"), "24h": t("24h"),
  };
  const availablePresets = ALL_PRESETS.filter((p) => p.mins <= maxMins);

  // Set default TTL when domain changes
  useEffect(() => {
    if (!defaultTtl) return;
    const match = ALL_PRESETS.find((p) => p.value === defaultTtl.replace("0s", "").replace("0m0s", ""));
    if (match) setTtlPreset(match.value);
    else {
      // Default TTL doesn't match a preset — find closest
      const mins = durationToMinutes(defaultTtl);
      const closest = ALL_PRESETS.filter((p) => p.mins <= maxMins).reduce((prev, curr) =>
        Math.abs(curr.mins - mins) < Math.abs(prev.mins - mins) ? curr : prev
      , ALL_PRESETS[0]);
      setTtlPreset(closest?.value || "1h");
    }
  }, [defaultTtl, maxMins]);

  const ttl = ttlPreset === "custom" ? customTtl : ttlPreset;

  const create = async () => {
    if (!assignmentId || !ttl) return;
    setCreating(true);
    try {
      await api.post(`/inboxes`, { domain_assignment_id: assignmentId, alias: alias || undefined, ttl });
      qc.invalidateQueries({ queryKey: ["home-inboxes"] });
      qc.invalidateQueries({ queryKey: ["inboxes"] });
      toast.success(th("inboxCreated"));
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
        <Button className="gap-2"><Plus className="h-4 w-4" /> {th("newInbox")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("title")}</DialogTitle></DialogHeader>
        {assignments?.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">{th("noDomains")}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("domain")}</Label>
              <Select value={assignmentId} onValueChange={setAssignmentId}>
                <SelectTrigger><SelectValue placeholder={t("selectDomain")} /></SelectTrigger>
                <SelectContent>
                  {assignments?.data?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.domain_name || a.domain_id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("alias")} <span className="text-muted-foreground font-normal">({t("aliasOptional")})</span></Label>
              <div className="flex items-center gap-2">
                <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={t("aliasPlaceholder")} className="flex-1" />
                {selected?.domain_name && <span className="text-sm text-muted-foreground shrink-0">@{selected.domain_name}</span>}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("lifetime")}</Label>
              <Select value={ttlPreset} onValueChange={setTtlPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availablePresets.map((p) => <SelectItem key={p.value} value={p.value}>{presetLabels[p.key]}</SelectItem>)}
                  <SelectItem value="custom">{t("custom")}</SelectItem>
                </SelectContent>
              </Select>
              {ttlPreset === "custom" && <Input value={customTtl} onChange={(e) => setCustomTtl(e.target.value)} placeholder={t("customPlaceholder")} className="mt-2" />}
              {selected?.max_ttl && (
                <p className="text-xs text-muted-foreground">{t("maxLifetime", { max: formatDuration(selected.max_ttl) })}</p>
              )}
            </div>
            <Button onClick={create} className="w-full" disabled={!assignmentId || !ttl || creating}>
              {creating ? t("creating") : t("createInbox")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Public landing page ── */

const featureKeys = ["inboxes", "multiTeam", "realTime", "webhooks", "apiKeys", "selfHosted"] as const;
const featureIcons = ["📬", "👥", "⚡", "🔗", "🔑", "🏠"];

function LandingPage() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold tracking-tight">🔥 BurnerByte</span>
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            <Link href="/login" className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">{tc("signIn")}</Link>
            <Link href="/register" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">{tc("getStarted")}</Link>
          </div>
        </div>
      </header>
      <main>
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
          <div className="relative mx-auto max-w-3xl px-6 py-28 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground mb-6">
              <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" /></span>
              {t("tagline")}
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text">{t("headline")}</h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">{t("subtitle")}</p>
            <div className="mt-10 flex justify-center gap-4">
              <Link href="/register" className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-primary/25">{t("getStartedFree")}</Link>
              <Link href="/login" className="rounded-lg border px-8 py-3 text-sm font-semibold hover:bg-muted transition-colors">{tc("signIn")}</Link>
            </div>
          </div>
        </section>
        <section className="mx-auto max-w-5xl px-6 pb-28">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold">{t("everythingYouNeed")}</h2>
            <p className="mt-2 text-muted-foreground">{t("builtFor")}</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featureKeys.map((key, i) => (
              <div key={key} className="group rounded-xl border p-6 transition-colors hover:border-primary/50 hover:bg-muted/30">
                <span className="text-3xl mb-3 block">{featureIcons[i]}</span>
                <h3 className="font-semibold">{t(`features.${key}.title`)}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t(`features.${key}.desc`)}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-3xl px-6 py-20 text-center">
            <h2 className="text-2xl font-bold">{t("readyToStart")}</h2>
            <p className="mt-3 text-muted-foreground">{t("deployInMinutes")}</p>
            <Link href="/register" className="mt-6 inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">{t("createAccount")}</Link>
          </div>
        </section>
      </main>
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">
        <p>{t("footer")}</p>
        <p className="mt-1 text-xs">{t("license")}</p>
      </footer>
    </div>
  );
}
