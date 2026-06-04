"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, setAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Monitor, Smartphone, Tablet, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
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
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokeConfirmText, setRevokeConfirmText] = useState("");

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
        setAccessToken(null);
        localStorage.removeItem("refresh_token");
        window.location.href = "/login";
      }, 1000);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (isError) return <ErrorState message="Failed to load sessions" onRetry={() => refetch()} />;

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center" aria-hidden="true">
                <Monitor className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight">Active Sessions</h1>
                <p className="text-sm text-muted-foreground tabular-nums">
                  Manage your active sessions across devices.{" "}
                  {sessions !== undefined && <span>{sessions.length} session{sessions.length !== 1 ? "s" : ""} active.</span>}
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              aria-label="Revoke all sessions"
              onClick={() => { setRevokeConfirmText(""); setRevokeAllOpen(true); }}
            >
              Revoke All
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Typed-confirm dialog for Revoke All — signs user out everywhere */}
      <Dialog open={revokeAllOpen} onOpenChange={(v) => { setRevokeAllOpen(v); if (!v) setRevokeConfirmText(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Revoke all sessions?
            </DialogTitle>
            <DialogDescription>
              You will be immediately signed out of all devices, including this one. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              All active sessions will be terminated and you will be redirected to the login page.
            </div>
            <div className="space-y-2">
              <Label htmlFor="revoke-confirm">Type <span className="font-mono font-semibold">REVOKE</span> to confirm</Label>
              <Input
                id="revoke-confirm"
                value={revokeConfirmText}
                onChange={(e) => setRevokeConfirmText(e.target.value)}
                placeholder="REVOKE"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevokeAllOpen(false); setRevokeConfirmText(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={revokeConfirmText !== "REVOKE" || revokeAll.isPending}
              onClick={() => { revokeAll.mutate(); setRevokeAllOpen(false); }}
            >
              {revokeAll.isPending ? "Revoking…" : "Revoke All Sessions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader><CardTitle>Sessions</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (!sessions || sessions.length === 0) ? (
            <EmptyState title="No active sessions" description="You don't have any active sessions on other devices." />
          ) : (
            <Table className="table-striped">
              <TableHeader>
                <TableRow>
                  <TableHead>IP Address</TableHead>
                  <TableHead className="hidden sm:table-cell">Device</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
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
                  <TableRow key={s.id} className={isCurrent ? "bg-success/5" : ""}>
                    <TableCell className="font-mono text-sm">
                      <div className="flex items-center gap-2">
                        {s.ip_address ?? "—"}
                        {isCurrent && <Badge className="bg-success/10 text-success border-success/20 text-[10px] px-1">Current</Badge>}
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
