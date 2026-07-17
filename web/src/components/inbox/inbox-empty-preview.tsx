"use client";

import { Mail } from "lucide-react";

interface InboxEmptyPreviewProps {
  totalEmails: number;
}

export function InboxEmptyPreview({ totalEmails }: InboxEmptyPreviewProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
          <Mail className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="font-medium">Select an email to read</p>
        <p className="text-sm text-muted-foreground mt-1">
          {totalEmails > 0 ? `${totalEmails} email${totalEmails !== 1 ? "s" : ""} in this inbox` : "Waiting for incoming emails"}
        </p>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">&#8593;</kbd>
            <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">&#8595;</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">esc</kbd>
            deselect
          </span>
        </div>
      </div>
    </div>
  );
}
