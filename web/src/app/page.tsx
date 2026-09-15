"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Formats a Go-duration string for display: "1h0m0s" → "1h", "15m0s" → "15m", "2h30m0s" → "2h30m" */
function formatTtlLabel(ttl: string): string {
  // Handle Go's verbose format (e.g. "1h0m0s") and user format (e.g. "1h", "15m", "2h30m")
  const h = ttl.match(/(\d+)h/);
  const m = ttl.match(/(\d+)m/);
  const hours = h ? parseInt(h[1]) : 0;
  const mins = m ? parseInt(m[1]) : 0;
  if (hours > 0 && mins > 0) return `${hours}h${mins}m`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return ttl;
}

/** Validates a TTL string. Returns null if valid, or an error message. */
function validateTtl(value: string, maxMins: number): string | null {
  if (!value.trim()) return "TTL is required";
  // Must match Go-duration format: e.g. 10m, 1h, 2h30m, 30m
  const pattern = /^(?:(\d+)h)?(?:(\d+)m)?$/;
  const match = value.trim().match(pattern);
  if (!match || (!match[1] && !match[2])) {
    return "Use format like 10m, 1h, or 2h30m";
  }
  const hours = match[1] ? parseInt(match[1]) : 0;
  const mins = match[2] ? parseInt(match[2]) : 0;
  const totalMins = hours * 60 + mins;
  if (totalMins < 1) return "Minimum is 1m";
  if (totalMins > 1440) return "Maximum is 24h";
  if (maxMins < Infinity && totalMins > maxMins) {
    const maxH = Math.floor(maxMins / 60);
    const maxM = maxMins % 60;
    const maxLabel = maxH > 0 ? (maxM > 0 ? `${maxH}h${maxM}m` : `${maxH}h`) : `${maxMins}m`;
    return `Exceeds domain limit of ${maxLabel}`;
  }
  return null;
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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Debounce the search box so we don't query on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Inboxes with pagination, filtered by status and (optionally) address search.
  const inboxParams: Record<string, string> = { page: String(page), per_page: "12", status: "active" };
  if (search) inboxParams.search = search;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["home-inboxes", page, search],
    queryFn: () => api.get<PaginatedResponse<Inbox>>(`/inboxes`, inboxParams),
    refetchOnWindowFocus: true,
    // Dynamic refetch interval: poll faster when inboxes are close to expiry
    // so the list updates promptly once the backend cleanup removes them.
    refetchInterval: (query) => {
      const inboxes = query.state.data?.data;
      if (!inboxes?.length) return false;
      const now = Date.now();
      const soonestMs = Math.min(...inboxes.map((ib) => new Date(ib.expires_at).getTime() - now));
      if (soonestMs <= 0) return 5_000; // Already expired, refetch quickly
      if (soonestMs <= 2 * 60_000) return 15_000; // Within 2 min, poll fast
      if (soonestMs <= 10 * 60_000) return 30_000; // Within 10 min
      return 60_000; // Baseline: every 60s
    },
  });

  const { pulling, refreshing, pullDistance } = usePullToRefresh({
    onRefresh: async () => { await refetch(); },
    enabled: true,
  });

  const extend = useMutation({
    mutationFn: (id: string) => api.post(`/inboxes/${id}/extend`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home-inboxes"] }); toast.success(t("extendedBy1h")); },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 404) {
        qc.invalidateQueries({ queryKey: ["home-inboxes"] });
        toast.error(t("inboxExpired"));
      } else {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/inboxes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["home-inboxes"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); toast.success(t("inboxDeleted")); },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 404) {
        // Inbox was already removed (expired), just refresh the list
        qc.invalidateQueries({ queryKey: ["home-inboxes"] });
        toast.success(t("inboxDeleted"));
      } else {
        toast.error(err instanceof Error ? err.message : "Failed");
      }
    },
  });

  const bulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      await Promise.allSettled(ids.map((id) => api.del(`/inboxes/${id}`)));
      qc.invalidateQueries({ queryKey: ["home-inboxes"] });
      toast.success(`${ids.length} inbox${ids.length > 1 ? "es" : ""} deleted`);
      setSelectedIds(new Set());
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  }, [selectedIds, qc]);

  const bulkRenew = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.post(`/inboxes/${id}/extend`, {})));
      const failed = results.filter((r) => r.status === "rejected");
      const expired = failed.filter((r) => r.reason instanceof ApiError && r.reason.status === 404);
      qc.invalidateQueries({ queryKey: ["home-inboxes"] });
      if (expired.length > 0 && expired.length === failed.length) {
        toast.error(`${expired.length} inbox${expired.length > 1 ? "es" : ""} already expired`);
      } else if (failed.length > 0) {
        toast.error(`${failed.length} inbox${failed.length > 1 ? "es" : ""} failed to renew`);
      } else {
        toast.success(`${ids.length} inbox${ids.length > 1 ? "es" : ""} renewed`);
      }
      setSelectedIds(new Set());
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
  }, [selectedIds, qc]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const hasInboxes = (data?.data?.length ?? 0) > 0;
  const showInboxSection = isLoading || isError || search !== "" || hasInboxes;

  return (
    <div className={cn(
      showInboxSection ? "space-y-6" : "flex flex-col items-center justify-center min-h-[60vh]",
    )}>
      <PullToRefreshIndicator pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      {/* Greeting */}
      <div className={showInboxSection ? "" : "text-center"}>
        <h1 className="text-headline">{greeting}, {user?.display_name?.split(" ").slice(0, 2).join(" ") || "there"}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("quickCreateDesc")}</p>
      </div>

      {/* Quick Create Hero */}
      <QuickCreateCard />

      {/* Your Inboxes — shown once you have some; the create card above is the empty action */}
      {showInboxSection && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="text-subhead shrink-0">{t("recentInboxes")}</h2>
              {data && data.total > 0 && !search && (
                <span className="text-sm font-medium text-muted-foreground tabular-nums">
                  {data.total}
                </span>
              )}
            </div>
            <div className="relative w-44 sm:w-56 shrink-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={t("searchInboxes")}
                  className="h-9 pl-8"
                  aria-label={t("searchInboxesLabel")}
                />
            </div>
          </div>

          {isError ? <ErrorState message="Failed to load inboxes" onRetry={() => refetch()} /> :
           isLoading ? <InboxGridSkeleton /> :
           (data?.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {search ? `No inboxes match "${search}".` : "No inboxes yet."}
            </p>
           ) : (
            <>
              {/* Bulk action bar */}
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 mb-3 p-2 rounded-lg border bg-muted/30 animate-in fade-in duration-150">
                  <span className="text-xs font-medium text-muted-foreground">{selectedIds.size} selected</span>
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={bulkRenew}>
                    <Timer className="h-3 w-3" /> Renew all
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={bulkDelete}>
                    <Trash2 className="h-3 w-3" /> Delete all
                  </Button>
                  <button className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors duration-150" onClick={() => setSelectedIds(new Set())}>Clear</button>
                </div>
              )}
              {/* Compact row list for 7+ inboxes; card grid for fewer */}
              {(data?.data?.length ?? 0) >= 7 ? (
                <div className="rounded-xl border divide-y">
                  {data?.data?.map((inbox) => (
                    <InboxRow key={inbox.id} inbox={inbox} onExtend={() => extend.mutate(inbox.id)} onDelete={() => remove.mutate(inbox.id)} selected={selectedIds.has(inbox.id)} onToggleSelect={() => toggleSelect(inbox.id)} />
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data?.data?.map((inbox) => (
                    <InboxCard key={inbox.id} inbox={inbox} onExtend={() => extend.mutate(inbox.id)} onDelete={() => remove.mutate(inbox.id)} selected={selectedIds.has(inbox.id)} onToggleSelect={() => toggleSelect(inbox.id)} />
                  ))}
                </div>
              )}
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

/* ── Animated local-part preview ── */

/** Generates a cryptographically random alphanumeric string for preview.
 *  Uses crypto.getRandomValues (not Math.random) for unpredictability. */
function randomLocal(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Reads the prefers-reduced-motion media query as an external store rather than
 *  mirroring it into state from an effect. Seeding state in an effect renders
 *  once with the wrong value and then immediately again, which is both a
 *  cascading render and a flash of animation for users who asked for none.
 *  The server snapshot is `false`: the query is unknowable while rendering on
 *  the server, and animation is the markup the client hydrates against. */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** Shows a cycling random string preview (e.g. "a7k2x9") that updates every
 *  2.5 seconds with a smooth entrance animation. Respects prefers-reduced-motion
 *  (shows static text instead). When the user has typed an alias, shows that instead. */
function AnimatedLocalPart({ alias, fallbackText }: { alias: string; fallbackText: string }) {
  const [preview, setPreview] = useState(() => randomLocal(6));
  const [animKey, setAnimKey] = useState(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced || alias) return;
    const iv = setInterval(() => {
      setPreview(randomLocal(6));
      setAnimKey((k) => k + 1);
    }, 2500);
    return () => clearInterval(iv);
  }, [reduced, alias]);

  if (alias) {
    return <span className="font-mono text-xl sm:text-2xl font-bold text-foreground">{alias}</span>;
  }

  return (
    <span
      key={animKey}
      className="font-mono text-xl sm:text-2xl font-bold text-muted-foreground/50 local-part-enter inline-block"
    >
      {reduced ? fallbackText : preview}
    </span>
  );
}

/* ── Quick Create Card ── */

function QuickCreateCard() {
  const [assignmentId, setAssignmentId] = useState("");
  const [alias, setAlias] = useState("");
  const [ttlPreset, setTtlPreset] = useState("");
  const [customTtl, setCustomTtl] = useState("");
  const [ttlError, setTtlError] = useState<string | null>(null);
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

  // Validate custom TTL on change
  const handleCustomTtlChange = (value: string) => {
    setCustomTtl(value);
    if (value.trim()) {
      setTtlError(validateTtl(value, maxMins));
    } else {
      setTtlError(null);
    }
  };

  const isCustomInvalid = ttlPreset === "custom" && (!!ttlError || !customTtl.trim());

  const create = useCallback(async () => {
    if (!assignmentId || !ttl) return;
    // Final validation before submit
    if (ttlPreset === "custom") {
      const error = validateTtl(customTtl, maxMins);
      if (error) { setTtlError(error); return; }
    }
    setCreating(true);
    try {
      const res = await api.post<Inbox>(`/inboxes`, { domain_assignment_id: assignmentId, alias: alias || undefined, ttl });
      setCreatedInbox(res);
      qc.invalidateQueries({ queryKey: ["home-inboxes"] });
      qc.invalidateQueries({ queryKey: ["inboxes"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      // Surface API validation errors as inline if they're TTL-related
      if (msg.toLowerCase().includes("ttl")) {
        setTtlError(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setCreating(false);
    }
  }, [assignmentId, ttl, alias, qc, ttlPreset, customTtl, maxMins]);

  // Keyboard shortcut: 'n' to trigger Generate (only when no input is focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (assignmentId && !creating && !isCustomInvalid && !createdInbox) {
          create();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [assignmentId, creating, isCustomInvalid, createdInbox, create]);

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
      <div className="text-center space-y-6 py-4 generate-success">
        <div className="inline-flex items-center gap-2 rounded-full border bg-success/10 border-success/20 px-3.5 py-1.5">
          <span className="h-2 w-2 rounded-full bg-success dot-pulse" />
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
    <div className="text-center space-y-5 py-4">
      {/* Domain row — transforms to editable when Customize is active */}
      <div className="inline-flex flex-col items-center gap-3">
        <div className="inline-flex items-center gap-2 rounded-2xl border border-border/80 bg-card px-5 py-3 sm:px-6 sm:py-3.5 max-w-full shadow-sm">
          <Mail className="h-5 w-5 text-muted-foreground shrink-0" />
          {showAdvanced ? (
            <div className="relative">
              <Input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="custom"
                autoFocus
                className="h-auto border-0 bg-transparent p-0 font-mono text-xl sm:text-2xl font-bold shadow-none placeholder:text-muted-foreground/40 w-28 sm:w-36 focus-visible:ring-0"
                aria-label="Custom email alias"
              />
              {!alias && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-primary/40 animate-in fade-in duration-200" />
              )}
            </div>
          ) : (
            <AnimatedLocalPart alias={alias} fallbackText={t("randomPlaceholder")} />
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
            <span className="inline-flex items-center rounded-lg bg-primary/5 px-2 py-0.5 font-mono text-xl sm:text-2xl font-bold text-primary">{selected?.domain_name}</span>
          )}
        </div>
        {showAdvanced && (
          <p className="text-[11px] text-muted-foreground animate-in fade-in duration-150">{t("aliasHint")}</p>
        )}
      </div>

      {/* Action row — Generate button + TTL chip + Customize toggle */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={create} disabled={!assignmentId || creating || isCustomInvalid} size="lg" className="gap-2 px-6 h-11 text-sm font-semibold rounded-lg shadow-sm hover:shadow-md w-full sm:w-auto">
          {creating ? (
            <><RefreshCw className="h-4 w-4 animate-spin" /> {t("generating")}</>
          ) : (
            <><Zap className="h-4 w-4" /> {t("generate")}</>
          )}
        </Button>

        {/* TTL chip — inline Select dropdown */}
        <Select value={ttlPreset === "custom" ? "custom" : ttlPreset} onValueChange={(v) => { setTtlPreset(v); if (v !== "custom") setTtlError(null); }}>
          <SelectTrigger className="h-9 w-auto gap-1.5 rounded-lg border bg-muted/40 px-3 text-xs font-medium shadow-none">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue placeholder="1h" />
          </SelectTrigger>
          <SelectContent>
            {availablePresets.map((p) => <SelectItem key={p.value} value={p.value}>{presetLabels[p.key]}</SelectItem>)}
            <SelectItem value="custom">{ti("custom")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Customize toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={cn(
            "h-9 inline-flex items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-150",
            showAdvanced
              ? "border-primary/20 bg-primary/5 text-primary"
              : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:border-border/80"
          )}
        >
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`} />
          {t("customize")}
        </button>
      </div>

      {/* Custom TTL input — shown only when "Custom" is selected in the TTL chip */}
      {ttlPreset === "custom" && (
        <div className="max-w-xs mx-auto animate-in fade-in duration-150">
          <Input
            value={customTtl}
            onChange={(e) => handleCustomTtlChange(e.target.value)}
            placeholder={ti("customPlaceholder")}
            className={`h-8 text-sm font-mono text-center ${ttlError ? "border-destructive focus-visible:ring-destructive/20" : ""}`}
            aria-invalid={!!ttlError}
            aria-describedby={ttlError ? "ttl-error" : "ttl-hint"}
          />
          {ttlError ? (
            <p id="ttl-error" className="text-xs text-destructive mt-1">{ttlError}</p>
          ) : (
            <p id="ttl-hint" className="text-[11px] text-muted-foreground mt-1">Format: 10m, 1h, 2h30m (max 24h)</p>
          )}
        </div>
      )}

      {/* Keyboard shortcut hint — reduces perceived effort for power users */}
      {!showAdvanced && ttlPreset !== "custom" && (
        <p className="text-[10px] text-muted-foreground/60 hidden sm:block">
          Press <kbd className="inline-flex items-center justify-center h-4 min-w-[1rem] px-1 rounded border border-border/60 bg-muted/50 font-mono text-[9px] font-medium">N</kbd> to generate instantly
        </p>
      )}
    </div>
  );
}

/* ── Inbox card ── */

function InboxCard({ inbox, onExtend, onDelete, selected, onToggleSelect }: { inbox: Inbox; onExtend: () => void; onDelete: () => void; selected?: boolean; onToggleSelect?: () => void }) {
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
  const isEmpty = (inbox.email_count ?? 0) === 0;
  // Display-only time hint: Date.now() only controls a CSS border style, no logic depends on it
  // eslint-disable-next-line react-hooks/purity
  const expiringSoon = inbox.is_active && (new Date(inbox.expires_at).getTime() - Date.now()) < 10 * 60 * 1000;

  // Timer progress: percentage of time elapsed
  const totalMs = new Date(inbox.expires_at).getTime() - new Date(inbox.created_at).getTime();
  // eslint-disable-next-line react-hooks/purity
  const elapsedMs = Date.now() - new Date(inbox.created_at).getTime();
  const progressPct = inbox.is_active ? Math.min(Math.max((elapsedMs / totalMs) * 100, 0), 100) : 100;

  return (
    <Card
      className={cn(
        "transition-[color,box-shadow,border-color] duration-150 hover:border-primary/30 hover:shadow-md cursor-pointer group flex flex-col",
        !inbox.is_active && "opacity-50 border-dashed",
        expiringSoon && "border-warning/40",
        hasUnread && "border-primary/20",
        selected && "ring-2 ring-primary/30 border-primary/30",
      )}
      onClick={() => router.push(`/inboxes/${inbox.id}`)}
      onMouseEnter={() => router.prefetch(`/inboxes/${inbox.id}`)}
    >
      <CardContent className="pt-4 pb-3 flex flex-col flex-1 gap-2.5">
        {/* Address — copy-first: the address itself is the primary copy target */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            {onToggleSelect && (
              <input
                type="checkbox"
                checked={!!selected}
                onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
                onClick={(e) => e.stopPropagation()}
                className="h-4 w-4 rounded border-input accent-primary shrink-0"
                aria-label={`Select ${addr}`}
              />
            )}
            <button
              onClick={copyAddress}
              className={cn(
                "flex items-center gap-2 min-w-0 rounded-lg px-2 py-1.5 -mx-2 -my-1 transition-all duration-150",
                "hover:bg-primary/5 active:scale-[0.98]",
                copied && "bg-success/5",
              )}
              aria-label={`Copy ${addr}`}
            >
              <div className={cn(
                "h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-colors duration-150 relative",
                copied ? "bg-success/10" : hasUnread ? "bg-primary/10" : "bg-muted",
              )}>
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <>
                    <Copy className={cn("h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute", hasUnread ? "text-primary" : "text-muted-foreground")} />
                    <Mail className={cn("h-4 w-4 group-hover:opacity-0 transition-opacity duration-150", hasUnread ? "text-primary" : "text-muted-foreground")} />
                  </>
                )}
              </div>
              <div className="min-w-0 text-left">
                <p className="font-mono text-sm font-medium truncate group-hover:text-primary transition-colors duration-150">
                  <span>{localPart}</span>
                  <span className="text-muted-foreground">@</span>
                  <span className="text-primary/80">{domainPart}</span>
                </p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {copied ? tc("copied") : isEmpty && inbox.is_active ? "Waiting for mail" : !isEmpty ? `${inbox.email_count} email${inbox.email_count === 1 ? "" : "s"}` : "Expired"}
                </p>
              </div>
            </button>
          </div>
          {hasUnread && (
            <Badge className="shrink-0 text-[10px] px-1.5 py-0 animate-in fade-in">{inbox.unread_count}</Badge>
          )}
        </div>

        {/* Timer + progress — pushed to bottom via flex-1 on parent */}
        <div className="mt-auto space-y-1.5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span className={cn("flex items-center gap-1 ml-auto", expiringSoon && "text-warning font-medium")}>
              <Clock className="h-3 w-3" />
              <ExpiryLabel expiresAt={inbox.expires_at} isActive={inbox.is_active} totalTtl={inbox.original_ttl} />
            </span>
          </div>

          {/* Timer progress bar */}
          {inbox.is_active && (
            <div className="h-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", progressPct > 80 ? "bg-warning" : "bg-primary/40")}
                style={{ width: `${100 - progressPct}%` }}
              />
            </div>
          )}
        </div>

        {/* Actions — streamlined, copy removed since address is now the copy target */}
        <div className="flex items-center gap-1 pt-1 border-t" onClick={(e) => e.stopPropagation()}>
          {inbox.is_active && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs flex-1" onClick={(e) => { e.stopPropagation(); onExtend(); }}>
              <Timer className="h-3 w-3" /> {t("renew")}{inbox.original_ttl ? ` (${formatTtlLabel(inbox.original_ttl)})` : ""}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs flex-1" onClick={(e) => { e.stopPropagation(); router.push(`/inboxes/${inbox.id}`); }}>
            <ExternalLink className="h-3 w-3" /> Open
          </Button>
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

/* ── Inbox row (compact list view for 7+ inboxes) ── */

function InboxRow({ inbox, onExtend, onDelete, selected, onToggleSelect }: { inbox: Inbox; onExtend: () => void; onDelete: () => void; selected?: boolean; onToggleSelect?: () => void }) {
  const tc = useTranslations("common");
  const t = useTranslations("home");
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const addr = inbox.full_address || inbox.address;
  const [localPart, domainPart] = addr.split("@");
  const hasUnread = (inbox.unread_count ?? 0) > 0;
  // eslint-disable-next-line react-hooks/purity
  const expiringSoon = inbox.is_active && (new Date(inbox.expires_at).getTime() - Date.now()) < 10 * 60 * 1000;

  const totalMs = new Date(inbox.expires_at).getTime() - new Date(inbox.created_at).getTime();
  // eslint-disable-next-line react-hooks/purity
  const elapsedMs = Date.now() - new Date(inbox.created_at).getTime();
  const progressPct = inbox.is_active ? Math.min(Math.max((elapsedMs / totalMs) * 100, 0), 100) : 100;

  const copyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(addr);
    setCopied(true);
    toast.success(tc("copied"));
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors duration-150 cursor-pointer group",
        "hover:bg-muted/40",
        !inbox.is_active && "opacity-50",
        selected && "bg-primary/5",
      )}
      onClick={() => router.push(`/inboxes/${inbox.id}`)}
      onMouseEnter={() => router.prefetch(`/inboxes/${inbox.id}`)}
    >
      {/* Checkbox */}
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-input accent-primary shrink-0"
          aria-label={`Select ${addr}`}
        />
      )}

      {/* Address — click to copy */}
      <button
        onClick={copyAddress}
        className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-primary/5 active:scale-[0.99] transition-all duration-150"
        aria-label={`Copy ${addr}`}
      >
        <span className={cn(
          "h-6 w-6 rounded-md flex items-center justify-center shrink-0 relative",
          copied ? "bg-success/10" : hasUnread ? "bg-primary/10" : "bg-muted",
        )}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Mail className={cn("h-3.5 w-3.5", hasUnread ? "text-primary" : "text-muted-foreground")} />
          )}
        </span>
        <span className="font-mono text-sm font-medium truncate group-hover:text-primary transition-colors duration-150">
          <span>{localPart}</span>
          <span className="text-muted-foreground">@</span>
          <span className="text-primary/80">{domainPart}</span>
        </span>
        {hasUnread && (
          <Badge className="shrink-0 text-[10px] px-1.5 py-0 ml-1">{inbox.unread_count}</Badge>
        )}
      </button>

      {/* Timer */}
      <span className={cn("flex items-center gap-1 text-xs text-muted-foreground tabular-nums shrink-0", expiringSoon && "text-warning font-medium")}>
        <Clock className="h-3 w-3" />
        <ExpiryLabel expiresAt={inbox.expires_at} isActive={inbox.is_active} totalTtl={inbox.original_ttl} />
      </span>

      {/* Compact progress indicator */}
      {inbox.is_active && (
        <div className="w-12 h-1 rounded-full bg-muted overflow-hidden shrink-0 hidden sm:block">
          <div
            className={cn("h-full rounded-full", progressPct > 80 ? "bg-warning" : "bg-primary/40")}
            style={{ width: `${100 - progressPct}%` }}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150" onClick={(e) => e.stopPropagation()}>
        {inbox.is_active && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.stopPropagation(); onExtend(); }} aria-label={`Renew ${addr}`}>
            <Timer className="h-3.5 w-3.5" />
          </Button>
        )}
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" aria-label={`Delete ${addr}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          }
          title={t("deleteInbox")}
          description={t("deleteInboxDesc", { address: addr })}
          onConfirm={onDelete}
        />
      </div>
    </div>
  );
}

function ExpiryLabel({ expiresAt, isActive, totalTtl }: { expiresAt: string; isActive: boolean; totalTtl?: string }) {
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
      let remaining: string;
      if (h > 24) remaining = `${Math.floor(h / 24)}d ${h % 24}h`;
      else if (h > 0) remaining = `${h}h ${m}m`;
      else remaining = `${m}m`;
      // Show "remaining / total" when total is available
      if (totalTtl) {
        setLabel(`${remaining} / ${formatTtlLabel(totalTtl)}`);
      } else {
        setLabel(remaining);
      }
    };
    update();
    if (isActive) { const iv = setInterval(update, 60000); return () => clearInterval(iv); }
  }, [expiresAt, isActive, totalTtl]);
  return <span className="text-xs font-mono">{label}</span>;
}

function InboxGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="pt-4 pb-3 space-y-2.5">
            {/* Address row */}
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            {/* Stats row */}
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-20 ml-auto" />
            </div>
            {/* Progress bar */}
            <Skeleton className="h-1 w-full rounded-full" />
            {/* Actions row */}
            <div className="flex items-center gap-1 pt-0.5 border-t">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-7 w-7 ml-auto rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* Public landing page lives in @/components/landing/landing-page */
