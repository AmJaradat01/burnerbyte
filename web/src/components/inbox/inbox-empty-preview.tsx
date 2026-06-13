"use client";

interface InboxEmptyPreviewProps {
  totalEmails: number;
}

export function InboxEmptyPreview({ totalEmails }: InboxEmptyPreviewProps) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <p className="font-medium">Select an email to read</p>
        <p className="text-sm text-muted-foreground mt-1">
          {totalEmails > 0 ? `${totalEmails} email${totalEmails !== 1 ? "s" : ""} in this inbox` : "Waiting for incoming emails"}
        </p>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">↑</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">esc</kbd>
            deselect
          </span>
        </div>
      </div>
    </div>
  );
}
