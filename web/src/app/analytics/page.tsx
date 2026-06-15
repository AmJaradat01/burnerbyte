"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { ErrorState } from "@/components/error-state";
import { BarChart3 } from "lucide-react";

interface OrgStats {
  total_members: number; total_teams: number; total_domains: number;
  total_inboxes: number; total_emails: number; active_inboxes: number;
  storage_used_bytes: number; top_sender_domains?: { domain: string; count: number }[];
}
interface TeamStats { total_members: number; total_inboxes: number; total_emails: number; active_inboxes: number; }
interface TimeSeriesPoint { date: string; count: number; }
interface Insights {
  inboxes_per_day: { date: string; count: number }[];
  peak_hours: { hour: number; count: number }[];
  domain_breakdown: { domain: string; count: number }[];
}

const RANGES = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
];

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

export default function AnalyticsPage() {
  const { currentOrg, teams } = useOrgStore();
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0" aria-hidden="true">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h1 className="text-headline">Analytics</h1>
          <p className="text-sm text-muted-foreground">Usage metrics and trends for your organization.</p>
        </div>
      </header>

      {/* View selector: Organization overview or specific team */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">View:</span>
        <Select value={selectedTeamId || "__org__"} onValueChange={(v) => setSelectedTeamId(v === "__org__" ? "" : v)}>
          <SelectTrigger className="w-64 h-9">
            <SelectValue placeholder="Organization Overview" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__org__">Organization Overview</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>Team: {t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedTeamId && selectedTeam ? (
        <TeamAnalytics orgId={currentOrg.id} teamId={selectedTeam.id} />
      ) : (
        <OrgAnalytics orgId={currentOrg.id} />
      )}
    </div>
  );
}

