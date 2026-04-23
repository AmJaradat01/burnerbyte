"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";

export function Footer() {
  const user = useAuthStore((s) => s.user);

  const { data: versionData } = useQuery({
    queryKey: ["app-version"],
    queryFn: () => api.get<{ version: string }>("/admin/version"),
    staleTime: 300_000,
    enabled: !!user?.is_system_admin,
  });

  const version = versionData?.version;

  return (
    <footer className="border-t bg-muted/30 mt-auto">
      <div className="px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Logo size="sm" />
            <span>— Self-hosted temporary email</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            <a href="https://gitlab.com/burnerbyte/burnerbyte" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitLab</a>
            <span>Apache 2.0</span>
            {version && (
              <span title={`Version ${version}`}>v{version}</span>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
