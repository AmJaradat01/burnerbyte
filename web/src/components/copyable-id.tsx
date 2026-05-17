"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyableIdProps {
  value: string;
}

export function CopyableId({ value }: CopyableIdProps) {
  const [copied, setCopied] = useState(false);
  const truncated = value.length > 8 ? `${value.slice(0, 8)}…` : value;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={value}
      className="inline-flex items-center gap-1 cursor-pointer font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {truncated}
      {copied ? (
        <Check className="h-3 w-3 text-success" />
      ) : (
        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}
