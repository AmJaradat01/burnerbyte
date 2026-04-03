"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/auth-store";

const routes = [
  { label: "Dashboard", path: "/dashboard" },
  { label: "Inboxes", path: "/inboxes" },
  { label: "Domains", path: "/domains" },
  { label: "Teams", path: "/teams" },
  { label: "Webhooks", path: "/webhooks" },
  { label: "API Keys", path: "/api-keys" },
  { label: "Audit Log", path: "/audit" },
  { label: "Analytics", path: "/analytics" },
  { label: "Settings", path: "/settings" },
  { label: "Profile", path: "/profile" },
  { label: "Profile Sessions", path: "/profile/sessions" },
  { label: "Documentation", path: "/docs" },
];

const adminRoutes = [{ label: "Admin", path: "/admin" }];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const allRoutes = user?.is_system_admin ? [...routes, ...adminRoutes] : routes;
  const filtered = allRoutes.filter((r) =>
    r.label.toLowerCase().includes(query.toLowerCase())
  );

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(0); }, [query]);

  const navigate = useCallback(
    (path: string) => {
      router.push(path);
      setOpen(false);
      setQuery("");
      setSelectedIndex(0);
    },
    [router]
  );

  // Clear query when dialog closes
  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v);
    if (!v) { setQuery(""); setSelectedIndex(0); }
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered.length > 0) {
      navigate(filtered[selectedIndex].path);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Input
          placeholder="Search pages… (⌘K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border-0 border-b rounded-none focus-visible:ring-0"
          autoFocus
          onKeyDown={handleKeyDown}
        />
        <div className="max-h-64 overflow-auto" ref={listRef}>
          {filtered.map((r, i) => (
            <button
              key={r.path}
              onClick={() => navigate(r.path)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                i === selectedIndex ? "bg-primary/10 text-primary" : "hover:bg-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No results</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
