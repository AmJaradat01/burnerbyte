"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useInboxSocket } from "@/hooks/use-inbox-socket";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { TableSkeleton } from "@/components/table-skeleton";
import { ErrorState } from "@/components/error-state";
import { Pagination } from "@/components/pagination";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { EmailSummary, Email, Inbox, Attachment, PaginatedResponse } from "@/types";

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Expired"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  return <span className="font-mono text-sm">{remaining}</span>;
}

function CopyButton({ text }: { text: string }) {
  const copy = () => { navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); };
  return <Button variant="outline" size="sm" onClick={copy}>📋 Copy</Button>;
}

export default function InboxDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data: inbox, isLoading: inboxLoading, isError: inboxError, refetch: refetchInbox } = useQuery({
    queryKey: ["inbox", id],
    queryFn: () => api.get<Inbox>(`/inboxes/${id}`),
  });

  const { data: emailsData, isLoading: emailsLoading, isError: emailsError, refetch: refetchEmails } = useQuery({
    queryKey: ["emails", id, search, page],
    queryFn: () => {
      const params: Record<string, string> = { page: String(page), per_page: "20" };
      if (search) params.q = search;
      return api.get<PaginatedResponse<EmailSummary>>(`/inboxes/${id}/emails`, params);
    },
  });

  const { data: selectedEmail } = useQuery({
    queryKey: ["email", selectedEmailId],
    queryFn: () => api.get<Email>(`/emails/${selectedEmailId}`),
    enabled: !!selectedEmailId,
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

  const onNewEmail = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["emails", id] });
    toast.info("New email received");
  }, [qc, id]);

  useInboxSocket(id, onNewEmail);

  if (inboxError) return <ErrorState message="Failed to load inbox" onRetry={() => refetchInbox()} />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/inboxes" className="text-sm text-muted-foreground hover:underline">← Inboxes</Link>
          <h1 className="text-xl font-bold truncate">{inbox?.full_address || inbox?.address || "Loading…"}</h1>
          {inbox && <Badge variant={inbox.is_active ? "default" : "secondary"}>{inbox.is_active ? "Active" : "Expired"}</Badge>}
        </div>
        <div className="flex items-center gap-3">
          {inbox?.full_address && <CopyButton text={inbox.full_address} />}
          {inbox?.is_active && inbox?.expires_at && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="text-xs">Expires in</span>
              <Countdown expiresAt={inbox.expires_at} />
            </div>
          )}
        </div>
      </div>

      <Input placeholder="Search emails by subject or sender…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-sm" />

      {/* Split pane — stacked on mobile */}
      <div className="flex flex-col md:grid md:grid-cols-3 gap-4" style={{ minHeight: "60vh" }}>
        {/* Email list */}
        <Card className="md:col-span-1 overflow-auto max-h-[70vh]">
          <CardContent className="p-0">
            {emailsError ? <ErrorState message="Failed to load emails" onRetry={() => refetchEmails()} /> :
            emailsLoading ? <TableSkeleton rows={5} cols={1} /> : (
            <>
              {emailsData?.data?.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEmailId(e.id)}
                  className={`w-full text-left px-4 py-3 border-b transition-colors hover:bg-muted ${selectedEmailId === e.id ? "bg-muted" : ""} ${!e.is_read ? "font-semibold" : ""}`}
                >
                  <p className="text-sm truncate">{e.from_address}</p>
                  <p className="text-sm truncate">{e.subject || "(no subject)"}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">{new Date(e.received_at).toLocaleString()}</span>
                    {e.has_attachments && <Badge variant="outline" className="text-xs">📎</Badge>}
                    {!e.is_read && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                </button>
              ))}
              {(!emailsData?.data || emailsData.data.length === 0) && (
                <p className="p-4 text-center text-sm text-muted-foreground">No emails yet — waiting for incoming mail…</p>
              )}
              <Pagination page={page} totalPages={emailsData?.total_pages ?? 1} onPageChange={setPage} />
            </>
            )}
          </CardContent>
        </Card>

        {/* Email preview */}
        <Card className="md:col-span-2 overflow-auto max-h-[70vh]">
          {selectedEmail ? (
            <>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-lg">{selectedEmail.subject || "(no subject)"}</CardTitle>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => toggleRead.mutate({ emailId: selectedEmail.id, is_read: !selectedEmail.is_read })}>
                      Mark {selectedEmail.is_read ? "unread" : "read"}
                    </Button>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm">Delete</Button>}
                      title="Delete email?"
                      description="This email and its attachments will be permanently deleted."
                      onConfirm={() => deleteEmail.mutate(selectedEmail.id)}
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">From: {selectedEmail.from_address}</p>
                <p className="text-sm text-muted-foreground">To: {selectedEmail.to_address}</p>
                <p className="text-xs text-muted-foreground">{new Date(selectedEmail.received_at).toLocaleString()}</p>
                {/* Attachments */}
                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {selectedEmail.attachments.map((att) => (
                      <AttachmentChip key={att.id} attachment={att} emailId={selectedEmail.id} />
                    ))}
                  </div>
                )}
              </CardHeader>
              <Separator />
              <CardContent className="pt-4">
                {selectedEmail.body_html ? (
                  <iframe
                    srcDoc={selectedEmail.body_html}
                    title="Email content"
                    className="w-full min-h-[400px] border-0"
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm">{selectedEmail.body_text}</pre>
                )}
              </CardContent>
            </>
          ) : (
            <CardContent className="flex items-center justify-center h-full min-h-[300px]">
              <div className="text-center">
                <span className="text-4xl">📧</span>
                <p className="text-muted-foreground mt-2">Select an email to read</p>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function AttachmentChip({ attachment, emailId }: { attachment: Attachment; emailId: string }) {
  const download = async () => {
    try {
      const res = await api.get<{ url: string }>(`/emails/${emailId}/attachments/${attachment.id}`);
      window.open(res.url, "_blank");
    } catch {
      toast.error("Failed to download attachment");
    }
  };

  const sizeKB = Math.round(attachment.size_bytes / 1024);
  return (
    <button
      onClick={download}
      className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted transition-colors"
    >
      <span>📎</span>
      <span className="truncate max-w-[120px]">{attachment.filename}</span>
      <span className="text-muted-foreground">({sizeKB}KB)</span>
    </button>
  );
}
