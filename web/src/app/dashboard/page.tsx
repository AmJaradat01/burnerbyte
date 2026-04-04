"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import type { AnalyticsStats, EmailsPerDay } from "@/types";
import dynamic from "next/dynamic";
import { Activity, Globe, Inbox, Mail, TrendingUp, Users } from "lucide-react";

const RechartsBarChart = dynamic(() => import("recharts").then((m) => m.BarChart), { ssr: false });
const RechartsAreaChart = dynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Bar = dynamic(() => import("recharts").then((m) => m.Bar), { ssr: false });
const Area = dynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((m) => m.CartesianGrid), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

export default function DashboardPage() {
  const org = useOrgStore((s) => s.currentOrg);
  const user = useAuthStore((s) => s.user);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["org-analytics", org?.id],
    queryFn: () => api.get<AnalyticsStats>(`/orgs/${org!.id}/analytics`),
    enabled: !!org,
  });

  const { data: chart, isError: chartError } = useQuery({
    queryKey: ["org-emails-per-day", org?.id],
    queryFn: () => api.get<{ data: EmailsPerDay[] }>(`/orgs/${org!.id}/analytics/emails-per-day`, { days: "30" }),
    enabled: !!org,
  });

  const { data: chartWeek, isError: weekError } = useQuery({
    queryKey: ["org-emails-week", org?.id],
    queryFn: () => api.get<{ data: EmailsPerDay[] }>(`/orgs/${org!.id}/analytics/emails-per-day`, { days: "7" }),
    enabled: !!org,
  });

  if (!org) return <p className="text-muted-foreground">Select an organization to view the dashboard.</p>;
  if (isError) return <ErrorState message="Failed to load dashboard" onRetry={() => refetch()} />;

  const weekTotal = chartWeek?.data?.reduce((sum, d) => sum + d.count, 0) ?? 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayCount = chartWeek?.data?.find((d) => d.date.startsWith(todayStr))?.count ?? 0;
  const yesterdayCount = chartWeek?.data?.find((d) => d.date.startsWith(yesterdayStr))?.count ?? 0;
  const todayDelta = todayCount - yesterdayCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{greeting}, {user?.display_name?.split(" ")[0] || "there"}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Here&apos;s what&apos;s happening with {org.name}</p>
      </div>

      {/* Primary stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Mail}
          label="Total Emails"
          value={stats?.total_emails}
          loading={isLoading}
          accent="text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400"
          footer={(() => {
            if (yesterdayCount > 0) {
              const pct = Math.round((todayDelta / yesterdayCount) * 100);
              const color = pct > 0 ? "text-emerald-600" : pct < 0 ? "text-red-600" : "text-muted-foreground";
              return <span className={`flex items-center gap-1 text-xs ${color}`}><TrendingUp className="h-3 w-3" />{pct > 0 ? "+" : ""}{pct}% from yesterday</span>;
            }
            if (todayCount > 0) return <span className="flex items-center gap-1 text-xs text-emerald-600"><TrendingUp className="h-3 w-3" />+{todayCount} new</span>;
            return <span className="text-xs text-muted-foreground">No change</span>;
          })()}
        />
        <StatCard
          icon={Inbox}
          label="Active Inboxes"
          value={stats?.active_inboxes}
          loading={isLoading}
          accent="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400"
          footer={<span className="text-xs text-muted-foreground">{stats?.total_inboxes ?? 0} total created</span>}
        />
        <StatCard
          icon={Globe}
          label="Domains"
          value={stats?.total_domains}
          loading={isLoading}
          accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400"
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

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main chart - 30 day */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Email Volume</CardTitle>
              <span className="text-xs text-muted-foreground">Last 30 days</span>
            </div>
          </CardHeader>
          <CardContent>
            {chart?.data && chart.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <RechartsAreaChart data={chart.data}>
                  <defs>
                    <linearGradient id="emailGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                    labelFormatter={(v) => v}
                    formatter={(v) => [`${Number(v).toLocaleString()}`, "Emails"]}
                  />
                  <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#emailGradient)" />
                </RechartsAreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">{chartError ? "Failed to load chart data" : "No email data yet"}</div>
            )}
          </CardContent>
        </Card>

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
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" }}
                    labelFormatter={(v) => v}
                    formatter={(v) => [`${Number(v).toLocaleString()}`, "Emails"]}
                  />
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
          <span className="text-sm text-muted-foreground">{label}</span>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${accent}`}>
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
