"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useInboxSocket, type SocketStatus } from "@/hooks/use-inbox-socket";
import { useDebounce } from "@/hooks/use-debounce";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmailList } from "@/components/inbox/email-list";
import { EmailPreview } from "@/components/inbox/email-preview";
import { InboxEmptyPreview } from "@/components/inbox/inbox-empty-preview";
import {
  ArrowLeft, Check, CheckCircle2, Copy, Mail, MailOpen, CheckCheck, Timer, Trash2, Wifi, WifiOff, XCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailSummary, Email, Inbox, PaginatedResponse } from "@/types";

/* ── Countdown ──
   Renders the time remaining as monospace text. Color promotes to destructive
   when the inbox is within 10 minutes of expiry; otherwise stays muted. No
   surrounding pill: visual intensity is rationed (Quiet Accent Rule). */

/** Formats a Go-duration string for display: "1h0m0s" → "1h", "15m0s" → "15m" */
function formatTtlLabel(ttl: string): string {
  const h = ttl.match(/(\d+)h/);
  const m = ttl.match(/(\d+)m/);
  const hours = h ? parseInt(h[1]) : 0;
  const mins = m ? parseInt(m[1]) : 0;
  if (hours > 0 && mins > 0) return `${hours}h${mins}m`;
  if (hours > 0) return `${hours}h`;
  if (mins > 0) return `${mins}m`;
  return ttl;
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Expired"); setUrgent(true); return; }
      setUrgent(diff < 600000);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [expiresAt]);
  return (
    <span
      className={`font-mono text-xs tabular-nums ${urgent ? "text-destructive font-semibold" : "text-muted-foreground"}`}
      aria-label={urgent ? `Inbox expires in ${remaining}` : `Time remaining: ${remaining}`}
    >
      {remaining}
    </span>
  );
}

/* ── WebSocket status indicator ── */

