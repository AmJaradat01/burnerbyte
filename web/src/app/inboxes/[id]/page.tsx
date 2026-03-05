"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useInboxSocket } from "@/hooks/use-inbox-socket";
import { timeAgo } from "@/lib/time";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { Pagination } from "@/components/pagination";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  ArrowLeft, Check, Clock, Copy, Download, Eye, EyeOff,
  Mail, MailOpen, Paperclip, RefreshCw, Search,
  Timer, Trash2,
} from "lucide-react";
import type { EmailSummary, Email, Inbox, Attachment, PaginatedResponse } from "@/types";

/* ── Countdown ── */

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState("");
  const [urgent, setUrgent] = useState(false);
  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Expired"); setUrgent(true); return; }
      setUrgent(diff < 600000); // < 10 min
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

  // Redirect if expired or not found
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

  // Auto-mark as read
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emails", id] }),
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

  const onNewEmail = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["emails", id] });
    qc.invalidateQueries({ queryKey: ["inbox", id] });
    toast.info("📬 New email received!");
  }, [qc, id]);

  useInboxSocket(id, onNewEmail);

  const copyAddress = () => {
    if (!inbox) return;
    copyToClipboard(inbox.full_address || inbox.address);
    setCopied(true);
    toast.success("Copied!");
    setTimeout(() => setCopied(false), 1500);
  };

  if (inboxError) return null; // redirecting via useEffect

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
                <h1 className="font-mono text-sm font-semibold truncate">{address || "Loading…"}</h1>
                <button onClick={copyAddress} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                {inbox && (
                  <Badge variant={inbox.is_active ? "default" : "secondary"} className="shrink-0 text-[10px] px-1.5 py-0">
                    {inbox.is_active ? "Active" : "Expired"}
                  </Badge>
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
        <div className={`w-full md:w-80 lg:w-96 shrink-0 border-r flex flex-col ${selectedEmailId ? "hidden md:flex" : "flex"}`}>
          {/* Search */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search emails…"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {emailsError ? (
              <div className="p-4"><ErrorState message="Failed to load" onRetry={() => refetchEmails()} /></div>
            ) : emailsLoading ? (
              <EmailListSkeleton />
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-6">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Mail className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">No emails yet</p>
                <p className="text-xs text-muted-foreground mt-1">Waiting for incoming mail…</p>
                <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Listening for new emails
                </div>
              </div>
            ) : (
              <>
                {emails.map((e) => (
                  <EmailRow
                    key={e.id}
                    email={e}
                    selected={selectedEmailId === e.id}
                    onClick={() => setSelectedEmailId(e.id)}
                  />
                ))}
                {(emailsData?.total_pages ?? 1) > 1 && (
                  <div className="p-2 border-t">
                    <Pagination page={page} totalPages={emailsData?.total_pages ?? 1} onPageChange={setPage} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Email preview ── */}
        <div className={`flex-1 flex flex-col min-w-0 ${selectedEmailId ? "flex" : "hidden md:flex"}`}>
          {selectedEmail ? (
            <>
              {/* Preview header */}
              <div className="shrink-0 border-b px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Mobile back */}
                    <button onClick={() => setSelectedEmailId(null)} className="md:hidden flex items-center gap-1 text-xs text-muted-foreground mb-2 hover:text-foreground">
                      <ArrowLeft className="h-3 w-3" /> Back to list
                    </button>
                    <h2 className="font-semibold truncate">{selectedEmail.subject || "(no subject)"}</h2>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-semibold text-primary">
                          {selectedEmail.from_address.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{selectedEmail.from_address}</p>
                        <p className="text-xs text-muted-foreground">to {selectedEmail.to_address}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground mr-1">{timeAgo(selectedEmail.received_at)}</span>
                    <Button
                      variant="ghost" size="sm" className="h-7 w-7 p-0"
                      title={selectedEmail.is_read ? "Mark unread" : "Mark read"}
                      onClick={() => toggleRead.mutate({ emailId: selectedEmail.id, is_read: !selectedEmail.is_read })}
                    >
                      {selectedEmail.is_read ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      }
                      title="Delete email?"
                      description="This email and its attachments will be permanently deleted."
                      onConfirm={() => deleteEmail.mutate(selectedEmail.id)}
                    />
                  </div>
                </div>

                {/* Attachments */}
                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {selectedEmail.attachments.map((att) => (
                      <AttachmentChip key={att.id} attachment={att} emailId={selectedEmail.id} />
                    ))}
                  </div>
                )}
              </div>

              {/* Email body */}
              <div className="flex-1 overflow-y-auto p-4">
                {selectedEmail.body_html ? (
                  <iframe
                    srcDoc={selectedEmail.body_html}
                    title="Email content"
                    className="w-full h-full min-h-[400px] border-0 rounded"
                    sandbox=""
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{selectedEmail.body_text || "(empty)"}</pre>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <MailOpen className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="font-medium">Select an email to read</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {totalEmails > 0 ? `${totalEmails} emails in this inbox` : "Waiting for incoming emails…"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Email row ── */

function EmailRow({ email, selected, onClick }: { email: EmailSummary; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b transition-colors hover:bg-muted/50 ${
        selected ? "bg-primary/5 border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* Unread dot */}
        <div className="pt-1.5 shrink-0 w-2">
          {!email.is_read && <span className="block h-2 w-2 rounded-full bg-primary" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm truncate ${!email.is_read ? "font-semibold" : "text-muted-foreground"}`}>
              {email.from_address}
            </p>
            <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(email.received_at)}</span>
          </div>
          <p className={`text-sm truncate mt-0.5 ${!email.is_read ? "font-medium" : "text-muted-foreground"}`}>
            {email.subject || "(no subject)"}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {email.has_attachments && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Paperclip className="h-3 w-3" />
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {email.size_bytes < 1024 ? `${email.size_bytes}B` : `${Math.round(email.size_bytes / 1024)}KB`}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

/* ── Attachment chip ── */

function AttachmentChip({ attachment, emailId }: { attachment: Attachment; emailId: string }) {
  const download = async () => {
    try {
      const res = await api.get<{ url: string }>(`/emails/${emailId}/attachments/${attachment.id}`);
      window.open(res.url, "_blank");
    } catch {
      toast.error("Failed to download");
    }
  };

  const sizeKB = Math.round(attachment.size_bytes / 1024);
  const icon = attachment.content_type?.startsWith("image/") ? "🖼️" : "📄";

  return (
    <button
      onClick={download}
      className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-xs hover:bg-muted transition-colors group"
    >
      <span>{icon}</span>
      <span className="truncate max-w-[140px]">{attachment.filename}</span>
      <span className="text-muted-foreground">({sizeKB > 0 ? `${sizeKB}KB` : `${attachment.size_bytes}B`})</span>
      <Download className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-colors" />
    </button>
  );
}

/* ── Skeleton ── */

function EmailListSkeleton() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="px-3 py-2.5 border-b">
          <div className="flex items-start gap-2.5">
            <div className="w-2" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
