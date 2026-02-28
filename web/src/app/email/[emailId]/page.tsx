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
import type { Email } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

export default function EmailDetailPage() {
  const { emailId } = useParams<{ emailId: string }>();
  const qc = useQueryClient();

  const { data: email, isLoading } = useQuery({
    queryKey: ["email", emailId],
    queryFn: () => api.get<Email>(`/emails/${emailId}`),
  });

  const toggleRead = useMutation({
    mutationFn: (is_read: boolean) => api.patch(`/emails/${emailId}`, { is_read }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email", emailId] }),
  });

  const deleteEmail = useMutation({
    mutationFn: () => api.del(`/emails/${emailId}`),
    onSuccess: () => { window.history.back(); },
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!email) return <p className="text-muted-foreground">Email not found.</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/inboxes/${email.inbox_id}`} className="text-sm text-muted-foreground hover:underline">← Back to Inbox</Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">{email.subject || "(no subject)"}</CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => toggleRead.mutate(!email.is_read)}>
                Mark {email.is_read ? "unread" : "read"}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => deleteEmail.mutate()}>
                Delete
              </Button>
            </div>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>From: {email.from_address}</p>
            <p>To: {email.to_address}</p>
            <p>{new Date(email.received_at).toLocaleString()} · {(email.size_bytes / 1024).toFixed(1)} KB</p>
          </div>
          <div className="flex gap-2 mt-2">
            {email.has_attachments && <Badge variant="outline">📎 Attachments</Badge>}
            <Badge variant={email.is_read ? "secondary" : "default"}>{email.is_read ? "Read" : "Unread"}</Badge>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          {email.body_html ? (
            <iframe
              srcDoc={email.body_html}
              title="Email content"
              className="w-full min-h-[400px] border-0"
              sandbox="allow-same-origin"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm">{email.body_text || "(empty body)"}</pre>
          )}
        </CardContent>
      </Card>

      {email.attachments && email.attachments.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {email.attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded border p-3">
                  <div>
                    <p className="text-sm font-medium">{a.filename}</p>
                    <p className="text-xs text-muted-foreground">{a.content_type} · {(a.size_bytes / 1024).toFixed(1)} KB</p>
                  </div>
                  <a
                    href={`${API_BASE}/emails/${emailId}/attachments/${a.id}`}
                    className="text-sm text-primary hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
