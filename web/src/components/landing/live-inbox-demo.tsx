"use client";

import { useEffect, useState } from "react";
import { Clock, CircleSlash } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LiveInboxDemoLabels {
  inboxLabel: string;
  expiresIn: string;
  expired: string;
}

interface DemoEmail {
  from: string;
  subject: string;
  time: string;
}

/**
 * Illustrative fixtures. These are demo data, not real messages, so the
 * component never touches the network and can never be an abuse vector.
 */
const DEMO_EMAILS: DemoEmail[] = [
  { from: "Stripe", subject: "Your receipt from Acme, Inc.", time: "now" },
  { from: "GitHub", subject: "[acme/api] Verify your new device", time: "now" },
  { from: "Linear", subject: "You were assigned ENG-2241", time: "1m" },
  { from: "Vercel", subject: "Deployment ready: acme-web", time: "2m" },
];

const DOMAINS = ["mail.acme.dev", "inbox.acme.io", "rcpt.acme.sh"];
const START_SECONDS = 597; // 09:57, a believable TTL
const INITIAL_LOCAL = "q7k2x9";

function randomLocal(): string {
  const s = Math.random().toString(36).replace(/[^a-z0-9]/g, "");
  return (s + "000000").slice(0, 6);
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Phase = "live" | "burning" | "expired";

/**
 * A self-contained vignette of the real product lifecycle: an address is
 * generated, mail streams in, the timer runs out, and the inbox burns down
 * before a fresh one takes its place. No backend, no network, looped on a
 * timeline. Static and calm under prefers-reduced-motion.
 *
 * Marked aria-hidden: it is a decorative demonstration. The surrounding
 * section carries a real text caption for assistive technology.
 */
export function LiveInboxDemo({ labels, staticPreview = false }: { labels: LiveInboxDemoLabels; staticPreview?: boolean }) {
  const [reduced, setReduced] = useState(false);
  const [local, setLocal] = useState(INITIAL_LOCAL);
  const [domain, setDomain] = useState(DOMAINS[0]);
  const [seconds, setSeconds] = useState(START_SECONDS);
  const [arrived, setArrived] = useState(DEMO_EMAILS.length);
  const [phase, setPhase] = useState<Phase>("live");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (reduced || staticPreview) {
      setLocal(INITIAL_LOCAL);
      setDomain(DOMAINS[0]);
      setSeconds(START_SECONDS);
      setArrived(DEMO_EMAILS.length);
      setPhase("live");
      return;
    }

    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let countdown: ReturnType<typeof setInterval> | undefined;
    let burndown: ReturnType<typeof setInterval> | undefined;

    const at = (delay: number, fn: () => void) => {
      timeouts.push(setTimeout(() => { if (!cancelled) fn(); }, delay));
    };

    const startCountdown = () => {
      countdown = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    };

    const burn = () => {
      if (countdown) clearInterval(countdown);
      setPhase("burning");
      burndown = setInterval(() => setSeconds((s) => Math.max(0, s - 41)), 55);
      at(1300, () => {
        if (burndown) clearInterval(burndown);
        setSeconds(0);
        setPhase("expired");
        at(1700, () => runCycle(false));
      });
    };

    const runCycle = (first: boolean) => {
      if (cancelled) return;
      setLocal(first ? INITIAL_LOCAL : randomLocal());
      setDomain(first ? DOMAINS[0] : DOMAINS[Math.floor(Math.random() * DOMAINS.length)]);
      setSeconds(START_SECONDS);
      setPhase("live");
      startCountdown();

      if (first) {
        // First paint mirrors the server render: a full, resting inbox.
        setArrived(DEMO_EMAILS.length);
        at(3600, burn);
      } else {
        // Later cycles show mail arriving one message at a time.
        setArrived(1);
        for (let i = 1; i < DEMO_EMAILS.length; i++) {
          at(700 + (i - 1) * 1200, () => setArrived(i + 1));
        }
        at(700 + (DEMO_EMAILS.length - 1) * 1200 + 1400, burn);
      }
    };

    runCycle(true);

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
      if (countdown) clearInterval(countdown);
      if (burndown) clearInterval(burndown);
    };
  }, [reduced, staticPreview]);

  const expired = phase === "expired";
  const dimmed = phase === "expired" || phase === "burning";
  const visible = DEMO_EMAILS.slice(0, arrived);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-opacity duration-300",
        expired && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {labels.inboxLabel}
          </span>
          <span className={cn("truncate font-mono text-sm font-semibold", expired && "text-muted-foreground line-through")}>
            {local}
            <span className="text-muted-foreground">@</span>
            <span className="text-primary">{domain}</span>
          </span>
        </div>
        {dimmed ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive">
            <CircleSlash className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{labels.expired}</span>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span className="hidden font-medium sm:inline">{labels.expiresIn}</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">{mmss(seconds)}</span>
          </span>
        )}
      </div>

      <ul className="min-h-56 divide-y">
        {visible.map((email, i) => (
          <li
            key={`${local}-${i}`}
            style={{ animationDelay: `${i * 70}ms` }}
            className={cn(
              "flex items-center gap-3 px-4 py-3 duration-300 animate-in fade-in slide-in-from-top-1",
              dimmed && "opacity-40 transition-opacity duration-500",
              expired && "line-through",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold text-muted-foreground">
              {email.from.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{email.from}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{email.time}</span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{email.subject}</p>
            </div>
            {i === 0 && !dimmed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
