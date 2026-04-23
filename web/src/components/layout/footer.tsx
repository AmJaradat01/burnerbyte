"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useEffect, useState } from "react";

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

export function Footer() {
  const [hasNewVersion, setHasNewVersion] = useState(false);

  useEffect(() => {
    const lastSeen = localStorage.getItem("last-seen-version");
    if (lastSeen && lastSeen !== appVersion && appVersion !== "dev") {
      setHasNewVersion(true);
    }
  }, []);

  const dismissVersionDot = () => {
    localStorage.setItem("last-seen-version", appVersion);
    setHasNewVersion(false);
  };

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
            <button
              onClick={dismissVersionDot}
              className="relative hover:text-foreground transition-colors"
              title={hasNewVersion ? "New version available — click to dismiss" : `Version ${appVersion}`}
            >
              v{appVersion}
              {hasNewVersion && (
                <span className="absolute -top-1 -right-2 h-2 w-2 rounded-full bg-primary" />
              )}
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
