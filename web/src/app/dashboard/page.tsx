"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import type { AnalyticsStats, EmailsPerDay } from "@/types";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

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

  const { data: chart } = useQuery({
    queryKey: ["org-emails-per-day", org?.id],
    queryFn: () => api.get<{ data: EmailsPerDay[] }>(`/orgs/${org!.id}/analytics/emails-per-day`),
    enabled: !!org,
  });

  if (!org) return <p className="text-muted-foreground">Select an organization to view the dashboard.</p>;
  if (isError) return <ErrorState message="Failed to load dashboard" onRetry={() => refetch()} />;

  const statCards = [
    { label: "Total Inboxes", value: stats?.total_inboxes },
    { label: "Active Inboxes", value: stats?.active_inboxes },
    { label: "Total Emails", value: stats?.total_emails },
    { label: "Domains", value: stats?.total_domains },
    { label: "Teams", value: stats?.total_teams },
    { label: "Members", value: stats?.total_members },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{greeting}, {user?.display_name?.split(" ")[0] || "there"}</h1>
          <p className="text-muted-foreground text-sm">{org.name} overview</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <p className="text-2xl font-bold">{s.value ?? 0}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Emails per Day</CardTitle>
        </CardHeader>
        <CardContent>
          {chart?.data && chart.data.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chart.data}>
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No email data yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
