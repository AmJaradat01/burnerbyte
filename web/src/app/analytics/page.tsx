"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ErrorState } from "@/components/error-state";
import { Globe, HardDrive, Inbox, Mail, Users, Building2 } from "lucide-react";

interface OrgStats {
  total_members: number; total_teams: number; total_domains: number;
  total_inboxes: number; total_emails: number; active_inboxes: number;
  storage_used_bytes: number; top_sender_domains?: { domain: string; count: number }[];
}
interface TeamStats { total_members: number; total_inboxes: number; total_emails: number; active_inboxes: number; }
interface TimeSeriesPoint { date: string; count: number; }

const RANGES = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function AnalyticsPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">Usage metrics and trends for your organization.</p>
      </div>
      <Tabs defaultValue="org">
        <TabsList>
          <TabsTrigger value="org">Organization</TabsTrigger>
          {currentTeam && <TabsTrigger value="team">{currentTeam.name}</TabsTrigger>}
        </TabsList>
        <TabsContent value="org"><OrgAnalytics orgId={currentOrg.id} /></TabsContent>
        {currentTeam && <TabsContent value="team"><TeamAnalytics orgId={currentOrg.id} teamId={currentTeam.id} /></TabsContent>}
      </Tabs>
    </div>
  );
}

function OrgAnalytics({ orgId }: { orgId: string }) {
  const [days, setDays] = useState("30");
  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics-org", orgId],
    queryFn: () => api.get<OrgStats>(`/orgs/${orgId}/analytics`),
  });
  const { data: timeSeries } = useQuery({
    queryKey: ["analytics-org-ts", orgId, days],
    queryFn: () => api.get<{ data: TimeSeriesPoint[] }>(`/orgs/${orgId}/analytics/emails-per-day`, { days }),
  });

  if (isError) return <ErrorState message="Failed to load analytics" onRetry={() => refetch()} />;
  if (isLoading) return <StatsSkeleton count={7} />;

  return (
    <div className="space-y-6">
      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={Mail} label="Total Emails" value={stats.total_emails} color="blue" />
            <StatCard icon={Inbox} label="Active Inboxes" value={stats.active_inboxes} subtitle={`${stats.total_inboxes ?? 0} total`} color="emerald" />
            <StatCard icon={Globe} label="Domains" value={stats.total_domains} color="violet" />
            <StatCard icon={Building2} label="Teams" value={stats.total_teams} color="amber" />
            <StatCard icon={Users} label="Members" value={stats.total_members} color="orange" />
            <StatCard icon={HardDrive} label="Storage" value={formatBytes(stats.storage_used_bytes ?? 0)} color="slate" />
          </div>

          {/* Top sender domains */}
          {stats.top_sender_domains && stats.top_sender_domains.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Top Sender Domains</CardTitle>
                <CardDescription>Most common origins of received emails</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {stats.top_sender_domains.map((sd, i) => {
                    const max = stats.top_sender_domains![0].count;
                    const pct = max > 0 ? (sd.count / max) * 100 : 0;
                    return (
                      <div key={sd.domain} className="flex items-center gap-3">
                        <span className="w-5 text-xs text-muted-foreground text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-mono truncate">{sd.domain}</span>
                            <span className="text-sm text-muted-foreground ml-2">{sd.count.toLocaleString()}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Emails per Day</h2>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>
      {timeSeries?.data && <EmailChart data={timeSeries.data} />}
    </div>
  );
}

function TeamAnalytics({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [days, setDays] = useState("30");
  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics-team", teamId],
    queryFn: () => api.get<TeamStats>(`/orgs/${orgId}/teams/${teamId}/analytics`),
  });
  const { data: timeSeries } = useQuery({
    queryKey: ["analytics-team-ts", teamId, days],
    queryFn: () => api.get<{ data: TimeSeriesPoint[] }>(`/orgs/${orgId}/teams/${teamId}/analytics/emails-per-day`, { days }),
  });

  if (isError) return <ErrorState message="Failed to load team analytics" onRetry={() => refetch()} />;
  if (isLoading) return <StatsSkeleton count={4} />;

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Mail} label="Total Emails" value={stats.total_emails} color="blue" />
          <StatCard icon={Inbox} label="Active Inboxes" value={stats.active_inboxes} subtitle={`${stats.total_inboxes ?? 0} total`} color="emerald" />
          <StatCard icon={Users} label="Members" value={stats.total_members} color="orange" />
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Emails per Day</h2>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>
      {timeSeries?.data && <EmailChart data={timeSeries.data} />}
    </div>
  );
}

const STAT_COLORS: Record<string, { bg: string; text: string }> = {
  blue: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-600 dark:text-blue-400" },
  emerald: { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-600 dark:text-emerald-400" },
  violet: { bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-600 dark:text-violet-400" },
  amber: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-600 dark:text-amber-400" },
  orange: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-600 dark:text-orange-400" },
  slate: { bg: "bg-slate-100 dark:bg-slate-900/30", text: "text-slate-600 dark:text-slate-400" },
};

function StatCard({ icon: Icon, label, value, subtitle, color = "blue" }: { icon: typeof Mail; label: string; value: number | string; subtitle?: string; color?: keyof typeof STAT_COLORS }) {
  const display = typeof value === "number" ? (value ?? 0).toLocaleString() : value;
  const c = STAT_COLORS[color];
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3 mb-2">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.bg}`}>
            <Icon className={`h-5 w-5 ${c.text}`} />
          </div>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <p className="text-2xl font-bold">{display}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function DateRangeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
      <SelectContent>
        {RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function StatsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}><CardContent className="pt-6"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-8 w-16" /></CardContent></Card>
      ))}
    </div>
  );
}

function EmailChart({ data }: { data: TimeSeriesPoint[] }) {
  if (data.length === 0) return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No email data for this period.</CardContent></Card>;

  return (
    <Card>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip labelFormatter={(v) => `Date: ${v}`} formatter={(v) => [`${Number(v).toLocaleString()}`, "Emails"]} />
            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
