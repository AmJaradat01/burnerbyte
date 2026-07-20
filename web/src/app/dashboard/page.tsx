"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, WS_BASE, getWsTicket } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NoOrgState } from "@/components/no-org-state";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { ChartTooltip } from "../analytics/chart-tooltip";
import { computeTrend } from "../analytics/page";
import type { AnalyticsStats, AuditEntry, EmailsPerDay, Inbox, PaginatedResponse, User } from "@/types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { timeAgo } from "@/lib/time";
import {
  ArrowDownRight, ArrowUpRight, BarChart3, Clock, Globe, HardDrive,
  Inbox as InboxIcon, Key, Mail, Plus, RefreshCw, Shield,
  TrendingUp, Users, Webhook,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { LastUpdated } from "@/components/last-updated";

const RechartsBarChart = dynamic(() => import("recharts").then((m) => m.BarChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((m) => m.CartesianGrid), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });
const ReferenceLine = dynamic(() => import("recharts").then((m) => m.ReferenceLine), { ssr: false });

/* ── Helpers ── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function humanizeAction(action: string): string {
  return action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function actionDotColor(action: string): string {
  if (action.includes("created")) return "bg-success/50";
  if (action.includes("deleted") || action.includes("removed") || action.includes("revoked")) return "bg-destructive/50";
  if (action.includes("updated") || action.includes("changed")) return "bg-info/50";
  if (action.includes("login")) return "bg-primary";
  if (action.includes("invited")) return "bg-primary";
  return "bg-muted-foreground";
}

function formatHour(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

interface Insights {
  inboxes_per_day: { date: string; count: number }[];
  peak_hours: { hour: number; count: number }[];
  domain_breakdown: { domain: string; count: number }[];
}

/* ── Page ── */

export default function DashboardPage() {
  const org = useOrgStore((s) => s.currentOrg);
  const user = useAuthStore((s) => s.user);
  const { hasPermission } = useOrgStore();
  const isAdmin = hasPermission("org.analytics.view") || user?.is_system_admin;
  const router = useRouter();

  // Computed once on mount so render stays pure (the hour does not change mid-session).
  const [greeting] = useState(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  });

  // Non-admin users are redirected to the home page (/) which has the
  // QuickCreate + inbox list — the dashboard is admin-only.
  useEffect(() => {
    if (!isAdmin) router.replace("/");
  }, [isAdmin, router]);

  if (!org) return <NoOrgState />;
  if (!isAdmin) return null;

  return <AdminDashboard org={org} user={user} greeting={greeting} />;
}

/* ── Admin Dashboard ── */

