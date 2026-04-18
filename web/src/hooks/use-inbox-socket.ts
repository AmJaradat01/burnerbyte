"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { WS_BASE } from "@/lib/api";

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000];

export type SocketStatus = "connecting" | "connected" | "disconnected";

export function useInboxSocket(inboxId: string | undefined, onEmail: (email: unknown) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEmailRef = useRef(onEmail);
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<SocketStatus>("disconnected");

  // Always keep the latest callback without causing reconnects
  onEmailRef.current = onEmail;

  useEffect(() => {
    if (!inboxId || !user) return;

    let disposed = false;

    function connect() {
      if (disposed) return;
      setStatus("connecting");
      const token = localStorage.getItem("access_token");
      const ws = new WebSocket(`${WS_BASE}/inboxes/${inboxId}?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        if (!disposed) setStatus("connected");
      };
      ws.onmessage = (e) => { try { onEmailRef.current(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => {
        wsRef.current = null;
        if (disposed) return;
        setStatus("disconnected");
        const delay = RECONNECT_DELAYS[Math.min(retryRef.current, RECONNECT_DELAYS.length - 1)];
        retryRef.current++;
        timerRef.current = setTimeout(connect, delay);
      };
      ws.onerror = () => { ws.close(); };
    }

    connect();
    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setStatus("disconnected");
    };
  }, [inboxId, user]);

  return status;
}
