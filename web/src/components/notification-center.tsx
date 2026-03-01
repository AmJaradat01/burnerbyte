"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/api/v1/ws";

interface Notification {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export function NotificationCenter() {
  const user = useAuthStore((s) => s.user);
  const wsRef = useRef<WebSocket | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem("access_token");
    const ws = new WebSocket(`${WS_BASE}/notifications?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const message = data.data?.subject
          ? `New email from ${data.data.from}: ${data.data.subject}`
          : data.type || "New notification";
        const notif: Notification = {
          id: crypto.randomUUID(),
          type: data.type || "info",
          message,
          timestamp: new Date().toISOString(),
          read: false,
        };
        setNotifications((prev) => [notif, ...prev].slice(0, 50));
      } catch {}
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [user]);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative" aria-label="Notifications">
          🔔
          {unread > 0 && (
            <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 w-4 p-0 text-[10px] flex items-center justify-center">
              {unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="text-xs" onClick={markAllRead}>Mark all read</Button>
          )}
        </div>
        <div className="max-h-64 overflow-auto">
          {notifications.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No notifications</p>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className={`flex items-start gap-2 border-b px-4 py-2 text-sm ${!n.read ? "bg-muted/50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <p className="truncate">{n.message}</p>
                  <p className="text-xs text-muted-foreground">{new Date(n.timestamp).toLocaleTimeString()}</p>
                </div>
                <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => dismiss(n.id)}>✕</Button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
