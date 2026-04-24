"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, WS_BASE } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { Sparkline } from "@/components/sparkline";
import type { AnalyticsStats, AuditEntry, EmailsPerDay, Inbox, PaginatedResponse } from "@/types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { timeAgo } from "@/lib/time";
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, Clock, Globe, HardDrive,
  Inbox as InboxIcon, Key, Mail, Minus, Plus, RefreshCw, Settings, Shield,
  TrendingUp, Users, Webhook, Zap,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { LastUpdated } from "@/components/last-updated";

const RechartsBarChart = dynamic(() => import("recharts").then((m) => m.BarChart), { ssr: false });
const RechartsAreaChart = dynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), { ssr: false });
const Area = dynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
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
  if (action.includes("created")) return "bg-emerald-500";
  if (action.includes("deleted") || action.includes("removed") || action.includes("revoked")) return "bg-red-500";
  if (action.includes("updated") || action.includes("changed")) return "bg-blue-500";
  if (action.includes("login")) return "bg-purple-500";
  if (action.includes("invited")) return "bg-indigo-500";
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

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  if (!org) return <p className="text-muted-foreground">Select an organization to view the dashboard.</p>;

  return isAdmin ? (
    <AdminDashboard org={org} user={user} greeting={greeting} />
  ) : (
    <MemberDashboard org={org} user={user} greeting={greeting} />
  );
}

/* ── Member Dashboard ── */

