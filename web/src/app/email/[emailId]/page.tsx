"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Email, Attachment } from "@/types";

function SpamBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const level = score < 2 ? "low" : score < 5 ? "medium" : "high";
  const colors = { low: "bg-green-100 text-green-800", medium: "bg-yellow-100 text-yellow-800", high: "bg-red-100 text-red-800" };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[level]}`}>Spam: {level} ({score.toFixed(1)})</span>;
}

export default function EmailDetailPage() {
  const { emailId } = useParams<{ emailId: string }>();
  const qc = useQueryClient();

  const { data: email, isLoading, isError, refetch } = useQuery({
    queryKey: ["email", emailId],
    queryFn: () => api.get<Email & { spam_score?: number; raw_headers?: string }>(`/emails/${emailId}`),
  });

  const toggleRead = useMutation({
    mutationFn: (is_read: boolean) => api.patch(`/emails/${emailId}`, { is_read }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["email", emailId] }); toast.success("Updated"); },
  });

  const deleteEmail = useMutation({
    mutationFn: () => api.del(`/emails/${emailId}`),
    onSuccess: () => { toast.success("Email deleted"); window.history.back(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  if (isLoading) return <div className="max-w-3xl space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (isError) return <ErrorState message="Failed to load email" onRetry={() => refetch()} />;
  if (!email) return <p className="text-muted-foreground">Email not found.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <Link href={`/inboxes/${email.inbox_id}`} className="text-sm text-muted-foreground hover:underline">← Back to Inbox</Link>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-xl">{email.subject || "(no subject)"}</CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => toggleRead.mutate(!email.is_read)}>
                Mark {email.is_read ? "unread" : "read"}
              </Button>
              <ConfirmDialog
                trigger={<Button variant="destructive" size="sm">Delete</Button>}
                title="Delete email?"
                description="This email and its attachments will be permanently deleted."
                onConfirm={() => deleteEmail.mutate()}
              />
            </div>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>From: {email.from_address}</p>
            <p>To: {email.to_address}</p>
            <p>{new Date(email.received_at).toLocaleString()} · {(email.size_bytes / 1024).toFixed(1)} KB</p>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            {email.has_attachments && <Badge variant="outline">📎 Attachments</Badge>}
            <Badge variant={email.is_read ? "secondary" : "default"}>{email.is_read ? "Read" : "Unread"}</Badge>
            <SpamBadge score={email.spam_score} />
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <Tabs defaultValue="html">
            <TabsList>
              {email.body_html && <TabsTrigger value="html">HTML</TabsTrigger>}
              <TabsTrigger value="text">Plain Text</TabsTrigger>
              <TabsTrigger value="headers">Raw Headers</TabsTrigger>
            </TabsList>
            {email.body_html && (
              <TabsContent value="html">
                <iframe srcDoc={email.body_html} title="Email content" className="w-full min-h-[400px] border-0" sandbox="" />
              </TabsContent>
            )}
            <TabsContent value="text">
              <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded">{email.body_text || "(empty body)"}</pre>
            </TabsContent>
            <TabsContent value="headers">
              <pre className="whitespace-pre-wrap text-xs bg-muted p-4 rounded font-mono max-h-[400px] overflow-auto">
                {email.raw_headers || "(no headers available)"}
              </pre>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {email.attachments && email.attachments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Attachments ({email.attachments.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {email.attachments.map((a) => (
                <AttachmentCard key={a.id} attachment={a} emailId={emailId} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AttachmentCard({ attachment, emailId }: { attachment: Attachment; emailId: string }) {
  const download = async () => {
    try {
      const res = await api.get<{ url: string }>(`/emails/${emailId}/attachments/${attachment.id}`);
      window.open(res.url, "_blank");
    } catch {
      toast.error("Failed to download");
    }
  };

  return (
    <button onClick={download} className="flex items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted transition-colors w-full">
      <span className="text-2xl">📎</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{attachment.filename}</p>
        <p className="text-xs text-muted-foreground">{attachment.content_type} · {(attachment.size_bytes / 1024).toFixed(1)} KB</p>
      </div>
    </button>
  );
}
