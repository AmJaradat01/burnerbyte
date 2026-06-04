"use client";

import { useMemo } from "react";
import { timeAgo } from "@/lib/time";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { Pagination } from "@/components/pagination";
import { Mail, Paperclip, RefreshCw, Search } from "lucide-react";
import type { EmailSummary } from "@/types";

/* ── Deterministic avatar color from email address ── */

const AVATAR_COLORS = [
  "bg-muted text-muted-foreground",
];

function avatarColor(email: string) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function senderName(email: string) {
  const local = email.split("@")[0] || "";
  return local.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Date grouping ── */

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const emailDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (emailDate.getTime() === today.getTime()) return "Today";
  if (emailDate.getTime() === yesterday.getTime()) return "Yesterday";
  if (now.getTime() - emailDate.getTime() < 7 * 86400000) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: now.getFullYear() !== d.getFullYear() ? "numeric" : undefined });
}

interface EmailGroup {
  label: string;
  emails: EmailSummary[];
}

function groupByDate(emails: EmailSummary[]): EmailGroup[] {
  const groups: EmailGroup[] = [];
  let currentLabel = "";
  for (const e of emails) {
    const label = dateLabel(e.received_at);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, emails: [] });
    }
    groups[groups.length - 1].emails.push(e);
  }
  return groups;
}

/* ── Props ── */

interface EmailListProps {
  emails: EmailSummary[];
  totalEmails: number;
  totalPages: number;
  page: number;
  search: string;
  selectedEmailId: string | null;
  isLoading: boolean;
  isError: boolean;
  onSearchChange: (v: string) => void;
  onPageChange: (p: number) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
}

export function EmailList({
  emails, totalEmails, totalPages, page, search, selectedEmailId,
  isLoading, isError, onSearchChange, onPageChange, onSelect, onRetry,
}: EmailListProps) {
  const groups = useMemo(() => groupByDate(emails), [emails]);

  return (
    <>
      {/* Search */}
      <div className="p-2.5 border-b bg-background">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search emails…"
            className="h-8 pl-8 text-sm bg-muted/50"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isError ? (
          <div className="p-4"><ErrorState message="Failed to load" onRetry={onRetry} /></div>
        ) : isLoading ? (
          <EmailListSkeleton />
        ) : emails.length === 0 ? (
          <EmptyList hasSearch={!!search} />
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm px-3 py-1.5 border-b">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
                {group.emails.map((e) => (
                  <EmailRow
                    key={e.id}
                    email={e}
                    selected={selectedEmailId === e.id}
                    onClick={() => onSelect(e.id)}
                  />
                ))}
              </div>
            ))}
            {totalPages > 1 && (
              <div className="p-2 border-t bg-background">
                <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer count */}
      {totalEmails > 0 && (
        <div className="shrink-0 border-t bg-background px-3 py-1.5">
          <span className="text-[11px] text-muted-foreground">{totalEmails} email{totalEmails !== 1 ? "s" : ""}</span>
        </div>
      )}
    </>
  );
}

/* ── Email row ── */

function EmailRow({ email, selected, onClick }: { email: EmailSummary; selected: boolean; onClick: () => void }) {
  const color = avatarColor(email.from_address);
  const initial = email.from_address.charAt(0).toUpperCase();
  const name = senderName(email.from_address);
  const unread = !email.is_read;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b transition-all group
        ${selected
          ? "bg-primary/[0.08]"
          : unread
            ? "bg-background hover:bg-muted/60"
            : "hover:bg-muted/40"
        }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold mt-0.5 ${color}`}>
          {initial}
        </div>

        <div className="min-w-0 flex-1">
          {/* Row 1: sender + time */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {unread && (
                <>
                  <span className="shrink-0 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                  <span className="sr-only">Unread</span>
                </>
              )}
              <p className={`text-sm truncate ${unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                {name}
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{timeAgo(email.received_at)}</span>
          </div>

          {/* Row 2: subject */}
          <p className={`text-[13px] truncate mt-0.5 ${unread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
            {email.subject || "(no subject)"}
          </p>

          {/* Row 3: snippet + meta */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <p className="text-xs text-muted-foreground/70 truncate flex-1">
              {email.snippet || "\u00A0"}
            </p>
            {email.has_attachments && (
              <Paperclip className="shrink-0 h-3 w-3 text-muted-foreground/60" />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

/* ── Empty state ── */

function EmptyList({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6">
      <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-3">
        <Mail className="h-7 w-7 text-muted-foreground" />
      </div>
      {hasSearch ? (
        <>
          <p className="text-sm font-medium">No results</p>
          <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">No emails yet</p>
          <p className="text-xs text-muted-foreground mt-1">Waiting for incoming mail…</p>
          <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 motion-safe:animate-spin" />
            Listening for new emails
          </div>
        </>
      )}
    </div>
  );
}

/* ── Skeleton ── */

function EmailListSkeleton() {
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-3 py-2.5 border-b">
          <div className="flex items-start gap-2.5">
            <Skeleton className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="flex justify-between">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
