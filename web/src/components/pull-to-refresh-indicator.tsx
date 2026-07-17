"use client";

import { Loader2 } from "lucide-react";

interface PullToRefreshIndicatorProps {
  pulling: boolean;
  refreshing: boolean;
  pullDistance: number;
  threshold?: number;
}

export function PullToRefreshIndicator({ pulling, refreshing, pullDistance, threshold = 80 }: PullToRefreshIndicatorProps) {
  if (!pulling && !refreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);
  const ready = progress >= 1;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center transition-all duration-200"
      style={{ height: pulling ? `${pullDistance}px` : refreshing ? "48px" : "0px" }}
    >
      {refreshing ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      ) : (
        <div
          className={`h-5 w-5 rounded-full border-2 transition-colors duration-150 ${ready ? "border-primary bg-primary/10" : "border-muted-foreground/30"}`}
          style={{ transform: `rotate(${progress * 360}deg)` }}
        />
      )}
    </div>
  );
}
