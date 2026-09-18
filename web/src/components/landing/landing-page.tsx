"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ArrowRight, Github, Inbox, Users, Zap, Webhook, KeyRound, Server } from "lucide-react";
import { api, tryGetStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { docsUrl } from "@/lib/docs-url";
import { LiveInboxDemo } from "./live-inbox-demo";

/** Canonical repository, from the go.mod module path (github.com/amjaradat01/burnerbyte). */
const REPO_URL = "https://github.com/AmJaradat01/burnerbyte";
const APACHE_URL = "https://www.apache.org/licenses/LICENSE-2.0";

interface SSOStatus {
  enabled: boolean;
  allow_registration: boolean;
  enforce_sso?: boolean;
}

/* The one deliberately dark, art-directed section. Light is forced app-wide,
   so these tokens are set explicitly rather than via a theme class. */
const dark = {
  bg: "bg-[oklch(0.16_0.018_265)]",
  panel: "bg-[oklch(0.128_0.015_265)]",
  border: "border-[oklch(0.30_0.02_265)]",
  text: "text-[oklch(0.96_0.004_75)]",
  body: "text-[oklch(0.80_0.02_265)]",
  dim: "text-[oklch(0.68_0.03_265)]",
  code: "text-[oklch(0.84_0.02_265)]",
  accent: "text-[oklch(0.82_0.12_265)]",
  accentHover: "hover:text-[oklch(0.90_0.10_265)]",
  rule: "bg-[oklch(0.70_0.16_265)]",
  ok: "text-[oklch(0.80_0.13_150)]",
};

function SectionKicker({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px w-8 shrink-0 bg-primary/60" />
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{children}</span>
    </div>
  );
}

export function LandingPage() {
  const t = useTranslations("landing");
  const year = new Date().getFullYear();

  const { data: sso } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatus>("/auth/sso-status"),
    staleTime: 60_000,
  });
  const allowRegistration = sso?.allow_registration ?? true;

  const { data: demoStatus } = useQuery({
    queryKey: ["demo-status"],
    queryFn: tryGetStatus,
    staleTime: 60_000,
  });
  const demoEnabled = demoStatus === true;

  const steps = [
    { num: "01", label: t("how.createLabel"), title: t("how.createTitle"), desc: t("how.createDesc") },
    { num: "02", label: t("how.receiveLabel"), title: t("how.receiveTitle"), desc: t("how.receiveDesc") },
    { num: "03", label: t("how.expireLabel"), title: t("how.expireTitle"), desc: t("how.expireDesc") },
  ];

  const capabilities = [
    { Icon: Inbox, label: t("capabilities.inboxesLabel"), title: t("capabilities.inboxesTitle"), desc: t("capabilities.inboxesDesc") },
    { Icon: Users, label: t("capabilities.teamsLabel"), title: t("capabilities.teamsTitle"), desc: t("capabilities.teamsDesc") },
    { Icon: Zap, label: t("capabilities.realtimeLabel"), title: t("capabilities.realtimeTitle"), desc: t("capabilities.realtimeDesc") },
    { Icon: Webhook, label: t("capabilities.webhooksLabel"), title: t("capabilities.webhooksTitle"), desc: t("capabilities.webhooksDesc") },
    { Icon: KeyRound, label: t("capabilities.apiLabel"), title: t("capabilities.apiTitle"), desc: t("capabilities.apiDesc") },
    { Icon: Server, label: t("capabilities.hostingLabel"), title: t("capabilities.hostingTitle"), desc: t("capabilities.hostingDesc") },
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6 sm:px-8">
          <Link href="/" aria-label="BurnerByte home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-0.5 text-sm sm:gap-1">
            <a
              href={docsUrl()}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-3 py-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              {t("nav.docs")}
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-muted-foreground transition-colors duration-150 hover:text-foreground sm:inline-flex"
            >
              <Github className="h-4 w-4" />
              {t("nav.repo")}
            </a>
            <Link href="/login" className="rounded-md px-3 py-2 font-medium transition-colors duration-150 hover:bg-muted">
              {t("nav.signIn")}
            </Link>
            {allowRegistration && (
              <Link
                href="/register"
                className="ml-1 inline-flex items-center rounded-md bg-primary px-3.5 py-2 font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
              >
                {t("nav.getStarted")}
              </Link>
            )}
          </nav>
        </div>
      </header>

      <div className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] grid-texture" />

        {/* ── Datasheet masthead ── */}
        <div className="border-b border-border">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:px-8">
            <span className="truncate">{t("meta.infra")}</span>
            <span className="shrink-0 text-foreground/70">{t("meta.license")}</span>
          </div>
        </div>

        {/* ── Hero ── */}
        <section className="mx-auto max-w-6xl px-6 sm:px-8">
          <div className="grid items-center gap-12 py-20 sm:py-24 lg:grid-cols-12 lg:gap-14 lg:py-28">
            <div className="lg:col-span-7">
              <h1 className="anim-rise text-display">
                <span className="block">{t("hero.headlineA")}</span>
                <span className="block text-primary">{t("hero.headlineB")}</span>
              </h1>
              <p
                className="anim-rise mt-7 max-w-lg text-pretty text-[1.05rem] leading-relaxed text-muted-foreground"
                style={{ animationDelay: "70ms" }}
              >
                {t("hero.subtitle")}
              </p>
              <div className="anim-rise mt-10 flex flex-wrap items-center gap-3" style={{ animationDelay: "140ms" }}>
                <Link
                  href={allowRegistration ? "/register" : "/login"}
                  className="group inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/85 hover:shadow-md active:translate-y-px"
                >
                  {allowRegistration ? t("hero.getStarted") : t("cta.signIn")}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
                {demoEnabled ? (
                  <Link
                    href="/try"
                    className="inline-flex h-12 items-center rounded-lg border border-border bg-background px-7 text-sm font-medium transition-all duration-150 hover:bg-muted hover:border-border/80 active:translate-y-px"
                  >
                    {t("hero.tryIt")}
                  </Link>
                ) : (
                  <a
                    href={docsUrl()}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 items-center rounded-lg border border-border bg-background px-7 text-sm font-medium transition-all duration-150 hover:bg-muted hover:border-border/80 active:translate-y-px"
                  >
                    {t("hero.docs")}
                  </a>
                )}
              </div>
              <ul
                className="anim-rise mt-9 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground"
                style={{ animationDelay: "210ms" }}
              >
                {t("hero.spec").split("·").map((item, i) => (
                  <li key={item} className="flex items-center gap-4">
                    {i > 0 && <span className="h-3.5 w-px bg-border" aria-hidden="true" />}
                    <span>{item.trim()}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="anim-rise lg:col-span-5" style={{ animationDelay: "120ms" }}>
              <div className="relative">
                {/* Decorative gradient backdrop - stronger presence */}
                <div
                  aria-hidden="true"
                  className="absolute -inset-6 -z-10 rounded-3xl"
                  style={{
                    background: "radial-gradient(ellipse 90% 80% at 55% 40%, color-mix(in oklch, var(--primary) 12%, transparent), transparent 70%)",
                  }}
                />
                <LiveInboxDemo
                  labels={{
                    inboxLabel: t("demo.inbox"),
                    expiresIn: t("demo.expiresIn"),
                    expired: t("demo.expired"),
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── 01 Lifecycle ── */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8 sm:py-20">
          <SectionKicker>{t("how.kicker")}</SectionKicker>
          <h2 className="mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("how.title")}
          </h2>
          <div className="reveal mt-12 grid gap-6 sm:grid-cols-3">
            {steps.map((step, i) => (
              <div key={step.num} className={`relative group ${i === 0 ? "reveal-d1" : i === 1 ? "reveal-d2" : "reveal-d3"}`}>
                {/* Connector line between steps (hidden on mobile and for last item) */}
                {i < steps.length - 1 && (
                  <div aria-hidden="true" className="absolute top-8 -right-3 hidden h-px w-6 bg-border sm:block" />
                )}
                <div className="h-full rounded-xl border bg-background p-6 transition-colors duration-200 hover:bg-muted/40 sm:p-8">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 font-mono text-sm font-bold text-primary tabular-nums">
                    {step.num}
                  </div>
                  <div className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    {step.label}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 02 Capabilities ── */}
      <section className="border-t border-border bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8 sm:py-20">
          <SectionKicker>{t("capabilities.kicker")}</SectionKicker>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("capabilities.title")}
            </h2>
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{t("capabilities.subtitle")}</p>
          </div>

          {/* Primary capabilities - larger, visual grid */}
          <div className="reveal mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.slice(0, 3).map((cap) => (
              <div
                key={cap.label}
                className="group h-full rounded-xl border bg-background p-6 transition-all duration-200 hover:shadow-sm hover:border-primary/20"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted transition-colors duration-200 group-hover:bg-primary/10">
                  <cap.Icon
                    className="h-5 w-5 text-muted-foreground transition-colors duration-200 group-hover:text-primary"
                    aria-hidden="true"
                  />
                </div>
                <h3 className="mt-4 font-semibold">{cap.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{cap.desc}</p>
              </div>
            ))}
          </div>

          {/* Secondary capabilities - compact horizontal list */}
          <div className="reveal mt-4 grid gap-4 sm:grid-cols-3">
            {capabilities.slice(3).map((cap) => (
              <div
                key={cap.label}
                className="group flex h-full items-start gap-3 rounded-lg border bg-background px-4 py-4 transition-colors duration-200 hover:bg-muted/40"
              >
                <cap.Icon
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors duration-200 group-hover:text-primary"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{cap.title}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{cap.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 03 Ownership (dark climax) ── */}
      <section className={cn("border-t border-border", dark.bg, dark.text)}>
        <div className="mx-auto max-w-6xl px-6 py-20 sm:px-8 sm:py-28">
          <div className="reveal-up grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div>
              <div className="flex items-center gap-3">
                <span className={cn("h-px w-8 shrink-0", dark.rule)} />
                <span className={cn("font-mono text-xs uppercase tracking-[0.18em]", dark.dim)}>{t("trust.kicker")}</span>
              </div>
              <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem] lg:leading-[1.08]">
                {t("trust.title")}
              </h2>
              <p className={cn("mt-5 max-w-lg text-pretty leading-relaxed", dark.body)}>{t("trust.body")}</p>
              <p className={cn("mt-8 font-mono text-xs", dark.dim)}>{t("trust.facts")}</p>
              <a
                href={docsUrl("self-hosting/production")}
                target="_blank"
                rel="noreferrer"
                className={cn("group mt-8 inline-flex items-center gap-2 text-sm font-medium transition-colors duration-150", dark.accent, dark.accentHover)}
              >
                {t("trust.cta")}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
            </div>

            <div className={cn("overflow-hidden rounded-xl border", dark.border, dark.panel)}>
              <div className={cn("border-b px-4 py-2.5", dark.border)}>
                <span className={cn("font-mono text-[11px]", dark.dim)}>{t("trust.deployCaption")}</span>
              </div>
              <pre className={cn("overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed", dark.code)}>
                <code>
                  <span className={dark.dim}>$</span> docker compose up -d{"\n"}
                  <span className={dark.ok}>{"✓"}</span> smtpd{"   "}
                  <span className={dark.dim}>listening on :25</span>{"\n"}
                  <span className={dark.ok}>{"✓"}</span> api{"     "}
                  <span className={dark.dim}>listening on :8080</span>{"\n"}
                  <span className={dark.ok}>{"✓"}</span> web{"     "}
                  <span className={dark.dim}>ready at http://localhost:3000</span>{"\n\n"}
                  <span className={dark.body}>Your inbox platform is live.</span>{" "}
                  <span className={cn("cursor-blink", dark.accent)} aria-hidden="true">
                    {"▋"}
                  </span>
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative isolate border-t border-border">
        <div aria-hidden className="cta-veil pointer-events-none absolute inset-0 -z-10" />
        <div className="reveal-up mx-auto max-w-6xl px-6 py-24 sm:px-8 sm:py-32">
          <div className="mx-auto max-w-lg text-center">
            <h2 className="text-headline">{t("cta.title")}</h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">{t("cta.subtitle")}</p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href={allowRegistration ? "/register" : "/login"}
                className="group inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/85 hover:shadow-md active:translate-y-px"
              >
                {allowRegistration ? t("cta.getStarted") : t("cta.signIn")}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <a
                href={docsUrl("self-hosting/production")}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-12 items-center rounded-lg border border-border bg-background px-7 text-sm font-medium transition-all duration-150 hover:bg-muted hover:border-border/80 active:translate-y-px"
              >
                {t("trust.cta")}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-muted/20">
        <div className="mx-auto max-w-6xl px-6 py-12 sm:px-8">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
            <div>
              <Logo />
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">{t("footer.tagline")}</p>
            </div>
            <FooterCol label={t("footer.productLabel")}>
              <FooterLink href="/login">{t("nav.signIn")}</FooterLink>
              {allowRegistration && <FooterLink href="/register">{t("nav.getStarted")}</FooterLink>}
            </FooterCol>
            <FooterCol label={t("footer.resourcesLabel")}>
              <FooterLink href={docsUrl()} external>
                {t("footer.docs")}
              </FooterLink>
              <FooterLink href={docsUrl("api")} external>
                {t("footer.api")}
              </FooterLink>
              <FooterLink href={docsUrl("self-hosting/production")} external>
                {t("footer.selfHosting")}
              </FooterLink>
            </FooterCol>
            <FooterCol label={t("footer.projectLabel")}>
              <FooterLink href={REPO_URL} external>
                {t("footer.repo")}
              </FooterLink>
              <FooterLink href={APACHE_URL} external>
                {t("footer.license")}
              </FooterLink>
            </FooterCol>
          </div>
          <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              {"©"} {year} BurnerByte. {t("footer.rights")}
            </p>
            <p className="font-mono">{t("footer.licenseLine")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <ul className="mt-4 space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, external, children }: { href: string; external?: boolean; children: React.ReactNode }) {
  if (external) {
    return (
      <li>
        <a href={href} target="_blank" rel="noreferrer" className="text-muted-foreground transition-colors duration-150 hover:text-foreground">
          {children}
        </a>
      </li>
    );
  }
  return (
    <li>
      <Link href={href} className="text-muted-foreground transition-colors duration-150 hover:text-foreground">
        {children}
      </Link>
    </li>
  );
}
