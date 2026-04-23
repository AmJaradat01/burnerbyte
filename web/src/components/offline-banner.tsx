"use client";

import { useOnline } from "@/hooks/use-online";

export function OfflineBanner() {
  const online = useOnline();

  if (online) return null;

  return (
    <div
      className="fixed top-0 inset-x-0 z-[100] bg-destructive text-white text-center text-sm py-2"
      role="alert"
    >
      You are offline. Some features may be unavailable.
    </div>
  );
}
