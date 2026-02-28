"use client";

import { useEffect, useState, useCallback } from "react";
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
];

const adminRoutes = [{ label: "Admin", path: "/admin" }];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

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

  const navigate = useCallback(
    (path: string) => {
      router.push(path);
      setOpen(false);
      setQuery("");
    },
    [router]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Input
          placeholder="Search pages… (⌘K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border-0 border-b rounded-none focus-visible:ring-0"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered.length > 0) {
              navigate(filtered[0].path);
            }
          }}
        />
        <div className="max-h-64 overflow-auto">
          {filtered.map((r) => (
            <button
              key={r.path}
              onClick={() => navigate(r.path)}
              className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
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
