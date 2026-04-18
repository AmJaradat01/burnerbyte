"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import type { AnalyticsStats, AuditEntry, EmailsPerDay, Inbox, PaginatedResponse } from "@/types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { timeAgo } from "@/lib/time";
import { Activity, Globe, Inbox as InboxIcon, Mail, Plus, Users } from "lucide-react";

const RechartsBarChart = dynamic(() => import("recharts").then((m) => m.BarChart), { ssr: false });
const RechartsAreaChart = dynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), { ssr: false });
const Area = dynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((m) => m.CartesianGrid), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

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
  return "bg-muted-foreground";
}

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
    queryFn: () => api.get<PaginatedResponse<Inbox>>(`/inboxes`, { status: "active", per_page: "1" }),
    enabled: !!org,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{greeting}, {user?.display_name?.split(" ")[0] || "there"}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Welcome to {org.name}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-muted-foreground">Active Inboxes</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400">
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

        <Card>
          <CardContent className="pt-5 pb-4 flex flex-col justify-between h-full">
            <span className="text-sm font-medium text-muted-foreground mb-3">Quick Actions</span>
            <Button asChild>
              <Link href="/"><Plus className="h-4 w-4 mr-2" />Create Inbox</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── Admin Dashboard ── */

function AdminDashboard({ org, user, greeting }: { org: { id: string; name: string }; user: any; greeting: string }) {
  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["org-analytics", org.id],
    queryFn: () => api.get<AnalyticsStats>(`/orgs/${org.id}/analytics`),
  });

  const { data: chart, isError: chartError } = useQuery({
    queryKey: ["org-emails-per-day", org.id],
    queryFn: () => api.get<{ data: EmailsPerDay[] }>(`/orgs/${org.id}/analytics/emails-per-day`, { days: "30" }),
  });

  const { data: chartWeek } = useQuery({
    queryKey: ["org-emails-week", org.id],
    queryFn: () => api.get<{ data: EmailsPerDay[] }>(`/orgs/${org.id}/analytics/emails-per-day`, { days: "7" }),
  });

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["dashboard-audit", org.id],
    queryFn: () => api.get<PaginatedResponse<AuditEntry>>(`/orgs/${org.id}/audit`, { per_page: "5", page: "1" }),
  });

  if (isError) return <ErrorState message="Failed to load dashboard" onRetry={() => refetch()} />;

  const weekTotal = chartWeek?.data?.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayCount = chartWeek?.data?.find((d) => d.date.startsWith(todayStr))?.count ?? 0;
  const yesterdayCount = chartWeek?.data?.find((d) => d.date.startsWith(yesterdayStr))?.count ?? 0;
  const todayDelta = todayCount - yesterdayCount;

  const chartData = chart?.data ?? [];

  // Enhancement 5: greeting emoji
  const greetingEmoji = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "☀️";
    if (h >= 12 && h < 17) return "🌤️";
    if (h >= 17 && h < 21) return "🌆";
    return "🌙";
  })();

  const topSenders = stats?.top_sender_domains?.slice(0, 3);
  const maxSenderCount = topSenders?.[0]?.count ?? 1;

  const tooltipStyle = {
    borderRadius: 8,
    border: "1px solid hsl(var(--border))",
    background: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {greetingEmoji} {greeting}, {user?.display_name?.split(" ")[0] || "there"}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">Here&apos;s what&apos;s happening with {org.name}</p>
      </div>

      {/* Primary stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Mail}
          label="Total Emails"
          value={stats?.total_emails_received ?? stats?.total_emails}
          loading={isLoading}
          accent="text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400"
          footer={
            <span className="text-xs text-muted-foreground">
              {formatBytes(stats?.total_storage_bytes ?? stats?.storage_used_bytes ?? 0)} all-time storage
            </span>
          }
        />
        <StatCard
          icon={InboxIcon}
          label="Active Inboxes"
          value={stats?.active_inboxes}
          loading={isLoading}
          accent="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400"
          footer={
            <Link href="/" className="text-xs text-primary hover:underline">
              Create inbox →
            </Link>
          }
        />
        <StatCard
          icon={Globe}
          label="Domains"
          value={stats?.total_domains}
          loading={isLoading}
          accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400"
          footer={
            <Link href="/domains" className="text-xs text-primary hover:underline">
              Manage →
            </Link>
          }
        />
        <StatCard
          icon={Users}
          label="Members"
          value={stats?.total_members}
          loading={isLoading}
          accent="text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400"
          footer={<span className="text-xs text-muted-foreground">{stats?.total_teams ?? 0} teams</span>}
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
                <CardTitle className="text-base">Email Volume</CardTitle>
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
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => v} formatter={(v) => [`${Number(v).toLocaleString()}`, "Emails"]} />
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

        </div>

        {/* Right column: weekly summary + audit + top senders */}
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
              <div>
                <p className="text-3xl font-bold">{weekTotal.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">emails received</p>
              </div>
              {chartWeek?.data && chartWeek.data.length > 0 ? (
                <ResponsiveContainer width="100%" height={140}>
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
                <div className="flex items-center justify-center h-[140px] text-xs text-muted-foreground">No data</div>
              )}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                <div>
                  <p className="text-lg font-semibold">{todayCount}</p>
                  <p className="text-[11px] text-muted-foreground">Today</p>
                </div>
                <div>
                  <p className="text-lg font-semibold">{Math.round(weekTotal / 7)}</p>
                  <p className="text-[11px] text-muted-foreground">Daily avg</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent Activity</CardTitle>
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
                <div className="space-y-3">
                  {auditData.data.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3">
                      <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${actionDotColor(entry.action)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{humanizeAction(entry.action)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {entry.actor_email ?? "System"} · {timeAgo(entry.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              )}
              <div className="mt-3 pt-3 border-t">
                <Link href="/audit" className="text-xs text-primary hover:underline">
                  View all activity →
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Top Senders */}
          {topSenders && topSenders.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Top Senders</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {topSenders.map((sd) => (
                  <div key={sd.domain}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="truncate">{sd.domain}</span>
                      <span className="text-muted-foreground tabular-nums">{sd.count.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(sd.count / maxSenderCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Stat Card ── */

function StatCard({ icon: Icon, label, value, loading, accent, footer }: {
  icon: typeof Mail;
  label: string;
  value?: number;
  loading: boolean;
  accent: string;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shadow-sm ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p className="text-2xl font-bold tabular-nums">{(value ?? 0).toLocaleString()}</p>
        )}
        {footer && <div className="mt-1.5">{footer}</div>}
      </CardContent>
    </Card>
  );
}