function OrgAnalytics({ orgId }: { orgId: string }) {
  const [days, setDays] = useState("30");
  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics-org", orgId],
    queryFn: () => api.get<OrgStats>(`/orgs/${orgId}/analytics`),
  });
  const { data: timeSeries, isError: tsError, isLoading: tsLoading } = useQuery({
    queryKey: ["analytics-org-ts", orgId, days],
    queryFn: () => api.get<{ data: TimeSeriesPoint[] }>(`/orgs/${orgId}/analytics/emails-per-day`, { days }),
  });
  const { data: insights, isLoading: insightsLoading } = useQuery({
    queryKey: ["analytics-org-insights", orgId, days],
    queryFn: () => api.get<Insights>(`/orgs/${orgId}/analytics/insights`, { days }),
  });

  if (isError) return <ErrorState message="Failed to load analytics" onRetry={() => refetch()} />;
  if (isLoading) return <AnalyticsSkeleton columns={2} />;

  const emailAvg = timeSeries?.data?.length
    ? Math.round(timeSeries.data.reduce((s, d) => s + d.count, 0) / timeSeries.data.length)
    : 0;

  const totalSenderEmails = stats?.top_sender_domains?.reduce((s, d) => s + d.count, 0) ?? 0;
  const totalDomainEmails = insights?.domain_breakdown?.reduce((s, d) => s + d.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      {stats && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {stats.total_emails.toLocaleString()} emails · {stats.active_inboxes.toLocaleString()} inboxes · {stats.total_domains.toLocaleString()} domains this period
        </p>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">Overview</h2>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Enhanced emails per day */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Emails per Day</h3>
            {tsError && <ErrorState message="Failed to load email trends" />}
            {tsLoading && <Skeleton className="h-[300px] w-full rounded-xl" />}
            {timeSeries?.data && <EmailChart data={timeSeries.data} average={emailAvg} />}
          </div>

          {/* Inbox creation trend */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Inbox Creation Trend</h3>
            {insightsLoading && <Skeleton className="h-[300px] w-full rounded-xl" />}
            {insights?.inboxes_per_day && (
              <Card>
                <CardContent className="pt-6">
                  {insights.inboxes_per_day.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">No inbox data for this period.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={insights.inboxes_per_day}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)' }}
                          labelFormatter={(v) => `Date: ${v}`}
                          formatter={(v) => [`${Number(v).toLocaleString()}`, "Inboxes"]}
                        />
                        <Bar dataKey="count" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Peak hours */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Email Activity by Hour</h3>
            {insightsLoading && <Skeleton className="h-[300px] w-full rounded-xl" />}
            {insights?.peak_hours && (
              <Card>
                <CardContent className="pt-6">
                  {insights.peak_hours.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">No activity data for this period.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={insights.peak_hours}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={formatHour} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)' }}
                          labelFormatter={(v) => formatHour(Number(v))}
                          formatter={(v) => [`${Number(v).toLocaleString()}`, "Emails"]}
                        />
                        <Bar dataKey="count" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Domain breakdown */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Emails by Domain</h3>
            {insightsLoading && <Skeleton className="h-[120px] w-full rounded-xl" />}
            {insights?.domain_breakdown && insights.domain_breakdown.length > 0 && (
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="space-y-3">
                    {insights.domain_breakdown.map((d) => {
                      const pct = totalDomainEmails > 0 ? (d.count / totalDomainEmails) * 100 : 0;
                      return (
                        <div key={d.domain} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-mono truncate">{d.domain}</span>
                            <span className="text-muted-foreground ml-2 tabular-nums">{d.count.toLocaleString()} ({pct.toFixed(1)}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: "var(--chart-4)" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Top sender domains (enhanced with percentages) */}
          {stats?.top_sender_domains && stats.top_sender_domains.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Top Sender Domains</h3>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="space-y-2">
                    {stats.top_sender_domains.map((sd, i) => {
                      const max = stats.top_sender_domains![0].count;
                      const barPct = max > 0 ? (sd.count / max) * 100 : 0;
                      const totalPct = totalSenderEmails > 0 ? (sd.count / totalSenderEmails) * 100 : 0;
                      return (
                        <div key={sd.domain} className="flex items-center gap-3">
                          <span className="w-5 text-xs text-muted-foreground text-right">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-mono truncate">{sd.domain}</span>
                              <span className="text-sm text-muted-foreground ml-2 whitespace-nowrap tabular-nums">
                                {sd.count.toLocaleString()} ({totalPct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${barPct}%`, backgroundColor: "var(--chart-5)" }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamAnalytics({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [days, setDays] = useState("30");
  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics-team", teamId],
    queryFn: () => api.get<TeamStats>(`/orgs/${orgId}/teams/${teamId}/analytics`),
  });
  const { data: timeSeries, isError: tsError, isLoading: tsLoading } = useQuery({
    queryKey: ["analytics-team-ts", teamId, days],
    queryFn: () => api.get<{ data: TimeSeriesPoint[] }>(`/orgs/${orgId}/teams/${teamId}/analytics/emails-per-day`, { days }),
  });

  if (isError) return <ErrorState message="Failed to load team analytics" onRetry={() => refetch()} />;
  if (isLoading) return <AnalyticsSkeleton columns={1} />;

  return (
    <div className="space-y-6">
      {stats && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {stats.total_emails.toLocaleString()} emails · {stats.active_inboxes.toLocaleString()} inboxes · {stats.total_members.toLocaleString()} members this period
        </p>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">Emails per Day</h2>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>
      {tsError && <ErrorState message="Failed to load email trends" />}
      {tsLoading && <Skeleton className="h-[300px] w-full rounded-xl" />}
      {timeSeries?.data && <EmailChart data={timeSeries.data} />}
    </div>
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

function AnalyticsSkeleton({ columns }: { columns: 1 | 2 }) {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-72" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
      <div className={columns === 2 ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : ""}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-[340px] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function EmailChart({ data, average }: { data: TimeSeriesPoint[]; average?: number }) {
  if (data.length === 0) return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No email data for this period.</CardContent></Card>;

  const avg = average ?? Math.round(data.reduce((s, d) => s + d.count, 0) / data.length);

  return (
    <Card>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)' }}
              labelFormatter={(v) => `Date: ${v}`}
              formatter={(v) => [`${Number(v).toLocaleString()} (Avg: ${avg})`, "Emails"]}
            />
            <ReferenceLine y={avg} stroke="var(--muted-foreground)" strokeDasharray="6 4" label={{ value: `Avg: ${avg}`, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }} />
            <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
