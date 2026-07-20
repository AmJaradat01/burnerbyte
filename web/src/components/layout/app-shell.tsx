"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { TopNav } from "./top-nav";
import { Footer } from "./footer";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CommandPalette } from "@/components/command-palette";
import { NotificationCenter } from "@/components/notification-center";
import { ShortcutHelp } from "@/components/shortcut-help";
import { SkipToContent } from "@/components/skip-to-content";
import { PageProgress } from "@/components/page-progress";
import { OfflineBanner } from "@/components/offline-banner";
import { Logo } from "@/components/logo";
import { useKeyboardShortcuts, useShortcutHelp } from "@/hooks/use-keyboard-shortcuts";
import { useOrgBootstrap } from "@/hooks/use-org-bootstrap";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

/**
 * Paths accessible without authentication.
 */
const publicPaths = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/setup",
  "/onboarding",
  "/docs",
];

/**
 * Public paths that should redirect authenticated users away to "/".
 * Paths NOT in this list (e.g. /onboarding, /invite, /setup, /docs)
 * remain accessible to authenticated users — they have legitimate reasons
 * to be there (completing onboarding, accepting invites, etc.).
 */
const authBouncePaths = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthStore();
  const { currentRole, hasPermission } = useOrgStore();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  const isLanding = pathname === "/";
  const shouldBounceAuth = authBouncePaths.some((p) => pathname.startsWith(p));
  const [setupChecked, setSetupChecked] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("sidebar-collapsed") === "true";
    return false;
  });
  const shortcutHelp = useShortcutHelp();

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  };

  const isOrgAdmin = hasPermission("org.settings.manage") || user?.is_system_admin;
  const roleResolved = currentRole !== null || user?.is_system_admin || !user;

  useOrgBootstrap();

  useKeyboardShortcuts({
    "?": shortcutHelp.toggle,
  });

  // Check initial setup status
  useEffect(() => {
    api.get<{ completed: boolean }>("/setup/status")
      .then((res) => {
        setSetupCompleted(res.completed);
        setSetupChecked(true);
      })
      .catch(() => setSetupChecked(true));
  }, []);

  // Routing guards
  useEffect(() => {
    if (!setupChecked) return;

    // Force setup if not completed
    if (!setupCompleted && pathname !== "/setup") {
      router.replace("/setup");
      return;
    }

    if (loading) return;

    // Unauthenticated user on protected route → login
    if (!user && !isPublic && !isLanding) {
      router.replace("/login");
      return;
    }

    // Authenticated user on auth-only pages (login/register/etc.) → home
    // Does NOT bounce from /onboarding, /invite, /setup, /docs
    if (user && shouldBounceAuth) {
      router.replace("/");
      return;
    }
  }, [user, loading, isPublic, isLanding, shouldBounceAuth, router, setupChecked, setupCompleted, pathname]);

  // Close mobile nav on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]); // eslint-disable-line react-hooks/set-state-in-effect

  // Loading states — don't block public pages (onboarding, invite, etc.)
  if (!setupChecked || loading || (user && !roleResolved && !isPublic)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <Logo size="lg" />
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status">
          <span className="sr-only">Loading</span>
        </div>
      </div>
    );
  }

  // Setup not completed — minimal layout
  if (!setupCompleted) return <main className="min-h-screen">{children}</main>;

  // Landing page — has its own header/footer
  if (isLanding && !user) return <main className="min-h-screen">{children}</main>;

  // Auth funnel (login/register/forgot/reset/verify) for unauthenticated users —
  // the split-screen AuthShell owns its own chrome.
  if (shouldBounceAuth && !user) return (
    <>
      <SkipToContent />
      <PageProgress />
      <OfflineBanner />
      {children}
    </>
  );

  // Other public pages for unauthenticated users — shared header & footer
  if (isPublic && !user) return (
    <UnauthPublicLayout>{children}</UnauthPublicLayout>
  );

  // Authenticated user on public pages (onboarding, invite, docs) — minimal layout
  if (isPublic) return <main className="min-h-screen">{children}</main>;

  // ── Admin layout: sidebar ──
  if (isOrgAdmin) {
    return (
      <div className="flex h-screen">
        <SkipToContent />
        <PageProgress />
        <OfflineBanner />
        <div className="hidden md:block">
          <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        </div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="fixed top-3 left-3 z-50 md:hidden" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex-1 flex flex-col min-h-0">
          <main id="main-content" className="flex-1 overflow-auto">
            <div className="flex flex-col min-h-full p-4 pt-14 md:p-6 md:pt-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Breadcrumbs />
                </div>
                <NotificationCenter />
              </div>
              <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
                <div className="animate-in fade-in duration-200 flex-1">
                  {children}
                </div>
              </Suspense>
              <Footer />
            </div>
          </main>
        </div>
        <CommandPalette />
        <ShortcutHelp open={shortcutHelp.open} onOpenChange={shortcutHelp.setOpen} />
      </div>
    );
  }

  // ── Regular user layout: top nav + footer ──
  return (
    <div className="flex flex-col min-h-screen">
      <SkipToContent />
      <PageProgress />
      <OfflineBanner />
      <TopNav />
      <main id="main-content" className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <Breadcrumbs />
        <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
          <div className="animate-in fade-in duration-200">
            {children}
          </div>
        </Suspense>
      </main>
      <Footer />
      <CommandPalette />
      <ShortcutHelp open={shortcutHelp.open} onOpenChange={shortcutHelp.setOpen} />
    </div>
  );
}

function UnauthPublicLayout({ children }: { children: ReactNode }) {
  const { data: sso } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<{ allow_registration: boolean }>("/auth/sso-status"),
    staleTime: 60000,
  });
  const allowRegistration = sso?.allow_registration ?? true;

  return (
    <div className="flex flex-col min-h-screen">
      <SkipToContent />
      <PageProgress />
      <OfflineBanner />
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/login" className="text-muted-foreground hover:text-foreground">Sign In</Link>
            {allowRegistration && (
              <Link href="/register" className="text-muted-foreground hover:text-foreground">Get Started</Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main-content" className="flex-1">{children}</main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} BurnerByte</footer>
    </div>
  );
}