function SocketIndicator({ status }: { status: SocketStatus }) {
  if (status === "connected") {
    return (
      <span
        className="flex items-center gap-1 text-xs text-success"
        title="Live, listening for new emails"
        role="status"
        aria-label="Connected, listening for new emails"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
        <Wifi className="h-3 w-3" aria-hidden="true" />
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span
        className="flex items-center gap-1 text-xs text-muted-foreground"
        title="Connecting"
        role="status"
        aria-label="Connecting to live updates"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
        <Wifi className="h-3 w-3 opacity-60" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 text-xs text-muted-foreground"
      title="Disconnected, reconnecting"
      role="status"
      aria-label="Disconnected from live updates, reconnecting"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
      <WifiOff className="h-3 w-3 opacity-60" aria-hidden="true" />
    </span>
  );
}

/* ── Main page ── */

export default function InboxDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);

  const { data: inbox, isError: inboxError } = useQuery({
    queryKey: ["inbox", id],
    queryFn: () => api.get<Inbox>(`/inboxes/${id}`),
  });

  useEffect(() => {
    if (inbox && !inbox.is_active) {
      toast.error("This inbox has expired");
      router.replace("/");
    }
  }, [inbox, router]);

  useEffect(() => {
    if (inboxError) {
      toast.error("This inbox has expired or was deleted");
      router.replace("/");
    }
  }, [inboxError, router]);

  const { data: emailsData, isLoading: emailsLoading, isError: emailsError, refetch: refetchEmails } = useQuery({
    queryKey: ["emails", id, debouncedSearch, page],
    queryFn: () => {
      const params: Record<string, string> = { page: String(page), per_page: "30" };
      if (debouncedSearch) params.q = debouncedSearch;
      return api.get<PaginatedResponse<EmailSummary>>(`/inboxes/${id}/emails`, params);
    },
  });

  const { data: selectedEmail } = useQuery({
    queryKey: ["email", selectedEmailId],
    queryFn: () => api.get<Email>(`/emails/${selectedEmailId}`),
    enabled: !!selectedEmailId,
  });

  const extend = useMutation({
    mutationFn: () => api.post(`/inboxes/${id}/extend`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inbox", id] }); toast.success("Inbox renewed"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const toggleRead = useMutation({
    mutationFn: ({ emailId, is_read }: { emailId: string; is_read: boolean }) =>
      api.patch(`/emails/${emailId}`, { is_read }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["emails", id] });
      qc.invalidateQueries({ queryKey: ["email", selectedEmailId] });
    },
  });

  const deleteEmail = useMutation({
    mutationFn: (emailId: string) => api.del(`/emails/${emailId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["emails", id] });
      setSelectedEmailId(null);
      toast.success("Email deleted");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const deleteInbox = useMutation({
    mutationFn: () => api.del(`/inboxes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); toast.success("Inbox deleted"); router.push("/"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post<{ marked: number }>(`/inboxes/${id}/emails/mark-all-read`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["emails", id] });
      qc.invalidateQueries({ queryKey: ["inbox", id] });
      if (selectedEmailId) qc.invalidateQueries({ queryKey: ["email", selectedEmailId] });
      toast.success(`Marked ${data.marked} email${data.marked !== 1 ? "s" : ""} as read`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const onNewEmail = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["emails", id] });
    qc.invalidateQueries({ queryKey: ["inbox", id] });
    toast.success("New email received");
  }, [qc, id]);

  const socketStatus = useInboxSocket(id, onNewEmail);

  /* Keyboard navigation */
  useEffect(() => {
    const emails = emailsData?.data ?? [];
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const idx = emails.findIndex((em) => em.id === selectedEmailId);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = idx < emails.length - 1 ? idx + 1 : 0;
        setSelectedEmailId(emails[next]?.id ?? null);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = idx > 0 ? idx - 1 : emails.length - 1;
        setSelectedEmailId(emails[prev]?.id ?? null);
      } else if (e.key === "Escape") {
        setSelectedEmailId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [emailsData?.data, selectedEmailId]);

  const copyAddress = () => {
    if (!inbox) return;
    copyToClipboard(inbox.full_address || inbox.address);
    setCopied(true);
    toast.success("Copied!");
    setTimeout(() => setCopied(false), 1500);
  };

  if (inboxError) return null;

  const address = inbox?.full_address || inbox?.address || "";
  const emails = emailsData?.data ?? [];
  const totalEmails = emailsData?.total ?? 0;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* ── Top bar ── */}
      <div className="shrink-0 bg-background px-4 py-3 border-b">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="outline" size="sm" className="shrink-0 h-8 w-8 p-0" onClick={() => router.push("/")} aria-label="Back to inboxes">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              {address ? (
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0" aria-hidden="true">
                    <Mail className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h1 className="font-mono text-base font-bold truncate tracking-tight">{address}</h1>
                      <button
                        onClick={copyAddress}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors duration-150 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        aria-label={copied ? "Address copied" : "Copy address"}
                        title={copied ? "Copied" : "Copy address"}
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                        <MailOpen className="h-3 w-3" aria-hidden="true" />
                        {totalEmails} {totalEmails === 1 ? "email" : "emails"}
                      </span>
                      {inbox?.is_active && inbox?.expires_at && (
                        <Countdown expiresAt={inbox.expires_at} />
                      )}
                      <Badge variant={inbox?.is_active ? "secondary" : "outline"} className="gap-1 text-[10px] px-1.5 py-0">
                        {inbox?.is_active ? <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" /> : <XCircle className="h-2.5 w-2.5" aria-hidden="true" />}
                        {inbox?.is_active ? "Active" : "Expired"}
                      </Badge>
                      <SocketIndicator status={socketStatus} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {totalEmails > 0 && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
                <CheckCheck className="h-3.5 w-3.5" /> Read all
              </Button>
            )}
            {inbox?.is_active && (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => extend.mutate()}>
                <Timer className="h-3.5 w-3.5" /> Renew{inbox.original_ttl ? ` (${formatTtlLabel(inbox.original_ttl)})` : ""}
              </Button>
            )}
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              }
              title="Delete inbox?"
              description={`Permanently delete ${address} and all its emails.`}
              onConfirm={() => deleteInbox.mutate()}
            />
          </div>
        </div>
      </div>

      {/* ── Split pane ── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Email list ── */}
        <div className={`w-full md:w-[340px] lg:w-[400px] shrink-0 border-r flex flex-col bg-muted/20 ${selectedEmailId ? "hidden md:flex" : "flex"}`}>
          <EmailList
            emails={emails}
            totalEmails={totalEmails}
            totalPages={emailsData?.total_pages ?? 1}
            page={page}
            search={search}
            selectedEmailId={selectedEmailId}
            isLoading={emailsLoading}
            isError={emailsError}
            onSearchChange={(v) => { setSearch(v); setPage(1); }}
            onPageChange={setPage}
            onSelect={setSelectedEmailId}
            onRetry={() => refetchEmails()}
          />
        </div>

        {/* ── Email preview ── */}
        <div className={`flex-1 flex flex-col min-w-0 ${selectedEmailId ? "flex" : "hidden md:flex"}`}>
          {selectedEmail ? (
            <EmailPreview
              email={selectedEmail}
              onBack={() => setSelectedEmailId(null)}
              onToggleRead={() => toggleRead.mutate({ emailId: selectedEmail.id, is_read: !selectedEmail.is_read })}
              onDelete={() => deleteEmail.mutate(selectedEmail.id)}
            />
          ) : (
            <InboxEmptyPreview totalEmails={totalEmails} />
          )}
        </div>
      </div>
    </div>
  );
}