function AdminDashboard({ org, user, greeting }: { org: { id: string; name: string }; user: User | null; greeting: string }) {
  const qc = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("auto-refresh-enabled") === "true" : false
  );

  const { data: stats, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["org-analytics", org.id],
    queryFn: () => api.get<AnalyticsStats>(`/orgs/${org.id}/analytics`),
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  const { data: chart, isError: chartError } = useQuery({
    queryKey: ["org-emails-per-day", org.id],
    queryFn: () => api.get<{ data: EmailsPerDay[] }>(`/orgs/${org.id}/analytics/emails-per-day`, { days: "30" }),
  });

  const { data: chartWeek } = useQuery({
    queryKey: ["org-emails-week", org.id],
    queryFn: () => api.get<{ data: EmailsPerDay[] }>(`/orgs/${org.id}/analytics/emails-per-day`, { days: "7" }),
  });

  const { data: insights } = useQuery({
    queryKey: ["org-insights-dashboard", org.id],
    queryFn: () => api.get<Insights>(`/orgs/${org.id}/analytics/insights`, { days: "7" }),
  });

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["dashboard-audit", org.id],
    queryFn: () => api.get<PaginatedResponse<AuditEntry>>(`/orgs/${org.id}/audit`, { per_page: "6", page: "1" }),
  });

  // Real-time admin stats via WebSocket
  useEffect(() => {
    if (!autoRefresh) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let disposed = false;

    async function connect() {
      if (disposed) return;
      try {
        const ticket = await getWsTicket();
        if (disposed) return;
        ws = new WebSocket(`${WS_BASE}/admin-stats?ticket=${ticket}`);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "admin.stats" && msg.data) {
              qc.setQueryData(["org-analytics", org.id], (prev: AnalyticsStats | undefined) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  total_emails: msg.data.total_emails,
                  active_inboxes: msg.data.active_inboxes,
                  total_domains: msg.data.total_domains,
                  total_members: msg.data.total_users,
                  total_teams: msg.data.total_teams,
                  storage_used_bytes: msg.data.storage_used_bytes,
                };
              });
            }
          } catch { /* ignore parse errors */ }
        };
        ws.onclose = () => {
          if (!disposed) reconnectTimeout = setTimeout(connect, 5000);
        };
        ws.onerror = () => ws?.close();
      } catch {
        if (!disposed) reconnectTimeout = setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, [autoRefresh, org.id, qc]);

  // Computed values (kept above early return so hooks run unconditionally)
  const todayStr = new Date().toISOString().slice(0, 10);
  // Display-only time hint: Date.now() identifies yesterday's date bucket for a UI counter only
  // eslint-disable-next-line react-hooks/purity
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayCount = chartWeek?.data?.find((d) => d.date.startsWith(todayStr))?.count ?? 0;
  const yesterdayCount = chartWeek?.data?.find((d) => d.date.startsWith(yesterdayStr))?.count ?? 0;
  const todayDelta = todayCount - yesterdayCount;
  const chartData = chart?.data ?? [];
  const chartAvg = chartData.length > 0 ? Math.round(chartData.reduce((s, d) => s + d.count, 0) / chartData.length) : 0;

  const emailTrend = computeTrend(chartWeek?.data ?? []);
  const inboxTrend = computeTrend(insights?.inboxes_per_day ?? []);

  const topSenders = stats?.top_sender_domains?.slice(0, 5);
  const maxSenderCount = topSenders?.[0]?.count ?? 1;
  const totalSenderEmails = topSenders?.reduce((s, d) => s + d.count, 0) ?? 0;

  // Peak hour from insights
  const peakHour = useMemo(() => {
    if (!insights?.peak_hours?.length) return null;
    return insights.peak_hours.reduce((max, h) => h.count > max.count ? h : max, insights.peak_hours[0]);
  }, [insights?.peak_hours]);

  if (isError) return <ErrorState message="Failed to load dashboard" onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      {/* Header — compact, functional */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-headline">
            {greeting}, {user?.display_name?.split(" ").slice(0, 2).join(" ") || "there"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {org.name}
            {dataUpdatedAt ? <> · <LastUpdated dataUpdatedAt={dataUpdatedAt} /></> : null}
            {autoRefresh && (
              <span className="inline-flex items-center gap-1.5 ml-2 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Live
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <Switch
              checked={autoRefresh}
              onCheckedChange={(checked) => {
                setAutoRefresh(checked);
                localStorage.setItem("auto-refresh-enabled", String(checked));
              }}
              size="sm"
            />
            <span className="hidden sm:inline">Auto-refresh</span>
          </label>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { refetch(); qc.invalidateQueries({ queryKey: ["org-emails-per-day"] }); qc.invalidateQueries({ queryKey: ["org-emails-week"] }); qc.invalidateQueries({ queryKey: ["org-insights-dashboard"] }); qc.invalidateQueries({ queryKey: ["dashboard-audit"] }); }}>
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/"><Plus className="h-3.5 w-3.5" /> New Inbox</Link>
          </Button>
        </div>
      </div>

      {/* Primary metric — dominant, then supporting stats */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {/* Hero metric: Total Emails — same height as siblings */}
        <div className="rounded-xl border bg-card p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Emails</span>
            <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <p className="text-2xl font-bold tabular-nums tracking-tight">
              {(stats?.total_emails_received ?? stats?.total_emails ?? 0).toLocaleString()}
            </p>
          )}
          <div className="mt-1.5 h-4 flex items-center">
            {!isLoading && todayDelta !== 0 && (
              <span className={cn("flex items-center gap-1 text-[11px] font-semibold", todayDelta > 0 ? "text-success" : "text-destructive")}>
                {todayDelta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {todayDelta > 0 ? "+" : ""}{todayDelta} today
              </span>
            )}
            {!isLoading && todayDelta === 0 && (
              <span className="text-[11px] text-muted-foreground">{formatBytes(stats?.total_storage_bytes ?? stats?.storage_used_bytes ?? 0)} storage</span>
            )}
          </div>
        </div>
        {/* Supporting metrics — uniform with hero */}
        <StatCard icon={InboxIcon} label="Active Inboxes" value={stats?.active_inboxes} loading={isLoading} sub={`${(stats?.total_inboxes_created ?? stats?.total_inboxes ?? 0).toLocaleString()} total created`} trend={inboxTrend} />
        <StatCard icon={Globe} label="Domains" value={stats?.total_domains} loading={isLoading} sub={`${stats?.total_members ?? 0} members · ${stats?.total_teams ?? 0} teams`} link="/domains" />
        <StatCard icon={HardDrive} label="Storage" value={formatBytes(stats?.total_storage_bytes ?? stats?.storage_used_bytes ?? 0)} loading={isLoading} isString sub="All-time usage" />
        <StatCard icon={Mail} label="Emails Received" value={stats?.total_emails_received ?? stats?.total_emails ?? 0} loading={isLoading} sub="All-time" trend={emailTrend} />
        <StatCard icon={InboxIcon} label="Inboxes Created" value={stats?.total_inboxes_created ?? stats?.total_inboxes ?? 0} loading={isLoading} sub="All-time" />
      </div>

      {/* Charts + sidebar */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column: charts */}
        <div className="lg:col-span-2 space-y-4">
          {/* 30-day volume chart */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <CardTitle className="text-base">Email Volume</CardTitle>
                  {chartAvg > 0 && (
                    <Badge variant="outline" className="text-[10px] font-mono">avg {chartAvg}/day</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">Last 30 days</span>
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <RechartsBarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} stroke="var(--muted-foreground)" />
                    <Tooltip content={<ChartTooltip average={chartAvg} unit="emails" labelFormatter={(v) => `Date: ${v}`} />} />
                    <ReferenceLine y={chartAvg} stroke="var(--muted-foreground)" strokeDasharray="6 4" strokeOpacity={0.5} />
                    <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[280px] text-sm font-medium text-muted-foreground">
                  {chartError ? "Failed to load chart data" : "No email data yet"}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Peak hours */}
          {insights?.peak_hours && insights.peak_hours.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-base">Activity by Hour</CardTitle>
                    {peakHour && (
                      <Badge variant="outline" className="text-[10px]">Peak: {formatHour(peakHour.hour)}</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">Last 7 days</span>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <RechartsBarChart data={insights.peak_hours}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={formatHour} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} stroke="var(--muted-foreground)" />
                    <Tooltip content={<ChartTooltip average={peakHour?.count ?? 0} unit="emails" labelFormatter={(v) => formatHour(Number(v))} />} />
                    <Bar dataKey="count" fill="var(--chart-1)" radius={[3, 3, 0, 0]} fillOpacity={0.85} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Top Senders + Domain Breakdown side by side */}
          <div className="grid gap-4 sm:grid-cols-2">
            {topSenders && topSenders.length > 0 && (
              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
                        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <CardTitle className="text-sm">Top Senders</CardTitle>
                    </div>
                    <Link href="/analytics" className="text-xs text-primary font-medium hover:underline">Details</Link>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {topSenders.map((sd, i) => {
                    const pct = totalSenderEmails > 0 ? (sd.count / totalSenderEmails) * 100 : 0;
                    return (
                      <div key={sd.domain} className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-muted-foreground w-3 text-right shrink-0 tabular-nums">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs truncate block">{sd.domain}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{sd.count}</span>
                        <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0 w-8 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {insights?.domain_breakdown && insights.domain_breakdown.length > 0 && (
              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-sm">Emails by Domain</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {insights.domain_breakdown.map((d) => {
                    const total = insights.domain_breakdown.reduce((s, x) => s + x.count, 0);
                    const pct = total > 0 ? (d.count / total) * 100 : 0;
                    return (
                      <div key={d.domain} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs truncate block">{d.domain}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{d.count}</span>
                        <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0 w-8 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Inbox Activity */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
                    <InboxIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <CardTitle className="text-base">Inbox Activity</CardTitle>
                </div>
                <Badge variant="outline" className="text-[10px]">7 days</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-semibold tabular-nums">
                  {(insights?.inboxes_per_day?.reduce((s, d) => s + d.count, 0) ?? 0).toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">inboxes created this week</span>
              </div>
              {insights?.inboxes_per_day && insights.inboxes_per_day.length > 0 ? (
                <ResponsiveContainer width="100%" height={120}>
                  <RechartsBarChart data={insights.inboxes_per_day}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => {
                      const d = new Date(v);
                      return d.toLocaleDateString(undefined, { weekday: "short" });
                    }} stroke="var(--muted-foreground)" />
                    <Tooltip content={<ChartTooltip average={Math.round((insights.inboxes_per_day.reduce((s, d) => s + d.count, 0)) / insights.inboxes_per_day.length)} unit="inboxes" labelFormatter={(v) => `${v}`} />} />
                    <Bar dataKey="count" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[120px] text-xs text-muted-foreground">No inbox data</div>
              )}
              {inboxTrend !== null && (
                <p className={cn("text-xs font-medium", inboxTrend > 0 ? "text-success" : inboxTrend < 0 ? "text-destructive" : "text-muted-foreground")}>
                  {inboxTrend > 0 ? "+" : ""}{inboxTrend.toFixed(1)}% vs previous period
                </p>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <CardTitle className="text-base">Recent Activity</CardTitle>
                </div>
                <Link href="/audit" className="text-xs text-primary font-medium hover:underline">View all →</Link>
              </div>
            </CardHeader>
            <CardContent>
              {auditLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-2 w-2 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-2.5 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : auditData?.data && auditData.data.length > 0 ? (
                <div className="space-y-2.5">
                  {auditData.data.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3 group">
                      <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${actionDotColor(entry.action)}`} aria-hidden="true" />
                      <span className="sr-only">{humanizeAction(entry.action)} status</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors duration-150">{humanizeAction(entry.action)}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {entry.actor_email ?? "System"} · {timeAgo(entry.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">No recent activity</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        {[
          { href: "/", icon: InboxIcon, label: "Inboxes" },
          { href: "/domains", icon: Globe, label: "Domains" },
          { href: "/teams", icon: Users, label: "Teams" },
          { href: "/webhooks", icon: Webhook, label: "Webhooks" },
          { href: "/api-keys", icon: Key, label: "API Keys" },
          { href: "/analytics", icon: BarChart3, label: "Analytics" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground transition-all duration-150 hover:text-foreground hover:bg-muted/80 hover:border-primary/20 active:scale-[0.97]"
          >
            <item.icon className="h-3.5 w-3.5 shrink-0 transition-colors duration-150 group-hover:text-primary" />
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ── Stat Card (compact, uniform height) ── */

function StatCard({ icon: Icon, label, value, loading, sub, delta, deltaLabel, link, isString, trend }: {
  icon: typeof Mail;
  label: string;
  value?: number | string;
  loading: boolean;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  link?: string;
  isString?: boolean;
  trend?: number | null;
}) {
  const inner = (
    <div className={cn(
      "rounded-xl border bg-card p-4 flex flex-col h-full transition-all duration-150",
      link && "cursor-pointer hover:border-primary/20 hover:shadow-sm",
    )}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <p className="text-2xl font-bold tabular-nums tracking-tight">
          {isString ? String(value ?? "—") : (typeof value === "number" ? value.toLocaleString() : "0")}
        </p>
      )}
      <div className="mt-auto pt-1.5 h-4 flex items-center">
        {!loading && delta !== undefined && delta !== 0 ? (
          <span className={cn("flex items-center gap-1 text-[11px] font-medium", delta > 0 ? "text-success" : "text-destructive")}>
            {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {delta > 0 ? "+" : ""}{delta} {deltaLabel}
          </span>
        ) : sub ? (
          <span className="text-[11px] text-muted-foreground truncate">{sub}</span>
        ) : link ? (
          <span className="text-[11px] text-primary font-medium">Manage</span>
        ) : null}
        {!loading && trend !== undefined && trend !== null && (
          <span className={cn("flex items-center gap-1 text-[11px] font-medium ml-auto", trend > 0 ? "text-success" : trend < 0 ? "text-destructive" : "text-muted-foreground")}>
            {trend > 0 ? <ArrowUpRight className="h-3 w-3" /> : trend < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
            {trend > 0 ? "+" : ""}{trend.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );

  if (link) return <Link href={link} className="block">{inner}</Link>;
  return inner;
}
