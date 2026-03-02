"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { WS_BASE } from "@/lib/api";

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000];

export function useInboxSocket(inboxId: string | undefined, onEmail: (email: unknown) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const user = useAuthStore((s) => s.user);
  const stableOnEmail = useCallback((...args: Parameters<typeof onEmail>) => onEmail(...args), [onEmail]);

  useEffect(() => {
    if (!inboxId || !user) return;

    function connect() {
      const token = localStorage.getItem("access_token");
      const ws = new WebSocket(`${WS_BASE}/inboxes/${inboxId}?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => { retryRef.current = 0; };
      ws.onmessage = (e) => { try { stableOnEmail(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => {
        wsRef.current = null;
        const delay = RECONNECT_DELAYS[Math.min(retryRef.current, RECONNECT_DELAYS.length - 1)];
        retryRef.current++;
        timerRef.current = setTimeout(connect, delay);
      };
      ws.onerror = () => { ws.close(); };
    }

    connect();
    return () => {
      clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [inboxId, user, stableOnEmail]);
}
