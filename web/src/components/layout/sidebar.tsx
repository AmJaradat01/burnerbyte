"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useRef } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/inboxes", label: "Inboxes", icon: "📬" },
  { href: "/domains", label: "Domains", icon: "🌐" },
  { href: "/teams", label: "Teams", icon: "👥" },
  { href: "/webhooks", label: "Webhooks", icon: "🔗" },
  { href: "/api-keys", label: "API Keys", icon: "🔑" },
  { href: "/audit", label: "Audit Log", icon: "📋" },
  { href: "/analytics", label: "Analytics", icon: "📈" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { orgs, currentOrg, fetchOrgs, setCurrentOrg, teams, currentTeam, fetchTeams, setCurrentTeam } = useOrgStore();
  const orgsFetched = useRef(false);

  useEffect(() => {
    if (user) fetchOrgs().then(() => { orgsFetched.current = true; });
  }, [user, fetchOrgs]);

  // Redirect to onboarding if user has no orgs
  useEffect(() => {
    if (!orgsFetched.current || !user) return;
    if (orgs.length === 0 && pathname !== "/onboarding" && localStorage.getItem("bb_onboarding_done") !== "true") {
      router.replace("/onboarding");
    }
  }, [orgs, user, pathname, router]);

  useEffect(() => {
    if (currentOrg) fetchTeams(currentOrg.id);
  }, [currentOrg, fetchTeams]);

  useEffect(() => {
    if (orgs.length > 0 && !currentOrg) setCurrentOrg(orgs[0]);
  }, [orgs, currentOrg, setCurrentOrg]);

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-background p-4">
      <Link href="/dashboard" className="mb-6 text-xl font-bold tracking-tight">
        🔥 BurnerByte
      </Link>

      <div className="space-y-2 mb-4">
        {orgs.length > 0 && (
          <Select
            value={currentOrg?.id}
            onValueChange={(id) => {
              const org = orgs.find((o) => o.id === id);
              if (org) setCurrentOrg(org);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Select organization">
              <SelectValue placeholder="Select org" />
            </SelectTrigger>
            <SelectContent>
              {orgs.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {teams.length > 0 && (
          <Select
            value={currentTeam?.id ?? ""}
            onValueChange={(id) => {
              const team = teams.find((t) => t.id === id);
              if (team) setCurrentTeam(team);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Select team">
              <SelectValue placeholder="Select team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith(item.href)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
        {user?.is_system_admin && (
          <Link
            href="/admin"
            className={cn(
              "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/admin")
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            Admin
          </Link>
        )}
      </nav>

      <div className="border-t pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <Link href="/profile" className="truncate hover:underline">
            <p className="truncate text-sm font-medium">{user?.display_name}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </Link>
          <ThemeToggle />
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={logout}>
          Sign out
        </Button>
      </div>
    </aside>
  );
}
