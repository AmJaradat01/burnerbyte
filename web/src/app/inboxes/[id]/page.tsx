"use client";

import { useState, useCallback } from "react";
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
import type { EmailSummary, Email, Inbox } from "@/types";

export default function InboxDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: inbox } = useQuery({
    queryKey: ["inbox", id],
    queryFn: () => api.get<Inbox>(`/inboxes/${id}`),
  });

  const { data: emailsData } = useQuery({
    queryKey: ["emails", id, search],
    queryFn: () => api.get<{ data: EmailSummary[] }>(`/inboxes/${id}/emails`, search ? { q: search } : undefined),
  });

  const { data: selectedEmail } = useQuery({
    queryKey: ["email", selectedEmailId],
    queryFn: () => api.get<Email>(`/emails/${selectedEmailId}`),
    enabled: !!selectedEmailId,
  });

  const toggleRead = useMutation({
    mutationFn: ({ emailId, is_read }: { emailId: string; is_read: boolean }) =>
      api.patch(`/emails/${emailId}`, { is_read }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["emails", id] }); },
  });

  const onNewEmail = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["emails", id] });
    toast.info("New email received");
  }, [qc, id]);

  useInboxSocket(id, onNewEmail);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href="/inboxes" className="text-sm text-muted-foreground hover:underline">← Inboxes</Link>
        <h1 className="text-xl font-bold">{inbox?.full_address || inbox?.address || "Inbox"}</h1>
        {inbox && <Badge variant={inbox.is_active ? "default" : "secondary"}>{inbox.is_active ? "Active" : "Expired"}</Badge>}
      </div>

      <Input placeholder="Search emails…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />

      <div className="grid grid-cols-3 gap-4" style={{ minHeight: "60vh" }}>
        <Card className="col-span-1 overflow-auto">
          <CardContent className="p-0">
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
                </div>
              </button>
            ))}
            {(!emailsData?.data || emailsData.data.length === 0) && (
              <p className="p-4 text-center text-sm text-muted-foreground">No emails yet</p>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-2 overflow-auto">
          {selectedEmail ? (
            <>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{selectedEmail.subject || "(no subject)"}</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleRead.mutate({ emailId: selectedEmail.id, is_read: !selectedEmail.is_read })}
                  >
                    Mark {selectedEmail.is_read ? "unread" : "read"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">From: {selectedEmail.from_address}</p>
                <p className="text-sm text-muted-foreground">To: {selectedEmail.to_address}</p>
                <p className="text-xs text-muted-foreground">{new Date(selectedEmail.received_at).toLocaleString()}</p>
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
            <CardContent className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Select an email to read</p>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
