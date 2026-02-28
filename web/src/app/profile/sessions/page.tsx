"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sessions"] }); toast.success("All sessions revoked"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (isError) return <ErrorState message="Failed to load sessions" onRetry={() => refetch()} />;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Active Sessions</h1>
        <ConfirmDialog
          trigger={<Button variant="destructive" size="sm">Revoke All</Button>}
          title="Revoke all sessions?"
          description="You will be signed out of all devices including this one."
          onConfirm={() => revokeAll.mutate()}
        />
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
                {sessions?.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-sm">{s.ip_address ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm">{s.user_agent ?? "—"}</TableCell>
                    <TableCell className="text-sm">{new Date(s.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-sm">{new Date(s.expires_at).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>Revoke</Button>
                    </TableCell>
                  </TableRow>
                ))}
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
