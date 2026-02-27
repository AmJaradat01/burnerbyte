"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "@/stores/auth-store";

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8080/api/v1/ws";

export function useInboxSocket(inboxId: string | undefined, onEmail: (email: unknown) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const user = useAuthStore((s) => s.user);
  const stableOnEmail = useCallback(onEmail, [onEmail]);

  useEffect(() => {
    if (!inboxId || !user) return;
    const token = localStorage.getItem("access_token");
    const ws = new WebSocket(`${WS_BASE}?inbox=${inboxId}&token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try { stableOnEmail(JSON.parse(e.data)); } catch {}
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [inboxId, user, stableOnEmail]);
}
