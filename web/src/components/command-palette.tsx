"use client";

import { useEffect, useState, useCallback, useRef, type ElementType } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/stores/auth-store";
import {
  Home,
  BookOpen,
  LayoutDashboard,
  Inbox,
  Globe,
  Users,
  Webhook,
  KeyRound,
  ClipboardList,
  BarChart3,
  Settings,
  User,
  Monitor,
  ShieldCheck,
  Plus,
  LogOut,
} from "lucide-react";

interface CommandItem {
  label: string;
  icon: ElementType;
  group: "Navigation" | "Actions";
  path?: string;
  action?: string;
}

const navigationItems: CommandItem[] = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, group: "Navigation" },
  { label: "Inboxes", path: "/inboxes", icon: Inbox, group: "Navigation" },
  { label: "Domains", path: "/domains", icon: Globe, group: "Navigation" },
  { label: "Teams", path: "/teams", icon: Users, group: "Navigation" },
  { label: "Webhooks", path: "/webhooks", icon: Webhook, group: "Navigation" },
  { label: "API Keys", path: "/api-keys", icon: KeyRound, group: "Navigation" },
  { label: "Audit Log", path: "/audit", icon: ClipboardList, group: "Navigation" },
  { label: "Analytics", path: "/analytics", icon: BarChart3, group: "Navigation" },
  { label: "Settings", path: "/settings", icon: Settings, group: "Navigation" },
  { label: "Profile", path: "/profile", icon: User, group: "Navigation" },
  { label: "Profile Sessions", path: "/profile/sessions", icon: Monitor, group: "Navigation" },
  { label: "Documentation", path: "/docs", icon: BookOpen, group: "Navigation" },
  { label: "Home", path: "/", icon: Home, group: "Navigation" },
];

const adminNavigationItems: CommandItem[] = [
  { label: "Admin", path: "/admin", icon: ShieldCheck, group: "Navigation" },
];

const actionItems: CommandItem[] = [
  { label: "Create Inbox", path: "/inboxes", icon: Plus, group: "Actions", action: "create-inbox" },
  { label: "Sign Out", icon: LogOut, group: "Actions", action: "logout" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const listRef = useRef<HTMLDivElement>(null);

  // Load recents from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("cmd-recents");
      if (stored) setRecents(JSON.parse(stored));
    } catch {}
  }, []);

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

  const allNavItems = user?.is_system_admin
    ? [...navigationItems, ...adminNavigationItems]
    : navigationItems;

  const allItems = [...allNavItems, ...actionItems];

  const filtered = allItems.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  );

  // Group filtered items by category
  const navFiltered = filtered.filter((item) => item.group === "Navigation");
  const actionFiltered = filtered.filter((item) => item.group === "Actions");
  const groupedFiltered = [...navFiltered, ...actionFiltered];

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(0); }, [query]);

  const executeItem = useCallback(
    (item: CommandItem) => {
      // Track recent
      const updated = [item.label, ...recents.filter((r) => r !== item.label)].slice(0, 5);
      setRecents(updated);
      try { localStorage.setItem("cmd-recents", JSON.stringify(updated)); } catch {}

      if (item.action === "logout") {
        logout();
      } else if (item.path) {
        router.push(item.path);
      }
      setOpen(false);
      setQuery("");
      setSelectedIndex(0);
    },
    [router, logout, recents]
  );

  // Clear query when dialog closes
  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v);
    if (!v) { setQuery(""); setSelectedIndex(0); }
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector("[data-selected='true']") as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, groupedFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && groupedFiltered.length > 0) {
      executeItem(groupedFiltered[selectedIndex]);
    }
  };

  let itemIndex = 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Input
          placeholder="Search pages… (⌘K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border-0 border-b rounded-none focus-visible:ring-2 focus-visible:ring-ring/40"
          autoFocus
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={groupedFiltered.length > 0}
          aria-controls="cmd-listbox"
          aria-activedescendant={groupedFiltered.length > 0 ? `cmd-option-${selectedIndex}` : undefined}
          aria-autocomplete="list"
        />
        <div id="cmd-listbox" role="listbox" aria-label="Commands" className="max-h-64 overflow-auto" ref={listRef}>
          {/* Recent actions when no query */}
          {!query && recents.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                Recent
              </div>
              {recents.map((label) => {
                const item = allItems.find((i) => i.label === label);
                if (!item) return null;
                const idx = itemIndex++;
                const Icon = item.icon;
                return (
                  <button
                    key={`recent-${item.label}`}
                    id={`cmd-option-${idx}`}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    data-selected={idx === selectedIndex}
                    onClick={() => executeItem(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2.5 ${
                      idx === selectedIndex ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </>
          )}
          {navFiltered.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                Navigation
              </div>
              {navFiltered.map((item) => {
                const idx = itemIndex++;
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    id={`cmd-option-${idx}`}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    data-selected={idx === selectedIndex}
                    onClick={() => executeItem(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2.5 ${
                      idx === selectedIndex ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </>
          )}
          {actionFiltered.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
                Actions
              </div>
              {actionFiltered.map((item) => {
                const idx = itemIndex++;
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    id={`cmd-option-${idx}`}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    data-selected={idx === selectedIndex}
                    onClick={() => executeItem(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2.5 ${
                      idx === selectedIndex ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </>
          )}
          {groupedFiltered.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No results</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
