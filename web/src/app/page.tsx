"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/error-state";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { PullToRefreshIndicator } from "@/components/pull-to-refresh-indicator";
import { Pagination } from "@/components/pagination";
import { Check, ChevronDown, Clock, Copy, ExternalLink, Mail, RefreshCw, Search, Timer, Trash2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { copyToClipboard } from "@/lib/clipboard";
import { LandingPage } from "@/components/landing/landing-page";
import type { Inbox, PaginatedResponse, DomainAssignment } from "@/types";

export default function RootPage() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  if (loading) return null;
  if (user) return <HomePage />;
  return <LandingPage />;
}

/* ── Helpers ── */

function durationToMinutes(d?: string): number {
  if (!d) return Infinity;
  let mins = 0;
  const h = d.match(/(\d+)h/);
  const m = d.match(/(\d+)m/);
  if (h) mins += parseInt(h[1]) * 60;
  if (m) mins += parseInt(m[1]);
  return mins || Infinity;
}

const ALL_PRESETS = [
  { mins: 10, value: "10m", key: "10m" as const },
  { mins: 30, value: "30m", key: "30m" as const },
  { mins: 60, value: "1h", key: "1h" as const },
  { mins: 360, value: "6h", key: "6h" as const },
  { mins: 720, value: "12h", key: "12h" as const },
  { mins: 1440, value: "24h", key: "24h" as const },
];

/* ── Authenticated home ── */

