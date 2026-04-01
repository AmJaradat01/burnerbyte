"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function InvitePage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const [status, setStatus] = useState<"pending" | "accepted" | "error">("pending");
  const [accepting, setAccepting] = useState(false);

  // Redirect to login if not authenticated, with return URL
  useEffect(() => {
    if (!loading && !user) {
      const returnUrl = encodeURIComponent(`/invite?token=${token}`);
      router.replace(`/login?redirect=${returnUrl}`);
    }
  }, [loading, user, token, router]);

  const accept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      await api.post(`/invites/${token}/accept`);
      setStatus("accepted");
      toast.success("Invite accepted! Welcome to the organization.");
    } catch (err) {
      setStatus("error");
      toast.error(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setAccepting(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid invite</CardTitle>
            <CardDescription>No invite token found in the URL.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/" className="text-sm text-muted-foreground hover:underline">Go to dashboard</Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {status === "accepted" ? "Welcome!" : status === "error" ? "Invite failed" : "You've been invited"}
          </CardTitle>
          <CardDescription>
            {status === "pending" && `Signed in as ${user.email}. Click below to accept the invitation and join the organization.`}
            {status === "accepted" && "You have successfully joined the organization."}
            {status === "error" && "This invite link is invalid or has expired. Please ask the admin to send a new invite."}
          </CardDescription>
        </CardHeader>
        {status === "pending" && (
          <CardContent>
            <Button onClick={accept} className="w-full" disabled={accepting}>
              {accepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {accepting ? "Accepting…" : "Accept invite"}
            </Button>
          </CardContent>
        )}
        <CardFooter>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            {status === "accepted" ? "Go to dashboard →" : "Go to dashboard"}
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
