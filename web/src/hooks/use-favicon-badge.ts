"use client";

import { useEffect, useRef } from "react";

/**
 * Draws an unread count badge on the favicon dynamically using canvas.
 * Restores the original favicon when count is 0.
 */
export function useFaviconBadge(count: number) {
  const originalHref = useRef<string | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;

    // Store original on first run
    if (originalHref.current === null) {
      originalHref.current = link.href;
    }

    if (count <= 0) {
      // Restore original favicon
      link.href = originalHref.current;
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = originalHref.current;

    img.onload = () => {
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw original favicon
      ctx.drawImage(img, 0, 0, size, size);

      // Draw badge circle
      const badgeSize = count > 9 ? 14 : 12;
      const x = size - badgeSize / 2 - 1;
      const y = badgeSize / 2 + 1;

      ctx.beginPath();
      ctx.arc(x, y, badgeSize / 2 + 1, 0, 2 * Math.PI);
      ctx.fillStyle = "#e53e3e"; // destructive red
      ctx.fill();

      // Draw count text
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${count > 9 ? 8 : 9}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(count > 99 ? "99" : String(count), x, y);

      // Apply to link element
      link.href = canvas.toDataURL("image/png");
    };

    img.onerror = () => {
      // If SVG favicon can't be loaded as image, skip badge
    };
  }, [count]);
}
