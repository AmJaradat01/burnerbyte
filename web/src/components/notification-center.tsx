"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { api, WS_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, Inbox, Mail, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  created_at: string;
  is_read: boolean;
}

const TYPE_CONFIG: Record<string, { icon: typeof Mail; color: string }> = {
  "email.received": { icon: Mail, color: "text-blue-500" },
  "inbox.created": { icon: Inbox, color: "text-emerald-500" },
  "inbox.expired": { icon: Inbox, color: "text-orange-500" },
};

function formatTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationCenter() {
  const user = useAuthStore((s) => s.user);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get<Notification[]>("/notifications"),
    enabled: !!user,
  });

  const unread = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (!user) return;
    let disposed = false;

    function doConnect() {
      if (disposed) return;
      const token = localStorage.getItem("access_token");
      if (!token) return;
      const ws = new WebSocket(`${WS_BASE}/notifications?token=${token}`);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const type = data.type || "info";
          let title = "Notification";
          let message = "";
          if (type === "email.received") {
            title = "📬 New email";
            const sender = data.data?.from_address || data.data?.to_address || "unknown";
            const subj = data.data?.subject || "(no subject)";
            message = `From: ${sender} — ${subj}`;
          } else if (type === "inbox.created") {
            title = "Inbox Created";
            message = data.data?.full_address || "A new inbox was created";
          } else if (type === "inbox.expired") {
            title = "Inbox Expired";
            message = data.data?.full_address || "An inbox has expired";
          } else {
            title = type.replace(/\./g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
            message = data.data?.message || JSON.stringify(data.data || {}).slice(0, 100);
          }
          toast(title, { description: message });
          // Refresh from server (includes the persisted notification)
          qc.invalidateQueries({ queryKey: ["notifications"] });
          if (type === "email.received") {
            qc.invalidateQueries({ queryKey: ["home-inboxes"] });
            qc.invalidateQueries({ queryKey: ["emails"] });
            qc.invalidateQueries({ queryKey: ["inbox"] });
          }
        } catch {}
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (disposed) return;
        reconnectRef.current = setTimeout(doConnect, 5000);
      };
      ws.onerror = () => ws.close();
    }

    doConnect();
    return () => {
      disposed = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user, qc]);

  const markAllRead = useCallback(() => {
    api.post("/notifications/mark-all-read").then(() => {
      qc.setQueryData<Notification[]>(["notifications"], (prev) =>
        prev?.map((n) => ({ ...n, is_read: true })) ?? []
      );
    });
  }, [qc]);

  const markRead = useCallback((id: string) => {
    api.patch(`/notifications/${id}/read`).then(() => {
      qc.setQueryData<Notification[]>(["notifications"], (prev) =>
        prev?.map((n) => (n.id === id ? { ...n, is_read: true } : n)) ?? []
      );
    });
  }, [qc]);

  const dismiss = useCallback((id: string) => {
    api.del(`/notifications/${id}`).then(() => {
      qc.setQueryData<Notification[]>(["notifications"], (prev) =>
        prev?.filter((n) => n.id !== id) ?? []
      );
    });
  }, [qc]);

  const clearAll = useCallback(() => {
    api.del("/notifications").then(() => {
      qc.setQueryData<Notification[]>(["notifications"], []);
    });
  }, [qc]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative h-9 w-9 p-0" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 min-w-5 p-0 text-[10px] flex items-center justify-center rounded-full">
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5">{unread} new</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={markAllRead}>
                <Check className="h-3 w-3" /> Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={clearAll}>
                <Trash2 className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Notification list */}
        <div className="max-h-80 overflow-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No notifications yet</p>
              <p className="text-xs mt-1">You&apos;ll see new emails and events here</p>
            </div>
          ) : (
            notifications.map((n) => {
              const cfg = TYPE_CONFIG[n.type] || { icon: Bell, color: "text-muted-foreground" };
              const Icon = cfg.icon;
              return (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/50 ${!n.is_read ? "bg-primary/5" : ""}`}
                  onClick={() => markRead(n.id)}
                >
                  <div className={`mt-0.5 shrink-0 ${cfg.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm truncate ${!n.is_read ? "font-semibold" : "font-medium"}`}>
                      {n.title === "email.received" ? "New email received" : n.title}
                    </p>
                      {!n.is_read && <div className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{formatTime(n.created_at)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t px-4 py-2 text-center">
            <p className="text-[10px] text-muted-foreground">{notifications.length} notification{notifications.length !== 1 ? "s" : ""}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
