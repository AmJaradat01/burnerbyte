"use client";

import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";

interface SystemStats {
  total_users: number;
  total_orgs: number;
  total_teams: number;
  total_domains: number;
  total_inboxes: number;
  total_emails: number;
  active_inboxes: number;
}

export default function AdminPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<SystemStats>("/admin/stats"),
  });

  if (isError) return <ErrorState message="Failed to load admin stats" onRetry={() => refetch()} />;
  if (isLoading) return <div className="space-y-6"><h1 className="text-2xl font-bold">System Admin</h1><div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 7 }).map((_, i) => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-10 w-20" /></CardContent></Card>)}</div></div>;
  if (!data) return null;

  const stats = [
    { label: "Users", value: data.total_users },
    { label: "Organizations", value: data.total_orgs },
    { label: "Teams", value: data.total_teams },
    { label: "Domains", value: data.total_domains },
    { label: "Active Inboxes", value: data.active_inboxes },
    { label: "Total Inboxes", value: data.total_inboxes },
    { label: "Total Emails", value: data.total_emails },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">System Admin</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{s.label}</CardTitle></CardHeader>
            <CardContent><p className="text-3xl font-bold">{s.value.toLocaleString()}</p></CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
