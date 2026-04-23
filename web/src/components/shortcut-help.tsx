"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const shortcutGroups: Record<string, { key: string; description: string }[]> = {
  Navigation: [
    { key: "j", description: "Next email in list" },
    { key: "k", description: "Previous email in list" },
  ],
  Actions: [
    { key: "n", description: "Create new inbox" },
    { key: "d", description: "Delete selected email" },
  ],
  General: [
    { key: "⌘K", description: "Open command palette" },
    { key: "?", description: "Show this help" },
    { key: "Esc", description: "Close modal / deselect" },
  ],
};

export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Keyboard Shortcuts</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {Object.entries(shortcutGroups).map(([category, shortcuts]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {category}
              </h3>
              <div className="space-y-2">
                {shortcuts.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">{s.description}</span>
                    <kbd className="rounded border bg-muted px-2 py-0.5 text-xs font-mono">{s.key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