function MemberDashboard({ org, user, greeting }: { org: { id: string; name: string }; user: any; greeting: string }) {
  const { data: inboxes, isLoading } = useQuery({
    queryKey: ["member-inboxes-count", org.id],
    queryFn: () => api.get<PaginatedResponse<Inbox>>(`/inboxes`, { status: "active", per_page: "5" }),
    enabled: !!org,
  });

  const recentInboxes = inboxes?.data?.slice(0, 3) ?? [];

  return (
    <div className="space-y-6">
      <Card className="card-header-accent">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">{greeting}, {user?.display_name?.split(" ")[0] || "there"} 👋</h1>
              <p className="text-muted-foreground text-sm mt-0.5">Welcome to {org.name}</p>
            </div>
            <Button asChild>
              <Link href="/"><Plus className="h-4 w-4 mr-2" />Create Inbox</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:-translate-y-px">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">Active Inboxes</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm text-emerald-600 bg-emerald-100">
                <InboxIcon className="h-4 w-4" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className="text-2xl font-bold tabular-nums">{inboxes?.total ?? 0}</p>
            )}
          </CardContent>
        </Card>

        <Card className="transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:-translate-y-px">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">Quick Actions</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm text-blue-600 bg-blue-100">
                <Zap className="h-4 w-4" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline"><Link href="/" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Inbox</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/profile" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> Profile</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent inboxes */}
      {recentInboxes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Inboxes</CardTitle>
              <Link href="/" className="text-xs text-primary hover:underline">View all →</Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentInboxes.map((inbox) => (
                <Link key={inbox.id} href={`/inboxes/${inbox.id}`} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                      <Mail className="h-4 w-4 text-orange-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-mono font-medium truncate">{inbox.full_address || inbox.address}</p>
                      <p className="text-xs text-muted-foreground">{inbox.email_count ?? 0} emails</p>
                    </div>
                  </div>
                  <Badge variant={inbox.is_active ? "default" : "secondary"} className="text-[10px] shrink-0">
                    {inbox.is_active ? "Active" : "Expired"}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── Admin Dashboard ── */

function AdminDashboard({ org, user, greeting }: { org: { id: string; name: string }; user: any; greeting: string }) {
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
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const wsUrl = `${WS_BASE}/admin-stats?token=${token}`;
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let disposed = false;

    function connect() {
      if (disposed) return;
      ws = new WebSocket(wsUrl);
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
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, [autoRefresh, org.id, qc]);

  if (isError) return <ErrorState message="Failed to load dashboard" onRetry={() => refetch()} />;

  // Computed values
  const weekTotal = chartWeek?.data?.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayCount = chartWeek?.data?.find((d) => d.date.startsWith(todayStr))?.count ?? 0;
  const yesterdayCount = chartWeek?.data?.find((d) => d.date.startsWith(yesterdayStr))?.count ?? 0;
  const todayDelta = todayCount - yesterdayCount;
  const chartData = chart?.data ?? [];
  const weekTrend = chartWeek?.data?.map((d) => d.count);
  const chartAvg = chartData.length > 0 ? Math.round(chartData.reduce((s, d) => s + d.count, 0) / chartData.length) : 0;

  const greetingEmoji = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "☀️";
    if (h >= 12 && h < 17) return "🌤️";
    if (h >= 17 && h < 21) return "🌆";
    return "🌙";
  })();

  const topSenders = stats?.top_sender_domains?.slice(0, 5);
  const maxSenderCount = topSenders?.[0]?.count ?? 1;
  const totalSenderEmails = topSenders?.reduce((s, d) => s + d.count, 0) ?? 0;

  // Peak hour from insights
  const peakHour = useMemo(() => {
    if (!insights?.peak_hours?.length) return null;
    return insights.peak_hours.reduce((max, h) => h.count > max.count ? h : max, insights.peak_hours[0]);
  }, [insights?.peak_hours]);

  const tooltipStyle = {
    borderRadius: 8,
    border: "1px solid hsl(var(--border))",
    background: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="card-header-accent">
        <CardContent className="pt-5 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                {greetingEmoji} {greeting}, {user?.display_name?.split(" ")[0] || "there"}
              </h1>
              <p className="text-muted-foreground text-sm mt-0.5">Here&apos;s what&apos;s happening with {org.name}</p>
            </div>
            <div className="flex items-center gap-3">
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
        </CardContent>
      </Card>

      {/* Last updated */}
      <div className="flex items-center justify-between">
        <LastUpdated dataUpdatedAt={dataUpdatedAt} />
        {autoRefresh && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        )}
      </div>

      {/* Primary stats — 5 cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          icon={Mail}
          label="Total Emails"
          value={stats?.total_emails_received ?? stats?.total_emails}
          loading={isLoading}
          accent="text-blue-600 bg-blue-100"
          sparkline={weekTrend}
          delta={todayDelta}
          deltaLabel="vs yesterday"
          footer={
            <span className="text-xs text-muted-foreground">
              {formatBytes(stats?.total_storage_bytes ?? stats?.storage_used_bytes ?? 0)} storage
            </span>
          }
        />
        <StatCard
          icon={InboxIcon}
          label="Active Inboxes"
          value={stats?.active_inboxes}
          loading={isLoading}
          accent="text-emerald-600 bg-emerald-100"
          sparkline={weekTrend}
          footer={
            <span className="text-xs text-muted-foreground">
              {(stats?.total_inboxes_created ?? stats?.total_inboxes ?? 0).toLocaleString()} total created
            </span>
          }
        />
        <StatCard
          icon={Globe}
          label="Domains"
          value={stats?.total_domains}
          loading={isLoading}
          accent="text-violet-600 bg-violet-100"
          link="/domains"
        />
        <StatCard
          icon={Users}
          label="Members"
          value={stats?.total_members}
          loading={isLoading}
          accent="text-amber-600 bg-amber-100"
          footer={<span className="text-xs text-muted-foreground">{stats?.total_teams ?? 0} teams</span>}
          link="/settings"
        />
        <StatCard
          icon={HardDrive}
          label="Storage"
          value={formatBytes(stats?.total_storage_bytes ?? stats?.storage_used_bytes ?? 0)}
          loading={isLoading}
          accent="text-slate-600 bg-slate-100"
          isString
        />
      </div>

      {/* Charts + sidebar */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left column: charts */}
        <div className="lg:col-span-2 space-y-4">
          {/* 30-day volume chart */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
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
                  <RechartsAreaChart data={chartData}>
                    <defs>
                      <linearGradient id="emailGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Date: ${v}`} formatter={(v) => [`${Number(v).toLocaleString()}`, "Emails"]} />
                    <ReferenceLine y={chartAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="6 4" strokeOpacity={0.5} />
                    <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#emailGradient)" />
                  </RechartsAreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[280px] text-sm font-medium text-muted-foreground">
                  {chartError ? "Failed to load chart data" : "No email data yet"}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Peak hours heatmap */}
          {insights?.peak_hours && insights.peak_hours.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
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
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={formatHour} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => formatHour(Number(v))} formatter={(v) => [`${Number(v).toLocaleString()}`, "Emails"]} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} fillOpacity={0.8} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Weekly summary */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">This Week</CardTitle>
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Activity className="h-3 w-3" /> 7 days</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-3xl font-bold tabular-nums">{weekTotal.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">emails received</p>
                </div>
                {todayDelta !== 0 && (
                  <div className={`flex items-center gap-1 text-xs font-medium ${todayDelta > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {todayDelta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {Math.abs(todayDelta)} today
                  </div>
                )}
              </div>
              {chartWeek?.data && chartWeek.data.length > 0 ? (
                <ResponsiveContainer width="100%" height={120}>
                  <RechartsBarChart data={chartWeek.data}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => {
                      const d = new Date(v);
                      return d.toLocaleDateString(undefined, { weekday: "short" });
                    }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => v} formatter={(v) => [`${Number(v).toLocaleString()}`, "Emails"]} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[120px] text-xs text-muted-foreground">No data</div>
              )}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                <div className="text-center">
                  <p className="text-lg font-semibold tabular-nums">{todayCount}</p>
                  <p className="text-[10px] text-muted-foreground">Today</p>
                </div>
                <div className="text-center border-x border-border/50">
                  <p className="text-lg font-semibold tabular-nums">{yesterdayCount}</p>
                  <p className="text-[10px] text-muted-foreground">Yesterday</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold tabular-nums">{Math.round(weekTotal / 7)}</p>
                  <p className="text-[10px] text-muted-foreground">Daily avg</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Recent Activity</CardTitle>
                <Link href="/audit" className="text-xs text-primary hover:underline">View all →</Link>
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
                      <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${actionDotColor(entry.action)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{humanizeAction(entry.action)}</p>
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

          {/* Top Senders */}
          {topSenders && topSenders.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Top Senders</CardTitle>
                  <Link href="/analytics" className="text-xs text-primary hover:underline">Details →</Link>
                </div>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {topSenders.map((sd, i) => {
                  const pct = totalSenderEmails > 0 ? (sd.count / totalSenderEmails) * 100 : 0;
                  return (
                    <div key={sd.domain}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{i + 1}</span>
                          <span className="font-mono text-xs truncate">{sd.domain}</span>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-2">
                          {sd.count.toLocaleString()} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${(sd.count / maxSenderCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Domain breakdown from insights */}
          {insights?.domain_breakdown && insights.domain_breakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Emails by Domain</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {insights.domain_breakdown.map((d) => {
                  const total = insights.domain_breakdown.reduce((s, x) => s + x.count, 0);
                  const pct = total > 0 ? (d.count / total) * 100 : 0;
                  return (
                    <div key={d.domain}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-mono text-xs truncate">{d.domain}</span>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-2">
                          {d.count.toLocaleString()} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Quick links */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {[
              { href: "/", icon: InboxIcon, label: "Inboxes", color: "text-orange-600 bg-orange-100" },
              { href: "/domains", icon: Globe, label: "Domains", color: "text-emerald-600 bg-emerald-100" },
              { href: "/teams", icon: Users, label: "Teams", color: "text-indigo-600 bg-indigo-100" },
              { href: "/webhooks", icon: Webhook, label: "Webhooks", color: "text-amber-600 bg-amber-100" },
              { href: "/api-keys", icon: Key, label: "API Keys", color: "text-violet-600 bg-violet-100" },
              { href: "/analytics", icon: BarChart3, label: "Analytics", color: "text-rose-600 bg-rose-100" },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center gap-2.5 rounded-lg border p-3 hover:bg-muted/50 transition-colors group">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${item.color}`}>
                  <item.icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium group-hover:text-primary transition-colors">{item.label}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Stat Card ── */

function StatCard({ icon: Icon, label, value, loading, accent, footer, sparkline, delta, deltaLabel, link, isString }: {
  icon: typeof Mail;
  label: string;
  value?: number | string;
  loading: boolean;
  accent: string;
  footer?: React.ReactNode;
  sparkline?: number[];
  delta?: number;
  deltaLabel?: string;
  link?: string;
  isString?: boolean;
}) {
  const inner = (
    <Card className={`transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:-translate-y-px ${link ? "cursor-pointer" : ""}`}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shadow-sm ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className="text-2xl font-bold tabular-nums">
                {isString ? String(value ?? "—") : (typeof value === "number" ? value.toLocaleString() : "0")}
              </p>
            )}
            {/* Delta indicator */}
            {!loading && delta !== undefined && delta !== 0 && (
              <div className={`flex items-center gap-1 mt-0.5 text-xs font-medium ${delta > 0 ? "text-emerald-600" : "text-red-600"}`}>
                {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {delta > 0 ? "+" : ""}{delta} {deltaLabel}
              </div>
            )}
            {!loading && delta !== undefined && delta === 0 && (
              <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                <Minus className="h-3 w-3" /> No change {deltaLabel}
              </div>
            )}
          </div>
          {loading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            sparkline && <Sparkline data={sparkline} />
          )}
        </div>
        {footer && <div className="mt-1.5">{footer}</div>}
        {link && !loading && (
          <div className="mt-1.5">
            <span className="text-xs text-primary hover:underline">Manage →</span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (link) return <Link href={link} className="block">{inner}</Link>;
  return inner;
}
