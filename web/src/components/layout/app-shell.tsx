"use client";

import { useAuthStore } from "@/stores/auth-store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { api } from "@/lib/api";

const publicPaths = ["/login", "/register", "/forgot-password", "/verify-email", "/invite", "/setup"];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  const [setupChecked, setSetupChecked] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(true);

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
    if (!user && !isPublic) router.replace("/login");
    if (user && isPublic && pathname !== "/setup") router.replace("/inboxes");
  }, [user, loading, isPublic, router, setupChecked, setupCompleted, pathname]);

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
  if (isPublic) return <main className="min-h-screen">{children}</main>;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
