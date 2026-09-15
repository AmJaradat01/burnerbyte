"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { NoOrgState } from "@/components/no-org-state";
import { useOrgStore } from "@/stores/org-store";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { ErrorState } from "@/components/error-state";
import { BarChart3, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Globe } from "lucide-react";
import { ChartTooltip } from "./chart-tooltip";
import { DomainDetailChart } from "./domain-detail-chart";

const StorageTrendChart = dynamic(() => import('./storage-trend-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[300px] w-full rounded-xl" />,
});

interface OrgStats {
  total_members: number; total_teams: number; total_domains: number;
  total_inboxes: number; total_emails: number; active_inboxes: number;
  storage_used_bytes: number; top_sender_domains?: { domain: string; count: number }[];
  total_emails_received: number; total_inboxes_created: number;
  total_storage_bytes: number;
}
interface TeamStats { total_members: number; total_inboxes: number; total_emails: number; active_inboxes: number; }
interface TimeSeriesPoint { date: string; count: number; }
interface Insights {
  inboxes_per_day: { date: string; count: number }[];
  peak_hours: { hour: number; count: number }[];
  domain_breakdown: { domain: string; count: number }[];
  storage_per_day: { date: string; storage_bytes: number }[];
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(k, index);
  return `${value.toFixed(1)} ${units[index]}`;
}

/**
 * Computes a trend percentage by splitting time-series data into two halves
 * and comparing the sum of the second half (recent) to the first half (earlier).
 * Returns null if insufficient data or if the first half sums to zero.
 * Result is capped at +/-999%.
 */
export function computeTrend(data: { count: number }[]): number | null {
  if (!data || data.length < 2) return null;

  const midpoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, midpoint);
  const secondHalf = data.slice(midpoint);

  const previousSum = firstHalf.reduce((sum, point) => sum + point.count, 0);
  const currentSum = secondHalf.reduce((sum, point) => sum + point.count, 0);

  if (previousSum === 0) return null;

  const trend = ((currentSum - previousSum) / previousSum) * 100;

  // Cap at +/-999%
  return Math.max(-999, Math.min(999, trend));
}

