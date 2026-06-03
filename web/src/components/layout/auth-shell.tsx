"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";

/**
 * Shared frame for the unauthenticated auth funnel (login, register, forgot /
 * reset password, verify email). A split layout: a dark, art-directed brand
 * panel that echoes the landing page's datasheet language, beside a calm
 * warm-paper column that holds the form unchanged. The panel is desktop-only;
 * on small screens a compact logo + tagline takes its place.
 *
 * Light is forced app-wide, so the panel's dark tokens are set explicitly.
 */
const panel = {
  bg: "bg-[oklch(0.16_0.018_265)]",
  text: "text-[oklch(0.96_0.004_75)]",
  dim: "text-[oklch(0.66_0.03_265)]",
  accent: "text-[oklch(0.72_0.16_265)]",
  rule: "bg-[oklch(0.70_0.16_265)]",
};

export function AuthShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("auth");

  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-2">
      <aside className={`relative hidden flex-col justify-between p-10 lg:flex ${panel.bg} ${panel.text}`}>
        <Link href="/" aria-label="BurnerByte home" className="inline-flex flex-col">
          <span className="text-xl font-bold tracking-tight">
            Burner<span className={panel.accent}>Byte</span>
          </span>
          <span className={`mt-1 font-mono text-[11px] uppercase tracking-[0.14em] ${panel.dim}`}>
            {t("brandMasthead")}
          </span>
        </Link>
        <div>
          <p className="max-w-sm text-balance text-2xl font-semibold leading-snug tracking-tight">
            {t("brandHeadline")}
          </p>
          <div className="mt-6 flex items-center gap-3">
            <span className={`h-px w-8 shrink-0 ${panel.rule}`} />
            <span className={`font-mono text-[11px] ${panel.dim}`}>{t("brandSpec")}</span>
          </div>
        </div>
      </aside>

      <main id="main-content" className="flex min-h-screen flex-col bg-background">
        <div className="px-6 pt-10 text-center lg:hidden">
          <Logo size="lg" />
          <p className="mt-2 text-sm text-muted-foreground">{t("brandTagline")}</p>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}
