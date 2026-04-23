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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Shield, Users, KeyRound } from "lucide-react";
import { Logo } from "@/components/logo";

interface InviteTeamAssignment {
  team_id: string;
  team_role: string;
  team_name: string;
}

interface InvitePreview {
  email: string;
  org_name: string;
  org_role: string;
  allowed_auth: string[];
  team_assignments: InviteTeamAssignment[];
}

interface SSOStatusProvider { name: string; provider_type: string; label: string; enabled: boolean; }
interface SSOStatus { enabled: boolean; allow_registration: boolean; enforce_sso?: boolean; providers?: SSOStatusProvider[]; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";
const REDIRECT_DELAY_MS = 3000;

function getProviderIcon(providerType: string) {
  switch (providerType) {
    case "github":
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
        </svg>
      );
    case "google":
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      );
    case "azure":
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2 3h9v9H2V3zm11 0h9v9h-9V3zM2 14h9v9H2v-9zm11 0h9v9h-9v-9z" />
        </svg>
      );
    case "okta":
      return <KeyRound className="h-5 w-5" />;
    default:
      return <Shield className="h-5 w-5" />;
  }
}

/** Check if a given auth method is allowed by the invite's allowed_auth list */
function isAuthAllowed(allowedAuth: string[] | undefined, method: string): boolean {
  if (!allowedAuth || allowedAuth.length === 0) return true;
  if (allowedAuth.includes("any")) return true;
  return allowedAuth.includes(method);
}

export default function InvitePage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const logout = useAuthStore((s) => s.logout);
  const { fetchOrgs } = useOrgStore();

  const [status, setStatus] = useState<"loading" | "auth" | "accepting" | "accepted" | "mismatch" | "error">("loading");
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
      if (msg.toLowerCase().includes("email mismatch") || msg.toLowerCase().includes("different email")) {
        setStatus("mismatch");
        return;
      }
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

  // Determine which auth options to show based on allowed_auth
  const allowedAuth = preview?.allowed_auth;
  const showAllAuth = !allowedAuth || allowedAuth.length === 0 || allowedAuth.includes("any");
  const showPasswordForm = showAllAuth || isAuthAllowed(allowedAuth, "password");

  const allSSOProviders = (sso?.providers ?? []).filter(p => p.enabled);
  // Filter SSO providers based on allowed_auth
  const visibleSSOProviders = showAllAuth
    ? allSSOProviders
    : allSSOProviders.filter(p => isAuthAllowed(allowedAuth, `sso:${p.name}`));

  const ssoEnabled = sso?.enabled ?? false;
  const showSSO = ssoEnabled && visibleSSOProviders.length > 0;
  const enforceSSO = sso?.enforce_sso ?? false;

  const handleSSO = (providerName: string) => {
    // Store token in sessionStorage so we can accept after SSO callback
    if (token) sessionStorage.setItem("pending_invite_token", token);
    window.location.href = `${API_BASE}/auth/sso/${providerName}`;
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

  // Team assignments from preview
  const teamAssignments = preview?.team_assignments ?? [];

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

  // Email mismatch — logged in as wrong account
  if (status === "mismatch") {
    const handleLogoutAndRetry = async () => {
      await logout();
      acceptingRef.current = false;
      setStatus("auth");
    };
    return (
      <CenteredCard>
        <CardHeader className="text-center">
          <div className="text-3xl mb-2">⚠️</div>
          <CardTitle>Wrong account</CardTitle>
          <CardDescription>
            This invite was sent to <strong className="font-mono">{preview?.email}</strong>, but you&apos;re signed in as <strong className="font-mono">{user?.email}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground text-center">
            Sign out and log in with the correct account to accept this invite.
          </p>
          <Button className="w-full" onClick={handleLogoutAndRetry}>
            Sign out &amp; try again
          </Button>
          <Link href="/" className="block text-center text-sm text-muted-foreground hover:underline">
            Go to dashboard instead
          </Link>
        </CardContent>
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
  const allowReg = sso?.allow_registration ?? true;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-2"><Logo /></div>
          <CardTitle>Join {preview?.org_name}</CardTitle>
          <CardDescription>
            You&apos;ve been invited as <strong>{preview?.org_role}</strong>
          </CardDescription>
          <p className="text-sm font-mono text-muted-foreground mt-1">{preview?.email}</p>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Team assignments info */}
          {teamAssignments.length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>Team assignments</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {teamAssignments.map((ta) => (
                  <Badge key={ta.team_id} variant="outline" className="text-xs text-violet-600 border-violet-200">
                    {ta.team_name} · {ta.team_role}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Password form — shown when allowed_auth permits password or when showing all */}
          {showPasswordForm && !enforceSSO && (
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

          {showSSO && (
            <>
              {showPasswordForm && !enforceSSO && (
                <div className="relative">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">or</span>
                </div>
              )}
              {visibleSSOProviders.map((provider) => (
                <Button
                  key={provider.name}
                  className="w-full gap-2"
                  variant={enforceSSO || !showPasswordForm ? "default" : "outline"}
                  onClick={() => handleSSO(provider.name)}
                >
                  {getProviderIcon(provider.provider_type)} Continue with {provider.label ?? provider.name}
                </Button>
              ))}
            </>
          )}

          {/* If neither password nor SSO is available, show a message */}
          {!showPasswordForm && !showSSO && (
            <div className="text-center text-sm text-muted-foreground py-4">
              <p>No authentication methods are currently available for this invite.</p>
              <p className="mt-1">Please contact the administrator.</p>
            </div>
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
