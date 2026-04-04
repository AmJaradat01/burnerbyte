"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useInboxSocket } from "@/hooks/use-inbox-socket";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmailList } from "@/components/inbox/email-list";
import { EmailPreview } from "@/components/inbox/email-preview";
import { InboxEmptyPreview } from "@/components/inbox/inbox-empty-preview";
import {
  ArrowLeft, Check, Clock, Copy, Mail, MailOpen, CheckCheck, Timer, Trash2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailSummary, Email, Inbox, PaginatedResponse } from "@/types";

/* ── Countdown ── */

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
    <span className={`font-mono text-xs ${urgent ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
      {remaining}
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
    queryKey: ["emails", id, search, page],
    queryFn: () => {
      const params: Record<string, string> = { page: String(page), per_page: "30" };
      if (search) params.q = search;
      return api.get<PaginatedResponse<EmailSummary>>(`/inboxes/${id}/emails`, params);
    },
  });

  const { data: selectedEmail } = useQuery({
    queryKey: ["email", selectedEmailId],
    queryFn: () => api.get<Email>(`/emails/${selectedEmailId}`),
    enabled: !!selectedEmailId,
  });

  useEffect(() => {
    if (selectedEmail && !selectedEmail.is_read) {
      api.patch(`/emails/${selectedEmail.id}`, { is_read: true }).then(() => {
        qc.invalidateQueries({ queryKey: ["emails", id] });
        qc.invalidateQueries({ queryKey: ["email", selectedEmailId] });
      }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmail?.id, selectedEmail?.is_read]);

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
    onSuccess: () => { toast.success("Inbox deleted"); router.push("/"); },
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
    toast.info("📬 New email received!");
  }, [qc, id]);

  useInboxSocket(id, onNewEmail);

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
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="sm" className="shrink-0 h-8 w-8 p-0" onClick={() => router.push("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {address ? (
                  <>
                    <h1 className="font-mono text-sm font-semibold truncate">{address}</h1>
                    <button onClick={copyAddress} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                    {inbox && (
                      <Badge variant={inbox.is_active ? "default" : "secondary"} className="shrink-0 text-[10px] px-1.5 py-0">
                        {inbox.is_active ? "Active" : "Expired"}
                      </Badge>
                    )}
                  </>
                ) : (
                  <>
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-32" />
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {totalEmails} emails</span>
                {inbox?.is_active && inbox?.expires_at && (
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> <Countdown expiresAt={inbox.expires_at} /></span>
                )}
              </div>
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
                <Timer className="h-3.5 w-3.5" /> Renew
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
