"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { api, WS_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, ChevronDown, ChevronRight, Inbox, Mail, Trash2, X } from "lucide-react";
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

interface GroupedNotification {
  key: string;
  type: string;
  notifications: Notification[];
  latestTitle: string;
  latestMessage: string;
  latestCreatedAt: string;
  isRead: boolean;
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

function groupNotifications(notifications: Notification[]): (Notification | GroupedNotification)[] {
  const groups: GroupedNotification[] = [];
  const ungrouped: Notification[] = [];

  // Sort by created_at desc
  const sorted = [...notifications].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const used = new Set<string>();

  for (const n of sorted) {
    if (used.has(n.id)) continue;

    // Find other notifications of same type within 5 minutes
    const windowMs = 5 * 60 * 1000;
    const nTime = new Date(n.created_at).getTime();
    const siblings = sorted.filter(
      (s) =>
        !used.has(s.id) &&
        s.type === n.type &&
        Math.abs(new Date(s.created_at).getTime() - nTime) < windowMs
    );

    if (siblings.length >= 2) {
      siblings.forEach((s) => used.add(s.id));
      groups.push({
        key: `group-${n.type}-${n.id}`,
        type: n.type,
        notifications: siblings,
        latestTitle: n.title,
        latestMessage: `${siblings.length} ${n.type.replace(".", " ")} events`,
        latestCreatedAt: n.created_at,
        isRead: siblings.every((s) => s.is_read),
      });
    } else {
      used.add(n.id);
      ungrouped.push(n);
    }
  }

  // Merge and sort by latest timestamp
  const result: (Notification | GroupedNotification)[] = [...groups, ...ungrouped];
  result.sort((a, b) => {
    const aTime = "latestCreatedAt" in a ? a.latestCreatedAt : a.created_at;
    const bTime = "latestCreatedAt" in b ? b.latestCreatedAt : b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return result;
}

function isGroup(item: Notification | GroupedNotification): item is GroupedNotification {
  return "latestCreatedAt" in item;
}

export function NotificationCenter() {
  const user = useAuthStore((s) => s.user);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get<Notification[]>("/notifications"),
    enabled: !!user,
  });

  const unread = notifications.filter((n) => !n.is_read).length;

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

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

          // Send browser notification when tab is not focused
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted" &&
            document.hidden
          ) {
            new Notification(title, {
              body: message,
              icon: "/favicon.svg",
              tag: data.type,
            });
          }

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
    api
      .post("/notifications/mark-all-read")
      .then(() => {
        qc.setQueryData<Notification[]>(["notifications"], (prev) =>
          prev?.map((n) => ({ ...n, is_read: true })) ?? []
        );
      })
      .catch(() => toast.error("Failed"));
  }, [qc]);

  const markRead = useCallback(
    (id: string) => {
      api
        .patch(`/notifications/${id}/read`)
        .then(() => {
          qc.setQueryData<Notification[]>(["notifications"], (prev) =>
            prev?.map((n) => (n.id === id ? { ...n, is_read: true } : n)) ?? []
          );
        })
        .catch(() => toast.error("Failed"));
    },
    [qc]
  );

  const dismiss = useCallback(
    (id: string) => {
      api
        .del(`/notifications/${id}`)
        .then(() => {
          qc.setQueryData<Notification[]>(["notifications"], (prev) =>
            prev?.filter((n) => n.id !== id) ?? []
          );
        })
        .catch(() => toast.error("Failed"));
    },
    [qc]
  );

  const clearAll = useCallback(() => {
    api
      .del("/notifications")
      .then(() => {
        qc.setQueryData<Notification[]>(["notifications"], []);
      })
      .catch(() => toast.error("Failed"));
  }, [qc]);

  const grouped = groupNotifications(notifications);

  const requestNotifPermission = useCallback(() => {
    if (typeof Notification !== "undefined") {
      Notification.requestPermission().then(setNotifPermission);
    }
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 w-9 p-0"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 p-0 text-[10px] flex items-center justify-center rounded-full"
            >
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] sm:w-96 p-0"
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {unread} new
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={markAllRead}
              >
                <Check className="h-3 w-3" /> Mark all read
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={clearAll}
              >
                <Trash2 className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Browser notification permission banner */}
        {notifPermission === "default" && (
          <button
            onClick={requestNotifPermission}
            className="w-full text-center text-xs text-primary hover:underline py-2 border-b"
          >
            Enable browser notifications for real-time alerts
          </button>
        )}

        {/* Notification list */}
        <div className="max-h-80 overflow-auto">
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No notifications yet</p>
              <p className="text-xs mt-1">You&apos;ll see new emails and events here</p>
            </div>
          ) : (
            grouped.map((item) => {
              if (isGroup(item)) {
                const expanded = expandedGroups.has(item.key);
                const cfg = TYPE_CONFIG[item.type] || {
                  icon: Bell,
                  color: "text-muted-foreground",
                };
                const Icon = cfg.icon;
                return (
                  <div key={item.key}>
                    {/* Group header */}
                    <div
                      className={`flex items-center gap-3 px-4 py-3 border-b cursor-pointer transition-colors hover:bg-muted/50 ${!item.isRead ? "bg-primary/5" : ""}`}
                      onClick={() => toggleGroup(item.key)}
                    >
                      <div className={`mt-0.5 shrink-0 ${cfg.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-sm truncate ${!item.isRead ? "font-semibold" : "font-medium"}`}
                          >
                            {item.latestMessage}
                          </p>
                          {!item.isRead && (
                            <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {formatTime(item.latestCreatedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="secondary" className="text-[10px] px-1.5">
                          {item.notifications.length}
                        </Badge>
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </div>
                    {/* Expanded group items */}
                    {expanded &&
                      item.notifications.map((n) => {
                        const nCfg = TYPE_CONFIG[n.type] || {
                          icon: Bell,
                          color: "text-muted-foreground",
                        };
                        const NIcon = nCfg.icon;
                        return (
                          <div
                            key={n.id}
                            className={`group flex items-start gap-3 pl-8 pr-4 py-2.5 border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/50 ${!n.is_read ? "bg-primary/5" : "bg-muted/20"}`}
                            onClick={() => markRead(n.id)}
                          >
                            <div className={`mt-0.5 shrink-0 ${nCfg.color}`}>
                              <NIcon className="h-3.5 w-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-xs truncate ${!n.is_read ? "font-semibold" : "font-medium"}`}
                              >
                                {n.title === "email.received"
                                  ? "New email received"
                                  : n.title}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                {n.message}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {formatTime(n.created_at)}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
                              aria-label="Dismiss notification"
                              onClick={(e) => {
                                e.stopPropagation();
                                dismiss(n.id);
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                  </div>
                );
              }

              // Individual notification
              const cfg = TYPE_CONFIG[item.type] || {
                icon: Bell,
                color: "text-muted-foreground",
              };
              const Icon = cfg.icon;
              return (
                <div
                  key={item.id}
                  className={`group flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-colors cursor-pointer hover:bg-muted/50 ${!item.is_read ? "bg-primary/5" : ""}`}
                  onClick={() => markRead(item.id)}
                >
                  <div className={`mt-0.5 shrink-0 ${cfg.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={`text-sm truncate ${!item.is_read ? "font-semibold" : "font-medium"}`}
                      >
                        {item.title === "email.received"
                          ? "New email received"
                          : item.title}
                      </p>
                      {!item.is_read && (
                        <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {item.message}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatTime(item.created_at)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
                    aria-label="Dismiss notification"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismiss(item.id);
                    }}
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
            <p className="text-[10px] text-muted-foreground">
              {notifications.length} notification
              {notifications.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
