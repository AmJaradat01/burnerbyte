"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, LogIn, UserPlus } from "lucide-react";

export default function InvitePage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const [status, setStatus] = useState<"pending" | "accepted" | "error">("pending");
  const [accepting, setAccepting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const accept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      await api.post(`/invites/${token}/accept`);
      setStatus("accepted");
      toast.success("Invite accepted! Welcome to the organization.");
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Failed to accept invite";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setAccepting(false);
    }
  };

  // Auto-accept if user is logged in and status is pending
  useEffect(() => {
    if (!loading && user && token && status === "pending") {
      accept();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
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

  // Not logged in — show login/register options
  if (!user) {
    const returnUrl = encodeURIComponent(`/invite?token=${token}`);
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>You&apos;ve been invited</CardTitle>
            <CardDescription>Sign in or create an account to accept this invitation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full gap-2" onClick={() => router.push(`/login?redirect=${returnUrl}`)}>
              <LogIn className="h-4 w-4" /> Sign in to accept
            </Button>
            <Button variant="outline" className="w-full gap-2" onClick={() => router.push(`/register?redirect=${returnUrl}`)}>
              <UserPlus className="h-4 w-4" /> Create an account
            </Button>
          </CardContent>
          <CardFooter>
            <p className="text-xs text-muted-foreground">You&apos;ll be redirected back here after signing in.</p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Logged in — show status
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {accepting ? "Accepting…" : status === "accepted" ? "Welcome!" : status === "error" ? "Invite failed" : "Accepting invite…"}
          </CardTitle>
          <CardDescription>
            {accepting && "Please wait while we process your invitation."}
            {status === "accepted" && "You have successfully joined the organization."}
            {status === "error" && (errorMsg || "This invite link is invalid or has expired.")}
          </CardDescription>
        </CardHeader>
        {accepting && (
          <CardContent className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </CardContent>
        )}
        <CardFooter>
          <Link href="/" className="text-sm text-primary hover:underline font-medium">
            {status === "accepted" ? "Go to dashboard →" : "Go to dashboard"}
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
