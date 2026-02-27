"use client";

import { useAuthStore } from "@/stores/auth-store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Sidebar } from "./sidebar";

const publicPaths = ["/login", "/register", "/forgot-password", "/verify-email", "/invite"];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) router.replace("/login");
    if (user && isPublic) router.replace("/inboxes");
  }, [user, loading, isPublic, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" role="status">
          <span className="sr-only">Loading</span>
        </div>
      </div>
    );
  }

  if (isPublic) return <main className="min-h-screen">{children}</main>;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
