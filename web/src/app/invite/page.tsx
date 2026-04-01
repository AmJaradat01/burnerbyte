"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Shield } from "lucide-react";

interface InvitePreview { email: string; org_name: string; org_role: string; }
interface SSOStatus { enabled: boolean; allow_registration: boolean; provider?: string; provider_label?: string; enforce_sso?: boolean; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";
const REDIRECT_DELAY_MS = 3000;

export default function InvitePage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const { fetchOrgs } = useOrgStore();

  const [status, setStatus] = useState<"loading" | "auth" | "accepting" | "accepted" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [mode, setMode] = useState<"login" | "register">("register");
  const acceptingRef = useRef(false);

  // Form state
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Fetch invite preview (public, no auth needed)
  const { data: preview, error: previewError, isLoading: previewLoading } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => api.get<InvitePreview>(`/invites/${token}/preview`),
    enabled: !!token,
    retry: false,
  });

  const { data: sso } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatus>("/auth/sso-status"),
    staleTime: 60000,
  });

  // Handle preview errors (expired, already accepted, invalid token)
  useEffect(() => {
    if (previewError) {
      setStatus("error");
      const msg = previewError instanceof Error ? previewError.message : "Unknown error";
      if (msg.toLowerCase().includes("expired")) {
        setErrorMsg("This invite has expired. Please ask the admin to send a new one.");
      } else if (msg.toLowerCase().includes("accepted")) {
        setErrorMsg("This invite has already been accepted.");
      } else {
        setErrorMsg("This invite link is invalid or has expired.");
      }
    }
  }, [previewError]);

  // Determine state when auth resolves
  useEffect(() => {
    if (authLoading || previewLoading) return;
    if (!token) { setStatus("error"); setErrorMsg("No invite token found."); return; }
    if (previewError) return; // handled above
    if (user && preview && !acceptingRef.current) {
      acceptingRef.current = true;
      setStatus("accepting");
      acceptInvite();
      return;
    }
    if (!user && preview) { setStatus("auth"); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, previewLoading, user, token, preview, previewError]);

  const acceptInvite = async () => {
    try {
      await api.post(`/invites/${token}/accept`);
      // Refresh orgs so the new membership is reflected in the sidebar
      await fetchOrgs();
      setStatus("accepted");
      toast.success("Welcome to the organization!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to accept invite";
      setStatus("error");
      if (msg.toLowerCase().includes("expired")) {
        setErrorMsg("This invite has expired.");
      } else if (msg.toLowerCase().includes("not found")) {
        setErrorMsg("This invite is no longer valid.");
      } else {
        setErrorMsg(msg);
      }
    }
  };

  // Auto-redirect to dashboard after acceptance
  useEffect(() => {
    if (status !== "accepted") return;
    const timer = setTimeout(() => router.replace("/"), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    setSubmitting(true);
    try {
      if (mode === "register") {
        await register(preview.email, password, displayName);
      } else {
        await login(preview.email, password);
      }
      // After auth, the useEffect will detect user and auto-accept
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      // If email already registered, switch to login mode
      if (mode === "register" && msg.toLowerCase().includes("already registered")) {
        setMode("login");
        toast.error("This email already has an account. Please sign in instead.");
      } else {
        toast.error(msg);
      }
      setSubmitting(false);
    }
  };

  const handleSSO = () => {
    // Store token in sessionStorage so we can accept after SSO callback
    if (token) sessionStorage.setItem("pending_invite_token", token);
    window.location.href = `${API_BASE}/auth/sso/${sso!.provider}`;
  };

  // Check for pending invite after SSO callback
  useEffect(() => {
    if (user && !token) {
      const pending = sessionStorage.getItem("pending_invite_token");
      if (pending) {
        sessionStorage.removeItem("pending_invite_token");
        window.location.href = `/invite?token=${pending}`;
      }
    }
  }, [user, token]);

  // Loading
  if (status === "loading" || authLoading) {
    return <CenteredCard><Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" /></CenteredCard>;
  }

  // Error
  if (status === "error") {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle>Invite failed</CardTitle>
          <CardDescription>{errorMsg || "This invite link is invalid or has expired."}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/" className="text-sm text-primary hover:underline">Go to dashboard</Link>
        </CardFooter>
      </CenteredCard>
    );
  }

  // Accepting (logged in, auto-accepting)
  if (status === "accepting") {
    return (
      <CenteredCard>
        <CardHeader><CardTitle>Joining organization…</CardTitle></CardHeader>
        <CardContent className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></CardContent>
      </CenteredCard>
    );
  }

  // Accepted — auto-redirects after REDIRECT_DELAY_MS
  if (status === "accepted") {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle>Welcome to {preview?.org_name}!</CardTitle>
          <CardDescription>You&apos;ve joined as {preview?.org_role}. Redirecting to dashboard…</CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/" className="text-sm text-primary hover:underline font-medium">Go to dashboard →</Link>
        </CardFooter>
      </CenteredCard>
    );
  }

  // Auth form
  const ssoEnabled = sso?.enabled ?? false;
  const enforceSSO = sso?.enforce_sso ?? false;
  const allowReg = sso?.allow_registration ?? true;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="text-3xl mb-2">🔥</div>
          <CardTitle>Join {preview?.org_name}</CardTitle>
          <CardDescription>
            You&apos;ve been invited as <strong>{preview?.org_role}</strong>
          </CardDescription>
          <p className="text-sm font-mono text-muted-foreground mt-1">{preview?.email}</p>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Password form — default to registration (hidden when SSO enforced) */}
          {!enforceSSO && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input value={preview?.email ?? ""} disabled className="bg-muted font-mono text-sm" />
              </div>

              {mode === "register" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Display name</Label>
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required autoComplete="name" placeholder="Your full name" />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  placeholder={mode === "register" ? "Create a password" : "Enter your password"} />
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {mode === "register" ? "Create account & join" : "Sign in & join"}
              </Button>

              {mode === "register" ? (
                <p className="text-center text-xs text-muted-foreground">
                  Already have an account?{" "}
                  <button type="button" onClick={() => setMode("login")} className="text-primary hover:underline font-medium">Sign in instead</button>
                </p>
              ) : (
                allowReg && (
                  <p className="text-center text-xs text-muted-foreground">
                    Don&apos;t have an account?{" "}
                    <button type="button" onClick={() => setMode("register")} className="text-primary hover:underline font-medium">Create one</button>
                  </p>
                )
              )}
            </form>
          )}

          {ssoEnabled && (
            <>
              {!enforceSSO && (
                <div className="relative">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">or</span>
                </div>
              )}
              <Button className="w-full gap-2" variant={enforceSSO ? "default" : "outline"} onClick={handleSSO}>
                <Shield className="h-4 w-4" /> Continue with {sso?.provider_label ?? "SSO"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  );
}
