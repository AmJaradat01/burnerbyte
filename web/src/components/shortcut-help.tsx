"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const shortcuts = [
  { key: "n", description: "Create new inbox" },
  { key: "j", description: "Next email in list" },
  { key: "k", description: "Previous email in list" },
  { key: "d", description: "Delete selected email" },
  { key: "Esc", description: "Close modal / deselect" },
  { key: "?", description: "Show this help" },
  { key: "⌘K", description: "Open command palette" },
];

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Keyboard Shortcuts</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {shortcuts.map((s) => (
            <div key={s.key} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.description}</span>
              <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">{s.key}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