function HomePage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const t = useTranslations("home");

  // Computed once on mount so render stays pure (the hour does not change mid-session).
  const [greeting] = useState(() => {
    const h = new Date().getHours();
    if (h < 12) return t("goodMorning");
    if (h < 18) return t("goodAfternoon");
    return t("goodEvening");
  });

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"active" | "expired" | "all">("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Debounce the search box so we don't query on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Inboxes with pagination, filtered by status and (optionally) address search.
  const inboxParams: Record<string, string> = { page: String(page), per_page: "12", status };
  if (search) inboxParams.search = search;
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["home-inboxes", page, status, search],
    queryFn: () => api.get<PaginatedResponse<Inbox>>(`/inboxes`, inboxParams),
    refetchOnWindowFocus: true,
  });

  const { pulling, refreshing, pullDistance } = usePullToRefresh({
    onRefresh: async () => { await refetch(); },
    enabled: true,
  });

  const extend = useMutation({
    mutationFn: (id: string) => api.post(`/inboxes/${id}/extend`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home-inboxes"] }); toast.success(t("extendedBy1h")); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/inboxes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home-inboxes"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); toast.success(t("inboxDeleted")); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <div className="space-y-8">
      <PullToRefreshIndicator pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      {/* Greeting */}
      <div>
        <h1 className="text-headline">{greeting}, {user?.display_name?.split(" ")[0] || "there"}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("quickCreateDesc")}</p>
      </div>

      {/* Quick Create Hero */}
      <QuickCreateCard />

      {/* Your Inboxes — shown once you have some; the create card above is the empty action */}
      {(isLoading || isError || search !== "" || status !== "active" || (data?.data?.length ?? 0) > 0) && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="text-subhead shrink-0">{t("recentInboxes")}</h2>
              {data && data.total > 0 && !search && (
                <span className="text-sm font-medium text-muted-foreground tabular-nums">
                  {data.total} {status === "expired" ? "expired" : status === "all" ? "total" : "active"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div
                className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 text-xs font-medium"
                role="tablist"
                aria-label="Inbox status filter"
              >
                {(["active", "expired", "all"] as const).map((s) => (
                  <button
                    key={s}
                    role="tab"
                    aria-selected={status === s}
                    onClick={() => { setStatus(s); setPage(1); }}
                    className={`rounded-md px-2.5 py-1 capitalize transition-colors duration-150 ${
                      status === s ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="relative w-36 sm:w-52 shrink-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" aria-hidden="true" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search inboxes…"
                  className="h-9 pl-8"
                  aria-label="Search inboxes by address"
                />
              </div>
            </div>
          </div>

          {isError ? <ErrorState message="Failed to load inboxes" onRetry={() => refetch()} /> :
           isLoading ? <InboxGridSkeleton /> :
           (data?.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {search ? `No inboxes match “${search}”.` : status === "expired" ? "No expired inboxes." : "No inboxes yet."}
            </p>
           ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data?.data?.map((inbox) => (
                  <InboxCard key={inbox.id} inbox={inbox} onExtend={() => extend.mutate(inbox.id)} onDelete={() => remove.mutate(inbox.id)} />
                ))}
              </div>
              {data && data.total_pages > 1 && (
                <div className="mt-4">
                  <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Quick Create Card ── */

function QuickCreateCard() {
  const [assignmentId, setAssignmentId] = useState("");
  const [alias, setAlias] = useState("");
  const [ttlPreset, setTtlPreset] = useState("");
  const [customTtl, setCustomTtl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdInbox, setCreatedInbox] = useState<Inbox | null>(null);
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const t = useTranslations("home");
  const ti = useTranslations("createInbox");

  const { data: assignments } = useQuery({
    queryKey: ["my-domains"],
    queryFn: () => api.get<{ data: DomainAssignment[] }>("/my/domains"),
  });

  useEffect(() => {
    if (assignments?.data?.length && !assignmentId) setAssignmentId(assignments.data[0].id);
  }, [assignments, assignmentId]);

  const selected = assignments?.data?.find((a) => a.id === assignmentId);
  const maxMins = durationToMinutes(selected?.max_ttl);
  const availablePresets = ALL_PRESETS.filter((p) => p.mins <= maxMins);

  useEffect(() => {
    const defaultTtl = selected?.default_ttl;
    if (!defaultTtl) { setTtlPreset("1h"); return; }
    const mins = durationToMinutes(defaultTtl);
    const closest = availablePresets.reduce((prev, curr) =>
      Math.abs(curr.mins - mins) < Math.abs(prev.mins - mins) ? curr : prev
    , ALL_PRESETS[0]);
    setTtlPreset(closest?.value || "1h");
  }, [selected?.default_ttl, maxMins]); // eslint-disable-line react-hooks/exhaustive-deps

  const ttl = ttlPreset === "custom" ? customTtl : ttlPreset;

  const create = useCallback(async () => {
    if (!assignmentId || !ttl) return;
    setCreating(true);
    try {
      const res = await api.post<Inbox>(`/inboxes`, { domain_assignment_id: assignmentId, alias: alias || undefined, ttl });
      setCreatedInbox(res);
      qc.invalidateQueries({ queryKey: ["home-inboxes"] });
      qc.invalidateQueries({ queryKey: ["inboxes"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  }, [assignmentId, ttl, alias, qc]);

  const copyAddress = () => {
    if (!createdInbox) return;
    copyToClipboard(createdInbox.full_address || createdInbox.address);
    setCopied(true);
    toast.success("Copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setCreatedInbox(null);
    setAlias("");
    setCopied(false);
    setShowAdvanced(false);
  };

  const presetLabels: Record<string, string> = {
    "10m": ti("10m"), "30m": ti("30m"), "1h": ti("1h"),
    "6h": ti("6h"), "12h": ti("12h"), "24h": ti("24h"),
  };

  const noDomains = assignments?.data?.length === 0;

  if (noDomains) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm font-medium text-muted-foreground">{t("noDomains")}</p>
        <div className="flex justify-center gap-2">
          <Link href="/domains"><Button variant="outline" size="sm">Add Domain</Button></Link>
          <Link href="/onboarding"><Button size="sm">Run Setup Wizard</Button></Link>
        </div>
      </div>
    );
  }

  // ── Address created — hero display ──
  if (createdInbox) {
    const addr = createdInbox.full_address || createdInbox.address;
    const [localPart, domainPart] = addr.split("@");

    return (
      <div className="text-center space-y-6 py-4">
        <div className="inline-flex items-center gap-2 rounded-full border bg-success/10 border-success/20 px-3.5 py-1.5">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="text-xs font-semibold text-success">{t("addressReady")}</span>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider font-medium">{t("yourAddress")}</p>
          <button
            onClick={copyAddress}
            className="group inline-flex items-center gap-4 rounded-2xl border border-primary/15 bg-primary/[0.03] px-6 py-4 sm:px-8 sm:py-5 transition-all duration-200 hover:border-primary/30 hover:bg-primary/[0.06] hover:shadow-md cursor-pointer max-w-full"
          >
            <span className="font-mono text-2xl sm:text-3xl lg:text-4xl font-extrabold truncate tracking-tight">
              <span>{localPart}</span>
              <span className="text-muted-foreground/50">@</span>
              <span className="text-primary">{domainPart}</span>
            </span>
            <span className="shrink-0 flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors duration-150">
              {copied ? <Check className="h-5 w-5 text-success" /> : <Copy className="h-5 w-5 text-primary" />}
            </span>
          </button>
        </div>

        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <ExpiryLabel expiresAt={createdInbox.expires_at} isActive={true} />
          </span>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" className="gap-2 h-9" onClick={copyAddress}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" className="gap-2 h-9" onClick={() => router.push(`/inboxes/${createdInbox.id}`)}>
            <ExternalLink className="h-3.5 w-3.5" /> {t("openInbox")}
          </Button>
          <Button variant="outline" size="sm" className="gap-2 h-9" onClick={reset}>
            <RefreshCw className="h-3.5 w-3.5" /> New
          </Button>
        </div>
      </div>
    );
  }

  // ── Pre-create state — domain selector + generate button ──
  return (
    <div className="text-center space-y-6 py-4">
      {/* Domain selector as the hero element */}
      <div className="inline-flex items-center gap-2.5 rounded-2xl border border-border/80 bg-card px-5 py-3.5 sm:px-7 sm:py-4.5 max-w-full shadow-sm">
        <Mail className="h-5 w-5 text-muted-foreground shrink-0" />
        {showAdvanced && alias ? (
          <span className="font-mono text-xl sm:text-2xl font-bold text-foreground/60">{alias}</span>
        ) : (
          <span className="font-mono text-xl sm:text-2xl font-bold text-muted-foreground/30">random</span>
        )}
        <span className="font-mono text-xl sm:text-2xl font-bold text-muted-foreground/40">@</span>
        {(assignments?.data?.length ?? 0) > 1 ? (
          <Select value={assignmentId} onValueChange={setAssignmentId}>
            <SelectTrigger className="h-auto border-0 bg-transparent p-0 font-mono text-xl sm:text-2xl font-bold text-primary shadow-none gap-1 w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {assignments?.data?.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.domain_name || a.domain_id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="font-mono text-xl sm:text-2xl font-bold text-primary">{selected?.domain_name}</span>
        )}
      </div>

      {/* Generate button — hero level */}
      <div>
        <Button onClick={create} disabled={!assignmentId || creating} size="lg" className="gap-2.5 px-8 h-12 text-sm font-semibold rounded-lg shadow-sm hover:shadow-md">
          {creating ? (
            <><RefreshCw className="h-4 w-4 animate-spin" /> {t("generating")}</>
          ) : (
            <><Zap className="h-4 w-4" /> {t("generate")}</>
          )}
        </Button>
        {ttlPreset && presetLabels[ttlPreset] && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{presetLabels[ttlPreset]}</p>
        )}
      </div>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
        {t("advancedOptions")}
      </button>

      {showAdvanced && (
        <div className="max-w-md mx-auto border rounded-xl p-4 text-left space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{ti("alias")}</Label>
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={ti("aliasPlaceholder")} className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{ti("lifetime")}</Label>
            <Select value={ttlPreset} onValueChange={setTtlPreset}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {availablePresets.map((p) => <SelectItem key={p.value} value={p.value}>{presetLabels[p.key]}</SelectItem>)}
                <SelectItem value="custom">{ti("custom")}</SelectItem>
              </SelectContent>
            </Select>
            {ttlPreset === "custom" && <Input value={customTtl} onChange={(e) => setCustomTtl(e.target.value)} placeholder={ti("customPlaceholder")} className="h-8 text-sm mt-1.5" />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Inbox card ── */

function InboxCard({ inbox, onExtend, onDelete }: { inbox: Inbox; onExtend: () => void; onDelete: () => void }) {
  const tc = useTranslations("common");
  const t = useTranslations("home");
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const copyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(inbox.full_address || inbox.address);
    setCopied(true);
    toast.success(tc("copied"));
    setTimeout(() => setCopied(false), 1500);
  };

  const addr = inbox.full_address || inbox.address;
  const [localPart, domainPart] = addr.split("@");
  const hasUnread = (inbox.unread_count ?? 0) > 0;
  // Display-only time hint: Date.now() only controls a CSS border style, no logic depends on it
  // eslint-disable-next-line react-hooks/purity
  const expiringSoon = inbox.is_active && (new Date(inbox.expires_at).getTime() - Date.now()) < 30 * 60 * 1000;

  return (
    <Card
      className={`transition-[color,box-shadow,border-color] hover:border-primary/30 hover:shadow-md cursor-pointer group ${!inbox.is_active ? "opacity-60" : ""} ${expiringSoon ? "border-warning/40" : ""}`}
      onClick={() => router.push(`/inboxes/${inbox.id}`)}
    >
      <CardContent className="pt-4 pb-3 space-y-2.5">
        {/* Address */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-mono text-sm font-medium truncate group-hover:text-primary transition-colors duration-150">
            <span>{localPart}</span>
            <span className="text-muted-foreground">@</span>
            <span className="text-primary/80">{domainPart}</span>
            </p>
          </div>
          {hasUnread && (
            <Badge className="shrink-0 text-[10px] px-1.5 py-0 animate-in fade-in">{inbox.unread_count}</Badge>
          )}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          <span className="flex items-center gap-1">
            <Mail className="h-3 w-3" /> {inbox.email_count ?? 0}
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <Clock className="h-3 w-3" />
            <ExpiryLabel expiresAt={inbox.expires_at} isActive={inbox.is_active} />
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 pt-0.5 border-t" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs flex-1" onClick={copyAddress}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? tc("copied") : tc("copy")}
          </Button>
          {inbox.is_active && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs flex-1" onClick={(e) => { e.stopPropagation(); onExtend(); }}>
              <Timer className="h-3 w-3" /> {t("renew")}
            </Button>
          )}
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" aria-label="Delete inbox">
                <Trash2 className="h-3 w-3" />
              </Button>
            }
            title={t("deleteInbox")}
            description={t("deleteInboxDesc", { address: addr })}
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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-4 pb-4 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-7 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* Public landing page lives in @/components/landing/landing-page */
