"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";

interface OrgStats { total_members: number; total_teams: number; total_domains: number; total_inboxes: number; total_emails: number; active_inboxes: number; }
interface TeamStats { total_members: number; total_inboxes: number; total_emails: number; active_inboxes: number; }
interface TimeSeriesPoint { date: string; count: number; }

const RANGES = [
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
];

export default function AnalyticsPage() {
  const { currentOrg, currentTeam } = useOrgStore();
  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <Tabs defaultValue="org">
        <TabsList>
          <TabsTrigger value="org">Organization</TabsTrigger>
          {currentTeam && <TabsTrigger value="team">Team</TabsTrigger>}
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
  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-10 w-20" /></CardContent></Card>)}</div>;

  return (
    <div className="space-y-6">
      {stats && <StatsGrid stats={[
        { label: "Members", value: stats.total_members },
        { label: "Teams", value: stats.total_teams },
        { label: "Domains", value: stats.total_domains },
        { label: "Active Inboxes", value: stats.active_inboxes },
        { label: "Total Inboxes", value: stats.total_inboxes },
        { label: "Total Emails", value: stats.total_emails },
      ]} />}
      <DateRangeSelector value={days} onChange={setDays} />
      {timeSeries?.data && <EmailChart data={timeSeries.data} />}
    </div>
  );
}

function TeamAnalytics({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [days, setDays] = useState("30");
  const { data: stats } = useQuery({
    queryKey: ["analytics-team", teamId],
    queryFn: () => api.get<TeamStats>(`/orgs/${orgId}/teams/${teamId}/analytics`),
  });
  const { data: timeSeries } = useQuery({
    queryKey: ["analytics-team-ts", teamId, days],
    queryFn: () => api.get<{ data: TimeSeriesPoint[] }>(`/orgs/${orgId}/teams/${teamId}/analytics/emails-per-day`, { days }),
  });

  return (
    <div className="space-y-6">
      {stats && <StatsGrid stats={[
        { label: "Members", value: stats.total_members },
        { label: "Active Inboxes", value: stats.active_inboxes },
        { label: "Total Inboxes", value: stats.total_inboxes },
        { label: "Total Emails", value: stats.total_emails },
      ]} />}
      <DateRangeSelector value={days} onChange={setDays} />
      {timeSeries?.data && <EmailChart data={timeSeries.data} />}
    </div>
  );
}

function DateRangeSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Range:</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatsGrid({ stats }: { stats: { label: string; value: number }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{s.label}</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-bold">{s.value.toLocaleString()}</p></CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmailChart({ data }: { data: TimeSeriesPoint[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Emails per day</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
