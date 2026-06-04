"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { EmailPreview } from "@/components/inbox/email-preview";
import { ArrowLeft } from "lucide-react";
import type { Email } from "@/types";

export default function EmailDetailPage() {
  const { emailId } = useParams<{ emailId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: email, isLoading, isError, refetch } = useQuery({
    queryKey: ["email", emailId],
    queryFn: () => api.get<Email & { spam_score?: number; raw_headers?: string }>(`/emails/${emailId}`),
  });

  const toggleRead = useMutation({
    mutationFn: (is_read: boolean) => api.patch(`/emails/${emailId}`, { is_read }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email", emailId] }),
  });

  const deleteEmail = useMutation({
    mutationFn: () => api.del(`/emails/${emailId}`),
    onSuccess: () => { router.back(); },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete email");
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="hidden md:block shrink-0 border-b bg-background px-4 py-2.5">
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="shrink-0 border-b bg-background px-5 py-4 space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full shrink-0" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        </div>
        <div className="flex-1 p-5">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (isError || !email) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <ErrorState message="Failed to load email" onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Desktop back affordance. EmailPreview's own back button is mobile-only
          (md:hidden), so on this standalone route desktop users would otherwise
          have no way back to the parent inbox. */}
      <div className="hidden md:block shrink-0 border-b bg-background px-4 py-2.5">
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => router.push(`/inboxes/${email.inbox_id}`)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back to inbox
        </Button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <EmailPreview
          email={email}
          onBack={() => router.push(`/inboxes/${email.inbox_id}`)}
          onToggleRead={() => toggleRead.mutate(!email.is_read)}
          onDelete={() => deleteEmail.mutate()}
        />
      </div>
    </div>
  );
}
