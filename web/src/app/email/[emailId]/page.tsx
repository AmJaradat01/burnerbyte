"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { EmailPreview } from "@/components/inbox/email-preview";
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
      const msg = err instanceof Error ? err.message : "Failed";
      // toast imported via sonner in EmailPreview, but we handle nav here
      console.error(msg);
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
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
      <EmailPreview
        email={email}
        onBack={() => router.push(`/inboxes/${email.inbox_id}`)}
        onToggleRead={() => toggleRead.mutate(!email.is_read)}
        onDelete={() => deleteEmail.mutate()}
      />
    </div>
  );
}
