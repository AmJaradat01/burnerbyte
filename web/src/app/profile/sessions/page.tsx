"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Monitor, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Session } from "@/types";

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Active Sessions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your active sessions across devices.</p>
        </div>
        <ConfirmDialog
          trigger={<Button variant="destructive" size="sm">Revoke All</Button>}
          title="Revoke all sessions?"
          description="You will be signed out of all devices including this one."
          onConfirm={() => revokeAll.mutate()}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Active Sessions</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-blue-100 dark:bg-blue-900/30">
                <Monitor className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">{sessions?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Current Session</span>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-100 dark:bg-emerald-900/30">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums">Active</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead>User Agent</TableHead>
                  <TableHead>Created</TableHead>
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
                  return (
                  <TableRow key={s.id} className={isCurrent ? "bg-emerald-50 dark:bg-emerald-900/10 border-l-2 border-l-emerald-500" : ""}>
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center gap-2">
                        {s.ip_address ?? "—"}
                        {isCurrent && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800 text-[10px] px-1">Current</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">{s.user_agent ?? "—"}</TableCell>
                    <TableCell className="text-sm">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm">{new Date(s.expires_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {!isCurrent && <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>Revoke</Button>}
                      {isCurrent && <span className="text-xs text-muted-foreground">Active</span>}
                    </TableCell>
                  </TableRow>
                  );
                })}
                {(!sessions || sessions.length === 0) && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No active sessions</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
