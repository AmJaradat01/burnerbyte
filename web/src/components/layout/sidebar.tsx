"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/logo";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Home,
  BookOpen,
  LayoutDashboard,
  Globe,
  Users,
  Webhook,
  KeyRound,
  ClipboardList,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

/* ── Nav Link ── */

function NavLink({ href, icon: Icon, label, active, collapsed, badge }: {
  href: string; icon: LucideIcon; label: string; active: boolean; collapsed: boolean; badge?: number;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
        collapsed && "justify-center px-2",
        active
          ? "bg-sidebar-primary/10 text-sidebar-primary"
          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
      )}
    >
      {/* Active indicator bar */}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-sidebar-primary transition-all" />
      )}
      <Icon className={cn("shrink-0 transition-colors", collapsed ? "h-5 w-5" : "h-4 w-4")} />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {badge !== undefined && badge > 0 && (
            <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-[10px] flex items-center justify-center rounded-full">
              {badge > 99 ? "99+" : badge}
            </Badge>
          )}
        </>
      )}
      {collapsed && badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
      )}
    </Link>
  );
}

/* ── Sidebar ── */

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { currentOrg } = useOrgStore();
  const t = useTranslations("nav");
  const tc = useTranslations("common");

  // Fetch version for sidebar footer
  const { data: versionData } = useQuery({
    queryKey: ["app-version"],
    queryFn: () => api.get<{ version: string }>("/admin/version"),
    staleTime: 300_000,
    enabled: !!user?.is_system_admin,
  });

  const navItems = [
    { href: "/", label: t("home"), icon: Home },
    { href: "/docs", label: t("docs"), icon: BookOpen },
  ];

  const manageItems = [
    { href: "/dashboard", label: t("dashboard"), icon: LayoutDashboard },
    { href: "/domains", label: t("domains"), icon: Globe },
    { href: "/teams", label: t("teams"), icon: Users },
    { href: "/webhooks", label: t("webhooks"), icon: Webhook },
    { href: "/api-keys", label: t("apiKeys"), icon: KeyRound },
    { href: "/audit", label: t("auditLog"), icon: ClipboardList },
    { href: "/analytics", label: t("analytics"), icon: BarChart3 },
    { href: "/settings", label: t("settings"), icon: Settings },
  ];

  const version = versionData?.version;
  // Strip leading 'v' if present to avoid double-v display
  const displayVersion = version?.replace(/^v/, "");
  const userInitial = user?.display_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || "?";

  return (
    <aside className={cn(
      "flex h-screen flex-col border-r bg-sidebar transition-all duration-200 select-none",
      collapsed ? "w-[60px]" : "w-60"
    )}>
      {/* ── Logo + collapse toggle ── */}
      <div className={cn(
        "flex items-center shrink-0 h-14 border-b border-border/50",
        collapsed ? "justify-center px-2" : "justify-between px-3"
      )}>
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Logo collapsed={collapsed} />
        </Link>
        {!collapsed && (
          <Button
            variant="ghost"
            size="sm"
            className="min-w-8 min-h-8 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={onToggle}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* ── Expand button when collapsed ── */}
      {collapsed && (
        <div className="px-2 py-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="min-w-8 min-h-8 h-7 w-full p-0 text-muted-foreground hover:text-foreground"
            onClick={onToggle}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Org card ── */}
      {currentOrg && !collapsed && (
        <div className="mx-3 mt-3 mb-1 shrink-0">
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5 transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-2.5">
              {currentOrg.logo_url ? (
                <Image src={currentOrg.logo_url} alt="" width={28} height={28} className="h-7 w-7 rounded-md object-cover" unoptimized />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
                  {currentOrg.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">{currentOrg.name}</p>
                <p className="truncate text-[11px] text-muted-foreground leading-tight">{currentOrg.slug}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      {currentOrg && collapsed && (
        <div className="flex justify-center my-2 shrink-0" title={currentOrg.name}>
          {currentOrg.logo_url ? (
            <Image src={currentOrg.logo_url} alt="" width={32} height={32} className="h-8 w-8 rounded-md object-cover" unoptimized />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
              {currentOrg.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      )}

      {/* ── Navigation ── */}
      <nav aria-label="Main navigation" className={cn("flex-1 overflow-y-auto py-2 space-y-0.5", collapsed ? "px-1.5" : "px-3")}>
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            {...item}
            collapsed={collapsed}
            active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)}
          />
        ))}

        {/* Manage section */}
        <div className="pt-3 mt-3 border-t border-border/50">
          {!collapsed && (
            <p className="px-3 pb-2 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
              {t("manage")}
            </p>
          )}
          {collapsed && <div className="h-2" />}
          {manageItems.map((item) => (
            <NavLink
              key={item.href}
              {...item}
              collapsed={collapsed}
              active={pathname.startsWith(item.href)}
            />
          ))}
        </div>
      </nav>

      {/* ── User section ── */}
      <div className={cn("border-t border-border/50 shrink-0", collapsed ? "px-1.5 py-2" : "px-3 py-3")}>
        {/* User profile link */}
        {collapsed ? (
          <Link href="/profile" title={user?.display_name || "Profile"} className="flex justify-center mb-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground ring-2 ring-background transition-transform hover:scale-105">
              {userInitial}
            </div>
          </Link>
        ) : (
          <Link
            href="/profile"
            className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/80 transition-colors group"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground ring-2 ring-background">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight group-hover:text-foreground transition-colors">
                {user?.display_name || "User"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground leading-tight">{user?.email}</p>
            </div>
          </Link>
        )}

        {/* Actions row */}
        <div className={cn(
          "flex items-center mt-1",
          collapsed ? "flex-col gap-1" : "justify-between px-1"
        )}>
          {/* Version badge (expanded only) */}
          {!collapsed && displayVersion && (
            <span className="text-[10px] text-muted-foreground/50 font-mono">v{displayVersion}</span>
          )}
          {!collapsed && !displayVersion && <span />}

          {/* Logout button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive transition-colors"
            onClick={logout}
            title={tc("signOut")}
            aria-label={tc("signOut")}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
