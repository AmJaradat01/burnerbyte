"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number; // pixels to pull before triggering (default: 80)
  enabled?: boolean;
}

export function usePullToRefresh({ onRefresh, threshold = 80, enabled = true }: UsePullToRefreshOptions) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startYRef = useRef(0);
  const pullingRef = useRef(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || refreshing) return;
    // Only activate when scrolled to top
    if (window.scrollY > 0) return;
    startYRef.current = e.touches[0].clientY;
    pullingRef.current = false;
  }, [enabled, refreshing]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!enabled || refreshing) return;
    if (window.scrollY > 0) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;
    if (diff > 10) {
      pullingRef.current = true;
      setPulling(true);
      // Apply resistance — pull distance is sqrt of actual distance
      setPullDistance(Math.min(Math.sqrt(diff) * 4, threshold * 1.5));
    }
  }, [enabled, refreshing, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (!pullingRef.current) return;
    if (pullDistance >= threshold && !refreshing) {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    }
    setPulling(false);
    setPullDistance(0);
    pullingRef.current = false;
  }, [pullDistance, threshold, refreshing, onRefresh]);

  useEffect(() => {
    if (!enabled) return;
    // Check if touch device
    if (!("ontouchstart" in window)) return;

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd);

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { pulling, refreshing, pullDistance };
}