export default function AnalyticsPage() {
  const { currentOrg, teams } = useOrgStore();
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  if (!currentOrg) return <NoOrgState />;

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
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
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
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4">
          <MetricCard label="Total Emails" value={stats.total_emails.toLocaleString()} trend={computeTrend(timeSeries?.data ?? [])} />
          <MetricCard label="Total Inboxes" value={stats.total_inboxes.toLocaleString()} trend={computeTrend(insights?.inboxes_per_day ?? [])} />
          <MetricCard label="Total Domains" value={stats.total_domains.toLocaleString()} trend={null} />
          <MetricCard label="Storage Used" value={`${formatBytes(stats.storage_used_bytes)} / ${formatBytes(stats.total_storage_bytes)}`} trend={null} />
          <MetricCard label="Members" value={stats.total_members.toLocaleString()} trend={null} />
          <MetricCard label="Teams" value={stats.total_teams.toLocaleString()} trend={null} />
          <MetricCard label="Emails Received" value={stats.total_emails_received.toLocaleString()} trend={null} />
          <MetricCard label="Inboxes Created" value={stats.total_inboxes_created.toLocaleString()} trend={null} />
        </div>
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
                    (() => {
                      const inboxAvg = Math.round(insights.inboxes_per_day.reduce((s, d) => s + d.count, 0) / insights.inboxes_per_day.length);
                      return (
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={insights.inboxes_per_day}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => v.slice(5)} />
                            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                            <Tooltip content={<ChartTooltip average={inboxAvg} unit="inboxes" labelFormatter={(v) => `Date: ${v}`} />} />
                            <Bar dataKey="count" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Storage trend */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Storage Trend</h3>
            {insightsLoading && <Skeleton className="h-[300px] w-full rounded-xl" />}
            {!insightsLoading && (
              <StorageTrendChart data={insights?.storage_per_day ?? []} />
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
                    (() => {
                      const hourAvg = Math.round(insights.peak_hours.reduce((s, d) => s + d.count, 0) / insights.peak_hours.length);
                      return (
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={insights.peak_hours}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                            <XAxis dataKey="hour" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={formatHour} />
                            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                            <Tooltip content={<ChartTooltip average={hourAvg} unit="emails" labelFormatter={(v) => formatHour(Number(v))} />} />
                            <Bar dataKey="count" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Domain breakdown */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Emails by Domain</h3>
            {insightsLoading && <Skeleton className="h-[120px] w-full rounded-xl" />}
            {insights?.domain_breakdown && (
              insights.domain_breakdown.length > 0 ? (
                <Card>
                  <CardContent className="pt-5 pb-4">
                    <div className="space-y-1">
                      {insights.domain_breakdown.map((d) => {
                        const pct = totalDomainEmails > 0 ? (d.count / totalDomainEmails) * 100 : 0;
                        const isExpanded = expandedDomain === d.domain;
                        return (
                          <div key={d.domain}>
                            <button
                              type="button"
                              onClick={() => setExpandedDomain(isExpanded ? null : d.domain)}
                              className="flex items-center gap-3 w-full text-left hover:bg-muted/40 -mx-2 px-2 py-1.5 rounded-md transition-colors"
                              aria-expanded={isExpanded}
                              aria-label={`${d.domain}: ${d.count.toLocaleString()} emails, ${pct.toFixed(1)}%`}
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                              )}
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-mono truncate block">{d.domain}</span>
                              </div>
                              <span className="text-sm text-muted-foreground tabular-nums shrink-0">{d.count.toLocaleString()}</span>
                              <span className="text-xs text-muted-foreground/70 tabular-nums shrink-0 w-12 text-right">{pct.toFixed(1)}%</span>
                            </button>
                            {isExpanded && (
                              <DomainDetailChart orgId={orgId} domain={d.domain} days={days} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-16 flex flex-col items-center justify-center text-center">
                    <Globe className="h-8 w-8 text-muted-foreground mb-3" aria-hidden="true" />
                    <p className="text-sm font-medium text-muted-foreground">No domain data</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Emails will appear here once your domains receive traffic.</p>
                  </CardContent>
                </Card>
              )
            )}
          </div>

          {/* Top sender domains (enhanced with percentages) */}
          {stats?.top_sender_domains && stats.top_sender_domains.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Top Sender Domains</h3>
              <Card>
                <CardContent className="pt-5 pb-4">
                  <div className="space-y-3">
                    {stats.top_sender_domains.map((sd, i) => {
                      const totalPct = totalSenderEmails > 0 ? (sd.count / totalSenderEmails) * 100 : 0;
                      return (
                        <div key={sd.domain} className="flex items-center gap-3">
                          <span className="w-5 text-xs font-mono text-muted-foreground text-right tabular-nums shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-mono truncate block">{sd.domain}</span>
                          </div>
                          <span className="text-sm text-muted-foreground tabular-nums shrink-0">{sd.count.toLocaleString()}</span>
                          <span className="text-xs text-muted-foreground/70 tabular-nums shrink-0 w-12 text-right">{totalPct.toFixed(1)}%</span>
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

export function TeamAnalytics({ orgId, teamId }: { orgId: string; teamId: string }) {
  const [days, setDays] = useState("30");
  const { data: stats, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics-team", teamId],
    queryFn: () => api.get<TeamStats>(`/orgs/${orgId}/teams/${teamId}/analytics`),
  });
  const { data: timeSeries, isError: tsError, isLoading: tsLoading } = useQuery({
    queryKey: ["analytics-team-ts", teamId, days],
    queryFn: () => api.get<{ data: TimeSeriesPoint[] }>(`/orgs/${orgId}/teams/${teamId}/analytics/emails-per-day`, { days }),
  });
  const { data: teamInsights, isLoading: teamInsightsLoading } = useQuery({
    queryKey: ["analytics-team-insights", teamId, days],
    queryFn: () => api.get<{ inboxes_per_day: { date: string; count: number }[]; storage_per_day: { date: string; storage_bytes: number }[] }>(`/orgs/${orgId}/teams/${teamId}/analytics/insights`, { days }),
  });

  if (isError) return <ErrorState message="Failed to load team analytics" onRetry={() => refetch()} />;
  if (isLoading) return <AnalyticsSkeleton columns={1} />;

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Emails" value={stats.total_emails.toLocaleString()} trend={computeTrend(timeSeries?.data ?? [])} />
          <MetricCard label="Total Inboxes" value={stats.total_inboxes.toLocaleString()} trend={computeTrend(teamInsights?.inboxes_per_day ?? [])} />
          <MetricCard label="Active Inboxes" value={stats.active_inboxes.toLocaleString()} trend={null} />
          <MetricCard label="Members" value={stats.total_members.toLocaleString()} trend={null} />
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">Overview</h2>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Emails per day */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Emails per Day</h3>
            {tsError && <ErrorState message="Failed to load email trends" />}
            {tsLoading && <Skeleton className="h-[300px] w-full rounded-xl" />}
            {timeSeries?.data && <EmailChart data={timeSeries.data} />}
          </div>

          {/* Inbox creation trend */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Inbox Creation Trend</h3>
            {teamInsightsLoading && <Skeleton className="h-[300px] w-full rounded-xl" />}
            {teamInsights?.inboxes_per_day && (
              <Card>
                <CardContent className="pt-6">
                  {teamInsights.inboxes_per_day.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">No inbox data for this period.</p>
                  ) : (
                    (() => {
                      const inboxAvg = Math.round(teamInsights.inboxes_per_day.reduce((s, d) => s + d.count, 0) / teamInsights.inboxes_per_day.length);
                      return (
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={teamInsights.inboxes_per_day}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => v.slice(5)} />
                            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
                            <Tooltip content={<ChartTooltip average={inboxAvg} unit="inboxes" labelFormatter={(v) => `Date: ${v}`} />} />
                            <Bar dataKey="count" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Storage trend */}
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Storage Trend</h3>
            {teamInsightsLoading && <Skeleton className="h-[300px] w-full rounded-xl" />}
            {!teamInsightsLoading && (
              <StorageTrendChart data={teamInsights?.storage_per_day ?? []} />
            )}
          </div>
        </div>
      </div>
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
  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No email data for this period.</CardContent></Card>;
  }

  const avg = average ?? Math.round(data.reduce((s, d) => s + d.count, 0) / data.length);

  return (
    <Card>
      <CardContent className="pt-6">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
            <Tooltip content={<ChartTooltip average={avg} unit="emails" labelFormatter={(v) => `Date: ${v}`} />} />
            {avg > 0 && (
              <ReferenceLine y={avg} stroke="var(--muted-foreground)" strokeDasharray="6 4" label={{ value: `Avg: ${avg}`, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }} />
            )}
            <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, trend }: { label: string; value: string; trend: number | null }) {
  return (
    <div className="border-t pt-4 space-y-1">
      <span className="text-label text-muted-foreground">{label}</span>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <div className="flex h-4 items-center gap-1">
        {trend === null ? null : trend > 0 ? (
          <span className="flex items-center gap-1 text-[oklch(0.45_0.15_145)]">
            <TrendingUp className="h-3 w-3" aria-hidden="true" />
            <span className="text-xs tabular-nums">+{Math.min(trend, 999).toFixed(1)}%</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[oklch(0.45_0.15_25)]">
            <TrendingDown className="h-3 w-3" aria-hidden="true" />
            <span className="text-xs tabular-nums">{Math.max(trend, -999).toFixed(1)}%</span>
          </span>
        )}
      </div>
    </div>
  );
}
