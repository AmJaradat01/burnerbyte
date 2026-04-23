"use client";

import { useEffect, useState } from "react";

export function LastUpdated({ dataUpdatedAt }: { dataUpdatedAt?: number }) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (!dataUpdatedAt) return;
    const update = () => {
      const diff = Date.now() - dataUpdatedAt;
      if (diff < 60_000) setText("just now");
      else if (diff < 3_600_000) setText(`${Math.floor(diff / 60_000)}m ago`);
      else setText(`${Math.floor(diff / 3_600_000)}h ago`);
    };
    update();
    const iv = setInterval(update, 30_000);
    return () => clearInterval(iv);
  }, [dataUpdatedAt]);

  if (!dataUpdatedAt || !text) return null;

  return (
    <span className="text-xs text-muted-foreground">
      Updated {text}
    </span>
  );
}
