"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NotificationCenter } from "@/components/notification-center";
import { useTranslations } from "next-intl";
import { Home, BookOpen, LogOut } from "lucide-react";
import { Logo } from "@/components/logo";
import { docsUrl } from "@/lib/docs-url";

export function TopNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const t = useTranslations("nav");
  const tc = useTranslations("common");

  const links = [
    { href: "/", label: t("home"), icon: Home },
    { href: docsUrl(), label: t("docs"), icon: BookOpen, external: true },
  ];

  const userInitial = user?.display_name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || "?";

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        {/* Left: logo + nav */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity duration-150">
            <span className="sm:hidden"><Logo collapsed /></span>
            <span className="hidden sm:inline"><Logo /></span>
          </Link>
          <nav className="flex items-center gap-1">
            {links.map((link) => {
              const active = link.external
                ? false
                : link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              const Anchor = link.external ? "a" : Link;
              return (
                <Anchor
                  key={link.href}
                  href={link.href}
                  {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-[0.97]"
                  )}
                >
                  <link.icon className={cn("h-3.5 w-3.5 transition-colors duration-150", active && "text-primary")} />
                  {link.label}
                </Anchor>
              );
            })}
          </nav>
        </div>

        {/* Right: notifications + profile + logout */}
        <div className="flex items-center gap-1">
          <NotificationCenter />
          <Link
            href="/profile"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/80 transition-colors duration-150 group"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-1 ring-border">
              {userInitial}
            </div>
            <span className="hidden sm:inline text-sm font-medium max-w-[120px] truncate group-hover:text-foreground transition-colors duration-150">
              {user?.display_name}
            </span>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive transition-colors duration-150"
            onClick={logout}
            title={tc("signOut")}
            aria-label={tc("signOut")}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
