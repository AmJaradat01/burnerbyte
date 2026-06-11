"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ArrowRight, Gitlab, Inbox, Users, Zap, Webhook, KeyRound, Server } from "lucide-react";
import { api, tryGetStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { LiveInboxDemo } from "./live-inbox-demo";

/** Canonical repository, from the go.mod module path (gitlab.com/burnerbyte/burnerbyte). */
const REPO_URL = "https://gitlab.com/burnerbyte/burnerbyte";
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
      <span className="h-px w-8 shrink-0 bg-primary" />
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
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6 sm:px-8">
          <Link href="/" aria-label="BurnerByte home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-0.5 text-sm sm:gap-1">
            <Link href="/docs" className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground">
              {t("nav.docs")}
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              <Gitlab className="h-4 w-4" />
              {t("nav.repo")}
            </a>
            <Link href="/login" className="rounded-md px-3 py-2 font-medium transition-colors hover:bg-muted">
              {t("nav.signIn")}
            </Link>
            {allowRegistration && (
              <Link
                href="/register"
                className="ml-1 inline-flex items-center rounded-md bg-primary px-3.5 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t("nav.getStarted")}
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* ── Datasheet masthead ── */}
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:px-8">
          <span className="truncate">{t("meta.infra")}</span>
          <span className="shrink-0 text-foreground/70">{t("meta.license")}</span>
        </div>
      </div>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-6xl px-6 sm:px-8">
        <div className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-12 lg:gap-10 lg:py-24">
          <div className="lg:col-span-7">
            <h1 className="text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl">
              <span className="block">{t("hero.headlineA")}</span>
              <span className="block">{t("hero.headlineB")}</span>
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              {t("hero.subtitle")}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href={allowRegistration ? "/register" : "/login"}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {allowRegistration ? t("hero.getStarted") : t("cta.signIn")}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/docs"
                className="inline-flex h-11 items-center rounded-md border border-border bg-background px-6 text-sm font-medium transition-colors hover:bg-muted"
              >
                {t("hero.docs")}
              </Link>
              {demoEnabled && (
              <Link
                href="/try"
                className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-background px-6 text-sm font-medium transition-colors hover:bg-muted"
              >
                {t("hero.tryIt")}
              </Link>
              )}
            </div>
            <ul className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t("hero.spec").split("·").map((item, i) => (
                <li key={item} className="flex items-center gap-3">
                  {i > 0 && <span className="h-3 w-px bg-border" aria-hidden="true" />}
                  <span>{item.trim()}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-5">
            <LiveInboxDemo
              labels={{
                inboxLabel: t("demo.inbox"),
                expiresIn: t("demo.expiresIn"),
                expired: t("demo.expired"),
              }}
            />
          </div>
        </div>
      </section>

      {/* ── 01 Lifecycle ── */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8 sm:py-20">
          <SectionKicker>{t("how.kicker")}</SectionKicker>
          <h2 className="mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("how.title")}
          </h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
            {steps.map((step) => (
              <div key={step.num} className="bg-background p-6 sm:p-8">
                <div className="font-mono text-xs text-primary">{step.num}</div>
                <div className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {step.label}
                </div>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
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
          <dl className="mt-12 border-y border-border">
            {capabilities.map((cap, i) => (
              <div
                key={cap.label}
                className={cn(
                  "grid gap-2 py-5 sm:grid-cols-[13rem_1fr] sm:gap-10 sm:py-6",
                  i > 0 && "border-t border-border",
                )}
              >
                <dt className="flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <cap.Icon className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                  {cap.label}
                </dt>
                <dd className="sm:flex sm:items-baseline sm:gap-4">
                  <span className="font-semibold sm:w-44 sm:shrink-0">{cap.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted-foreground sm:mt-0">{cap.desc}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── 03 Ownership (dark climax) ── */}
      <section className={cn("border-t border-border", dark.bg, dark.text)}>
        <div className="mx-auto max-w-6xl px-6 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
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
              <Link
                href="/docs/self-hosting/production"
                className={cn("mt-8 inline-flex items-center gap-2 text-sm font-medium transition-colors", dark.accent, dark.accentHover)}
              >
                {t("trust.cta")}
                <ArrowRight className="h-4 w-4" />
              </Link>
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
                  <span className={dark.body}>Your inbox platform is live.</span>
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-20 text-center sm:px-8 sm:py-24">
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{t("cta.title")}</h2>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">{t("cta.subtitle")}</p>
          <div className="mt-8 flex justify-center">
            <Link
              href={allowRegistration ? "/register" : "/login"}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {allowRegistration ? t("cta.getStarted") : t("cta.signIn")}
              <ArrowRight className="h-4 w-4" />
            </Link>
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
              <FooterLink href="/docs">{t("footer.docs")}</FooterLink>
              <FooterLink href="/docs/api">{t("footer.api")}</FooterLink>
              <FooterLink href="/docs/self-hosting/production">{t("footer.selfHosting")}</FooterLink>
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
        <a href={href} target="_blank" rel="noreferrer" className="text-muted-foreground transition-colors hover:text-foreground">
          {children}
        </a>
      </li>
    );
  }
  return (
    <li>
      <Link href={href} className="text-muted-foreground transition-colors hover:text-foreground">
        {children}
      </Link>
    </li>
  );
}
