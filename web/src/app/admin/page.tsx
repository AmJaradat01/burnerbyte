"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState } from "@/components/error-state";
import { Pagination } from "@/components/pagination";
import { Activity, Building2, CheckCircle2, Database, Globe, HardDrive, Inbox, Mail, Users, XCircle } from "lucide-react";
import type { Organization, PaginatedResponse } from "@/types";

interface SystemStats {
  total_users: number;
  total_orgs: number;
  total_teams: number;
  total_domains: number;
  total_inboxes: number;
  total_emails: number;
  active_inboxes: number;
}

interface HealthStatus {
  postgres: string;
  redis: string;
}

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">System Admin</h1>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="orgs" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Organizations</TabsTrigger>
          <TabsTrigger value="health" className="gap-1.5"><Database className="h-3.5 w-3.5" /> Health</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="orgs"><OrgsTab /></TabsContent>
        <TabsContent value="health"><HealthTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<SystemStats>("/admin/stats"),
  });

  if (isError) return <ErrorState message="Failed to load stats" onRetry={() => refetch()} />;
  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 7 }).map((_, i) => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-8 w-16" /></CardContent></Card>)}</div>;
  if (!data) return null;

  const stats: { icon: typeof Mail; label: string; value: number; desc?: string }[] = [
    { icon: Users, label: "Users", value: data.total_users },
    { icon: Building2, label: "Organizations", value: data.total_orgs },
    { icon: Users, label: "Teams", value: data.total_teams },
    { icon: Globe, label: "Domains", value: data.total_domains },
    { icon: Inbox, label: "Active Inboxes", value: data.active_inboxes, desc: `${(data.total_inboxes ?? 0).toLocaleString()} total` },
    { icon: Mail, label: "Total Emails", value: data.total_emails },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{s.label}</span>
            </div>
            <p className="text-2xl font-bold">{(s.value ?? 0).toLocaleString()}</p>
            {s.desc && <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function OrgsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-orgs", page],
    queryFn: () => api.get<PaginatedResponse<Organization>>("/admin/orgs", { page: String(page), per_page: "20" }),
  });

  if (isError) return <ErrorState message="Failed to load organizations" onRetry={() => refetch()} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">All Organizations</CardTitle>
        <CardDescription>{data?.total ?? 0} organizations registered</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data?.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">{org.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{org.slug}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(org.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
                {(!data?.data || data.data.length === 0) && (
                  <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">No organizations</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <Pagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HealthTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-health"],
    queryFn: () => api.get<HealthStatus>("/admin/health"),
    refetchInterval: 15000,
  });

  if (isError) return <ErrorState message="Failed to check health" onRetry={() => refetch()} />;

  const services = data ? Object.entries(data) : [];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {isLoading ? (
        <>
          <Card><CardContent className="pt-6"><Skeleton className="h-12 w-full" /></CardContent></Card>
          <Card><CardContent className="pt-6"><Skeleton className="h-12 w-full" /></CardContent></Card>
        </>
      ) : (
        services.map(([name, status]) => {
          const ok = status === "ok";
          return (
            <Card key={name} className={ok ? "" : "border-destructive/50"}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {name === "postgres" ? <Database className="h-5 w-5 text-muted-foreground" /> : <HardDrive className="h-5 w-5 text-muted-foreground" />}
                    <div>
                      <p className="font-medium capitalize">{name}</p>
                      <p className="text-xs text-muted-foreground">{ok ? "Connected and responding" : status}</p>
                    </div>
                  </div>
                  {ok
                    ? <Badge className="gap-1 bg-green-100 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>
                    : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Error</Badge>
                  }
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
      {data && (
        <Card className="sm:col-span-2">
          <CardContent className="pt-6 text-xs text-muted-foreground">
            Auto-refreshing every 15 seconds. Last checked: {new Date().toLocaleTimeString()}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
