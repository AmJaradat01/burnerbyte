"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";

function NavLink({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
    <aside className="flex h-screen w-60 flex-col border-r bg-background/95">
      {/* Logo */}
      <div className="px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="text-lg">🔥</span>
          <span>BurnerByte</span>
        </Link>
      </div>

      {/* Org card */}
      {currentOrg && (
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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-0.5">
        {navItems.map((item) => (
          <NavLink key={item.href} {...item} active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)} />
        ))}

        <div className="pt-4 mt-4 border-t">
          <p className="px-3 pb-2 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">{t("manage")}</p>
          {manageItems.map((item) => (
            <NavLink key={item.href} {...item} active={pathname.startsWith(item.href)} />
          ))}
        </div>
      </nav>

      {/* User section */}
      <div className="border-t px-3 py-3 space-y-2">
        <Link href="/profile" className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted transition-colors">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {user?.display_name?.charAt(0).toUpperCase() || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{user?.display_name}</p>
            <p className="truncate text-[11px] text-muted-foreground leading-tight">{user?.email}</p>
          </div>
        </Link>
        <div className="flex items-center gap-1 px-1">
          <ThemeToggle />
          <LocaleSwitcher />
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={logout} title={tc("signOut")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
