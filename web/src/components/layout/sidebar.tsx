"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect } from "react";

const navItems = [
  { href: "/inboxes", label: "Inboxes" },
  { href: "/domains", label: "Domains" },
  { href: "/teams", label: "Teams" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/api-keys", label: "API Keys" },
  { href: "/audit", label: "Audit Log" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { orgs, currentOrg, fetchOrgs, setCurrentOrg, teams, currentTeam, fetchTeams, setCurrentTeam } = useOrgStore();

  useEffect(() => {
    if (user) fetchOrgs();
  }, [user, fetchOrgs]);

  useEffect(() => {
    if (currentOrg) fetchTeams(currentOrg.id);
  }, [currentOrg, fetchTeams]);

  useEffect(() => {
    if (orgs.length > 0 && !currentOrg) setCurrentOrg(orgs[0]);
  }, [orgs, currentOrg, setCurrentOrg]);

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-background p-4">
      <Link href="/" className="mb-6 text-xl font-bold tracking-tight">
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
              "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith(item.href)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
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

      <div className="border-t pt-4">
        <p className="truncate text-sm font-medium">{user?.display_name}</p>
        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={logout}>
          Sign out
        </Button>
      </div>
    </aside>
  );
}
