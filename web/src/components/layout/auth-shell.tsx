"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/logo";
import { LiveInboxDemo } from "@/components/landing/live-inbox-demo";

/**
 * Shared frame for the unauthenticated auth funnel (login, register, forgot /
 * reset password, verify email). A split layout: a dark, art-directed brand
 * panel that echoes the landing page's datasheet language and shows a calm,
 * static preview of the product, beside a warm-paper column that holds the
 * form unchanged. The panel is desktop-only; on small screens a compact logo
 * + tagline takes its place.
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
  const td = useTranslations("landing");

  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-2">
      <aside className={`relative hidden flex-col p-10 lg:flex ${panel.bg} ${panel.text} overflow-hidden`}>
        {/* Grid texture backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(oklch(0.96 0.004 265) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Subtle radial glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-0"
          style={{
            background: "radial-gradient(ellipse 60% 50% at 50% 60%, oklch(0.52 0.215 264 / 0.08), transparent 70%)",
          }}
        />

        <Link href="/" aria-label="BurnerByte home" className="relative inline-flex flex-col">
          <span className="text-2xl font-extrabold tracking-tight">
            Burner<span className={panel.accent}>Byte</span>
          </span>
          <span className={`mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] ${panel.dim}`}>
            {t("brandMasthead")}
          </span>
        </Link>

        <div className="relative flex flex-1 flex-col justify-center py-10">
          <div className="w-full max-w-sm space-y-10">
            <p className="text-balance text-[2rem] font-extrabold leading-[1.1] tracking-tight">
              {t("brandHeadline")}
            </p>

            <LiveInboxDemo
              staticPreview
              labels={{ inboxLabel: td("demo.inbox"), expiresIn: td("demo.expiresIn"), expired: td("demo.expired") }}
            />

            <div className="flex items-center gap-3">
              <span className={`h-px w-10 shrink-0 ${panel.rule}`} />
              <span className={`font-mono text-[11px] ${panel.dim}`}>{t("brandSpec")}</span>
            </div>
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
