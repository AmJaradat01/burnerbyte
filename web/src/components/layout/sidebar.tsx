"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";

function NavLink({ href, icon, label, active, collapsed }: { href: string; icon: string; label: string; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary" />}
      <span className={cn("text-base", collapsed && "text-lg")}>{icon}</span>
      {!collapsed && label}
    </Link>
  );
}

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

  const navItems = [
    { href: "/", label: t("home"), icon: "🏠" },
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

  return (
    <aside className={cn(
      "flex h-screen flex-col border-r bg-background/95 backdrop-blur-xl transition-all duration-200",
      collapsed ? "w-[60px]" : "w-60"
    )}>
      {/* Logo + collapse toggle */}
      <div className={cn("flex items-center px-3 py-4", collapsed ? "justify-center" : "justify-between")}>
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="text-lg">🔥</span>
          {!collapsed && <span>BurnerByte</span>}
        </Link>
        {!collapsed && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" onClick={onToggle} title="Collapse sidebar">
            <ChevronsLeft className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {collapsed && (
        <div className="px-2 mb-2">
          <Button variant="ghost" size="sm" className="h-7 w-full p-0 text-muted-foreground" onClick={onToggle} title="Expand sidebar">
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Org card */}
      {currentOrg && !collapsed && (
        <div className="mx-3 mb-3 rounded-lg border bg-muted/30 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            {currentOrg.logo_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={currentOrg.logo_url} alt="" className="h-7 w-7 rounded-md object-cover" />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
                {currentOrg.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{currentOrg.name}</p>
              <p className="truncate text-[11px] text-muted-foreground leading-tight">{currentOrg.slug}</p>
            </div>
          </div>
        </div>
      )}
      {currentOrg && collapsed && (
        <div className="flex justify-center mb-3" title={currentOrg.name}>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
            {currentOrg.name.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className={cn("flex-1 overflow-y-auto space-y-0.5", collapsed ? "px-1.5" : "px-3")}>
        {navItems.map((item) => (
          <NavLink key={item.href} {...item} collapsed={collapsed} active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)} />
        ))}

        <div className="pt-4 mt-4 border-t">
          {!collapsed && (
            <p className="px-3 pb-2 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">{t("manage")}</p>
          )}
          {manageItems.map((item) => (
            <NavLink key={item.href} {...item} collapsed={collapsed} active={pathname.startsWith(item.href)} />
          ))}
        </div>
      </nav>

      {/* User section */}
      <div className={cn("border-t py-3 space-y-2", collapsed ? "px-1.5" : "px-3")}>
        {collapsed ? (
          <Link href="/profile" title={user?.display_name || ""} className="flex justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {user?.display_name?.charAt(0).toUpperCase() || "?"}
            </div>
          </Link>
        ) : (
          <Link href="/profile" className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted transition-colors">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {user?.display_name?.charAt(0).toUpperCase() || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{user?.display_name}</p>
              <p className="truncate text-[11px] text-muted-foreground leading-tight">{user?.email}</p>
            </div>
          </Link>
        )}
        <div className={cn("flex items-center gap-1", collapsed ? "flex-col" : "px-1 justify-end")}>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={logout} title={tc("signOut")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
