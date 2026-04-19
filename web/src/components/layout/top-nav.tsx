"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";

export function TopNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const t = useTranslations("nav");
  const tc = useTranslations("common");

  const links = [
    { href: "/", label: t("home") },
    { href: "/docs", label: t("docs") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="text-lg">🔥</span>
            <span className="hidden sm:inline">BurnerByte</span>
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: actions + profile */}
        <div className="flex items-center gap-1">
          <Link
            href="/profile"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted transition-colors"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {user?.display_name?.charAt(0).toUpperCase() || "?"}
            </div>
            <span className="hidden sm:inline text-sm font-medium max-w-[120px] truncate">{user?.display_name}</span>
          </Link>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" onClick={logout} title={tc("signOut")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
