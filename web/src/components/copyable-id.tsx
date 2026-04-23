"use client";

import { useCallback } from "react";
import { toast } from "sonner";

interface CopyableIdProps {
  value: string;
}

export function CopyableId({ value }: CopyableIdProps) {
  const truncated = value.length > 8 ? `${value.slice(0, 8)}…` : value;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      toast.success("Copied");
    });
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={value}
      className="cursor-pointer font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {truncated}
    </button>
  );
}
