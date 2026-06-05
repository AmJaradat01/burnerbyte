"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { ExternalLink } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t bg-muted/20 mt-auto">
      <div className="px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Logo size="sm" />
            <span className="hidden sm:inline">· Self-hosted temporary email</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            <a
              href="https://gitlab.com/burnerbyte/burnerbyte"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              GitLab
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <span className="text-muted-foreground/50">Apache 2.0</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
