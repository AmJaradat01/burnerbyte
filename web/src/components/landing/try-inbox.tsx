"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleSlash, Clock, Copy, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { timeAgo } from "@/lib/time";
import { tryCreateInbox, tryGetEmails, type TryEmail, type TryInboxInfo } from "@/lib/api";
import { LiveInboxDemo, type LiveInboxDemoLabels } from "./live-inbox-demo";

export interface TryInboxLabels extends LiveInboxDemoLabels {
  /** Caption shown under the simulated fallback. */
  caption: string;
  /** Caption shown under the real, live inbox. */
  liveCaption: string;
  emptyHint: string;
  copy: string;
  copied: string;
  newInbox: string;
}

const POLL_MS = 4000;

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function senderInitial(addr: string): string {
  return (addr.trim()[0] || "?").toUpperCase();
}

// "Display Name <a@b.com>" -> "Display Name"; "a@b.com" -> "a".
function senderName(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  return addr.split("@")[0] || addr;
}

type Status = "init" | "live" | "expired" | "unavailable";

/**
 * The hero's "try it" inbox. Creates a real, short-lived disposable inbox via
 * the public demo endpoint and polls it for incoming mail. When demo mode is
 * disabled or unreachable it falls back to the self-contained simulated demo,
 * so the hero is never empty.
 */
export function TryInbox({ labels }: { labels: TryInboxLabels }) {
  const [status, setStatus] = useState<Status>("init");
  const [inbox, setInbox] = useState<TryInboxInfo | null>(null);
  const [emails, setEmails] = useState<TryEmail[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);

  // Create the demo inbox on mount. The work is inline (await before any
  // setState) so it satisfies the no-synchronous-setState-in-effect rule.
  useEffect(() => {
    mounted.current = true;
    let active = true;
    (async () => {
      const info = await tryCreateInbox();
      if (!active || !mounted.current) return;
      if (info) {
        setInbox(info);
        setStatus("live");
      } else {
        setStatus("unavailable");
      }
    })();
    return () => {
      mounted.current = false;
      active = false;
    };
  }, []);

  // "New inbox" button — an event handler, so the synchronous reset is fine.
  const regenerate = () => {
    setStatus("init");
    setEmails([]);
    (async () => {
      const info = await tryCreateInbox();
      if (!mounted.current) return;
      if (info) {
        setInbox(info);
        setStatus("live");
      } else {
        setStatus("unavailable");
      }
    })();
  };

  // Countdown to expiry.
  useEffect(() => {
    if (status !== "live" || !inbox) return;
    const expiry = new Date(inbox.expires_at).getTime();
    const tick = () => {
      const left = Math.max(0, Math.round((expiry - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) setStatus("expired");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, inbox]);

  // Poll for incoming mail while live.
  useEffect(() => {
    if (status !== "live" || !inbox) return;
    let active = true;
    const poll = async () => {
      const list = await tryGetEmails(inbox.inbox_id);
      if (active && mounted.current && list) setEmails(list);
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [status, inbox]);

  const onCopy = () => {
    if (!inbox) return;
    copyToClipboard(inbox.address);
    setCopied(true);
    setTimeout(() => {
      if (mounted.current) setCopied(false);
    }, 1500);
  };

  // While creating or when unavailable, show the simulated demo.
  if (status === "init" || status === "unavailable") {
    return (
      <>
        <LiveInboxDemo labels={labels} />
        <Caption text={labels.caption} />
      </>
    );
  }

  const expired = status === "expired";

  return (
    <>
      <div
        className={cn(
          "w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs transition-opacity",
          expired && "opacity-70",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {labels.inboxLabel}
            </span>
            <span className={cn("truncate font-mono text-sm font-semibold", expired && "text-muted-foreground line-through")}>
              {inbox?.address}
            </span>
          </div>
          {expired ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-destructive">
              <CircleSlash className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{labels.expired}</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={onCopy}
              aria-label={labels.copy}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{copied ? labels.copied : labels.copy}</span>
            </button>
          )}
        </div>

        {!expired && (
          <div className="flex items-center gap-1.5 border-b px-4 py-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-medium">{labels.expiresIn}</span>
            <span className="font-mono font-semibold tabular-nums text-foreground">{mmss(remaining)}</span>
          </div>
        )}

        <ul className="min-h-56 divide-y">
          {emails.length === 0 ? (
            <li className="flex min-h-56 items-center justify-center px-6 py-10 text-center text-xs leading-relaxed text-muted-foreground">
              {expired ? labels.expired : labels.emptyHint}
            </li>
          ) : (
            emails.map((email) => (
              <li
                key={email.id}
                className={cn("flex items-center gap-3 px-4 py-3", expired && "opacity-40 line-through")}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold text-muted-foreground">
                  {senderInitial(email.from_address)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{senderName(email.from_address)}</span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {timeAgo(email.received_at)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {email.subject || email.snippet || "(no subject)"}
                  </p>
                </div>
              </li>
            ))
          )}
        </ul>

        {expired && (
          <div className="border-t px-4 py-3">
            <button
              type="button"
              onClick={regenerate}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {labels.newInbox}
            </button>
          </div>
        )}
      </div>
      <Caption text={expired ? labels.expired : labels.liveCaption} live={!expired} />
    </>
  );
}

function Caption({ text, live }: { text: string; live?: boolean }) {
  return (
    <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
      <span
        className={cn("inline-block h-1.5 w-1.5 rounded-full", live ? "bg-success" : "bg-muted-foreground")}
        aria-hidden="true"
      />
      {text}
    </p>
  );
}
