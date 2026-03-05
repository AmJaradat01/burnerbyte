"use client";

import { useAuthStore } from "@/stores/auth-store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CommandPalette } from "@/components/command-palette";
import { NotificationCenter } from "@/components/notification-center";
import { ShortcutHelp } from "@/components/shortcut-help";
import { useKeyboardShortcuts, useShortcutHelp } from "@/hooks/use-keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";

const publicPaths = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/invite", "/setup", "/onboarding", "/docs"];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  const isLanding = pathname === "/";
  const [setupChecked, setSetupChecked] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const shortcutHelp = useShortcutHelp();

  useKeyboardShortcuts({
    "?": shortcutHelp.toggle,
  });

  useEffect(() => {
    api.get<{ completed: boolean }>("/setup/status")
      .then((res) => {
        setSetupCompleted(res.completed);
        setSetupChecked(true);
      })
      .catch(() => setSetupChecked(true));
  }, []);

  useEffect(() => {
    if (!setupChecked) return;
    if (!setupCompleted && pathname !== "/setup") {
      router.replace("/setup");
      return;
    }
    if (loading) return;
    if (!user && !isPublic && !isLanding) router.replace("/login");
    if (user && isPublic && pathname !== "/setup" && !pathname.startsWith("/docs")) router.replace("/");
  }, [user, loading, isPublic, isLanding, router, setupChecked, setupCompleted, pathname]);

  // Close mobile sidebar on navigation
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  if (!setupChecked || loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status">
          <span className="sr-only">Loading</span>
        </div>
      </div>
    );
  }

  if (!setupCompleted) return <main className="min-h-screen">{children}</main>;
  if ((isPublic || isLanding) && !user) return <main className="min-h-screen">{children}</main>;
  if (isPublic) return <main className="min-h-screen">{children}</main>;

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="fixed top-3 left-3 z-50 md:hidden" aria-label="Open menu">
            ☰
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar />
        </SheetContent>
      </Sheet>

      <main className="flex-1 overflow-auto p-4 pt-14 md:p-6 md:pt-6">
        <div className="flex items-center justify-between mb-4">
          <Breadcrumbs />
          <NotificationCenter />
        </div>
        {children}
      </main>
      <CommandPalette />
      <ShortcutHelp open={shortcutHelp.open} onOpenChange={shortcutHelp.setOpen} />
    </div>
  );
}
