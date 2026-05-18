"use client";

import { useState } from "react";
import { api, ApiError, setAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Globe, Monitor, Smartphone, Tablet, Clock, Loader2 } from "lucide-react";
import { UAParser } from "ua-parser-js";
import type { User, TokenPair, Session } from "@/types";

interface SessionConflictResponse {
  pending_token: string;
  sessions: Session[];
  limit: number;
}

interface SessionConflictDialogProps {
  open: boolean;
  onClose: () => void;
  pendingToken: string;
  sessions: Session[];
  limit: number;
  onResolved: (user: User, tokens: TokenPair) => void;
}

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

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function SessionConflictDialog({
  open,
  onClose,
  pendingToken: initialPendingToken,
  sessions: initialSessions,
  limit,
  onResolved,
}: SessionConflictDialogProps) {
  const [pendingToken, setPendingToken] = useState(initialPendingToken);
  const [sessions, setSessions] = useState(initialSessions);
  const [resolving, setResolving] = useState<string | null>(null);

  // Keep local state in sync when props change (e.g., new conflict from store)
  if (initialPendingToken !== pendingToken && resolving === null) {
    setPendingToken(initialPendingToken);
  }
  if (initialSessions !== sessions && resolving === null) {
    setSessions(initialSessions);
  }

  const handleRevoke = async (sessionId: string) => {
    setResolving(sessionId);
    try {
      const res = await api.post<{ user: User; tokens: TokenPair }>("/auth/login/resolve", {
        pending_token: pendingToken,
        revoke_session_id: sessionId,
      });
      setAccessToken(res.tokens.access_token);
      localStorage.setItem("refresh_token", res.tokens.refresh_token);
      onResolved(res.user, res.tokens);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          const conflict = err.data as SessionConflictResponse;
          setPendingToken(conflict.pending_token);
          setSessions(conflict.sessions);
          toast.error("Session list changed. Please choose again.");
        } else if (err.status === 401) {
          toast.error("Your session has expired. Please log in again.");
          onClose();
        } else {
          toast.error("Failed to resolve session conflict. Please try logging in again.");
          onClose();
        }
      } else {
        toast.error("An unexpected error occurred. Please try again.");
        onClose();
      }
    } finally {
      setResolving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="sm:max-w-xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Session Limit Reached</DialogTitle>
          <DialogDescription>
            You have reached the maximum of {limit} active session{limit !== 1 ? "s" : ""}. Sign out of an existing session to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[400px] overflow-y-auto py-2">
          {sessions.map((session) => (
            <Card key={session.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      {getDeviceIcon(parseUserAgent(session.user_agent).device)}
                      <span className="text-sm font-medium truncate">
                        {parseUserAgent(session.user_agent).browser} · {parseUserAgent(session.user_agent).os}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {session.ip_address ?? "Unknown IP"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Active {formatRelativeTime(session.last_used_at)}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        Created {new Date(session.created_at).toLocaleDateString()}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRevoke(session.id)}
                    disabled={resolving !== null}
                    className="shrink-0"
                  >
                    {resolving === session.id ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        Signing out…
                      </>
                    ) : (
                      "Sign Out & Continue"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={resolving !== null}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
