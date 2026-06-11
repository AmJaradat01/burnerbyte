"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { tryGetStatus } from "@/lib/api";
import { TryInbox } from "@/components/landing/try-inbox";
import { Logo } from "@/components/logo";

export default function TryPage() {
  const t = useTranslations("landing");
  const { data: enabled, isLoading } = useQuery({
    queryKey: ["demo-status"],
    queryFn: tryGetStatus,
    staleTime: 60_000,
  });

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo size="sm" />
            <span className="font-semibold">BurnerByte</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-12">
        {isLoading ? null : enabled ? (
          <>
            <h1 className="mb-2 text-center text-2xl font-bold tracking-tight">
              Try it now
            </h1>
            <p className="mb-8 text-center text-sm text-muted-foreground">
              {t("demo.emptyHint")}
            </p>
            <div className="w-full">
              <TryInbox
                labels={{
                  inboxLabel: t("demo.inbox"),
                  expiresIn: t("demo.expiresIn"),
                  expired: t("demo.expired"),
                  caption: t("demo.caption"),
                  liveCaption: t("demo.liveCaption"),
                  emptyHint: t("demo.emptyHint"),
                  copy: t("demo.copy"),
                  copied: t("demo.copied"),
                  newInbox: t("demo.newInbox"),
                }}
              />
            </div>
          </>
        ) : (
          <div className="text-center">
            <h1 className="mb-2 text-2xl font-bold tracking-tight">Demo unavailable</h1>
            <p className="text-sm text-muted-foreground">The live demo is currently disabled.</p>
          </div>
        )}
      </main>
    </div>
  );
}
