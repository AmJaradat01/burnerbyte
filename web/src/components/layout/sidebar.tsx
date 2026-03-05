"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

function NavLink({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary" />}
      <span className="text-base">{icon}</span>
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { orgs, currentOrg, fetchOrgs, setCurrentOrg, fetchTeams } = useOrgStore();
  const orgsFetched = useRef(false);
  const t = useTranslations("nav");

  const navItems = [
    { href: "/", label: t("home"), icon: "🏠" },
    { href: "/inboxes", label: t("inboxes"), icon: "📬" },
    { href: "/docs", label: t("docs"), icon: "📖" },
  ];

  const manageItems = [
    { href: "/dashboard", label: t("dashboard"), icon: "📊" },
    { href: "/domains", label: t("domains"), icon: "🌐" },
    { href: "/teams", label: t("teams"), icon: "👥" },
    { href: "/webhooks", label: t("webhooks"), icon: "🔗" },
    { href: "/api-keys", label: t("apiKeys"), icon: "🔑" },
    { href: "/audit", label: t("auditLog"), icon: "📋" },
    { href: "/analytics", label: t("analytics"), icon: "📈" },
    { href: "/settings", label: t("settings"), icon: "⚙️" },
  ];

  // Auto-fetch and auto-select the single org
  useEffect(() => {
    if (user) fetchOrgs().then(() => { orgsFetched.current = true; });
  }, [user, fetchOrgs]);

  useEffect(() => {
    if (!orgsFetched.current || !user) return;
    if (orgs.length === 0 && pathname !== "/onboarding" && localStorage.getItem("bb_onboarding_done") !== "true") {
      router.replace("/onboarding");
    }
  }, [orgs, user, pathname, router]);

  useEffect(() => {
    if (orgs.length > 0 && !currentOrg) setCurrentOrg(orgs[0]);
  }, [orgs, currentOrg, setCurrentOrg]);

  useEffect(() => {
    if (currentOrg) fetchTeams(currentOrg.id);
  }, [currentOrg, fetchTeams]);

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-background p-4">
      <Link href="/" className="mb-6 text-xl font-bold tracking-tight">
        🔥 BurnerByte
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink key={item.href} {...item} active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)} />
        ))}

        <div className="pt-3 mt-3 border-t">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">{t("manage")}</p>
          {manageItems.map((item) => (
            <NavLink key={item.href} {...item} active={pathname.startsWith(item.href)} />
          ))}
        </div>

        {user?.is_system_admin && (
          <div className="pt-3 mt-3 border-t">
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">{t("system")}</p>
            <NavLink href="/admin" icon="🛡️" label={t("admin")} active={pathname.startsWith("/admin")} />
          </div>
        )}
      </nav>

      <div className="border-t pt-4 space-y-2">
        <div className="flex items-center gap-3">
          <Link href="/profile" className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {user?.display_name?.charAt(0).toUpperCase() || "?"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.display_name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </Link>
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={logout}>
          {useTranslations("common")("signOut")}
        </Button>
      </div>
    </aside>
  );
}
