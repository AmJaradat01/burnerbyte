"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Monitor, CheckCircle2, Smartphone, Tablet } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SessionIllustration } from "@/components/illustrations";
import { UAParser } from "ua-parser-js";
import type { Session } from "@/types";

function parseUserAgent(ua?: string): { browser: string; os: string; device: string } {
  if (!ua) return { browser: "Unknown browser", os: "Unknown OS", device: "desktop" };
  const parser = new UAParser(ua);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();

  return {
    browser: browser.name || "Unknown browser",
    os: os.name ? `${os.name}${os.version ? " " + os.version : ""}` : "Unknown OS",
    device: device.type || "desktop",
  };
}

function getDeviceIcon(deviceType: string) {
  switch (deviceType) {
    case "mobile": return <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />;
    case "tablet": return <Tablet className="h-4 w-4 text-muted-foreground shrink-0" />;
    default: return <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

export default function SessionsPage() {
  const qc = useQueryClient();

  const { data: sessions, isLoading, isError, refetch } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<Session[]>("/auth/sessions"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/auth/sessions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sessions"] }); toast.success("Session revoked"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const revokeAll = useMutation({
    mutationFn: () => api.del("/auth/sessions"),
    onSuccess: () => {
      toast.success("All sessions revoked — signing out…");
      // Current session is now invalid, force logout
      setTimeout(() => {
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        window.location.href = "/login";
      }, 1000);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (isError) return <ErrorState message="Failed to load sessions" onRetry={() => refetch()} />;

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="card-header-accent">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-blue-500/10 flex items-center justify-center">
                <Monitor className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h1 className="text-base font-semibold">Active Sessions</h1>
                <p className="text-sm text-muted-foreground">Manage your active sessions across devices.</p>
              </div>
            </div>
            <ConfirmDialog
              trigger={<Button variant="destructive" size="sm">Revoke All</Button>}
              title="Revoke all sessions?"
              description="You will be signed out of all devices including this one."
              onConfirm={() => revokeAll.mutate()}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card className="transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:-translate-y-px">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Active Sessions</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-blue-100">
                <Monitor className="h-4 w-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">{sessions?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:-translate-y-px">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Current Session</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-emerald-100">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">Active</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (!sessions || sessions.length === 0) ? (
            <EmptyState illustration={<SessionIllustration />} title="No active sessions" description="No active sessions found." />
          ) : (
            <Table className="table-striped">
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead className="hidden sm:table-cell">Device</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions?.map((s) => {
                  // Heuristic: the most recently used session is likely the current one
                  const isCurrent = sessions.length > 0 && s.id === sessions.reduce((a, b) =>
                    new Date(a.last_used_at) > new Date(b.last_used_at) ? a : b
                  ).id;
                  const parsed = parseUserAgent(s.user_agent);
                  return (
                  <TableRow key={s.id} className={isCurrent ? "bg-emerald-50 border-l-2 border-l-emerald-500" : ""}>
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center gap-2">
                        {s.ip_address ?? "—"}
                        {isCurrent && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] px-1">Current</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm hidden sm:table-cell">
                      <div className="flex items-center gap-2">
                        {getDeviceIcon(parsed.device)}
                        <span>{parsed.browser} · {parsed.os}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm hidden md:table-cell">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm">{new Date(s.expires_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {!isCurrent && <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>Revoke</Button>}
                      {isCurrent && <span className="text-xs text-muted-foreground">Active</span>}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
