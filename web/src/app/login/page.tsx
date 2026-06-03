"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { api, setAccessToken } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { ProviderIcon } from "@/components/provider-icon";
import { SessionConflictDialog } from "@/components/session-conflict-dialog";
import type { Session } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

function safeRedirect(url: string | null): string {
  if (!url) return "/dashboard";
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("://")) {
    return "/dashboard";
  }
  return url;
}

interface SSOStatusProvider {
  name: string;
  provider_type: string;
  label: string;
  enabled: boolean;
}

interface SSOStatus {
  enabled: boolean;
  allow_registration: boolean;
  enforce_sso?: boolean;
  providers?: SSOStatusProvider[];
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);
  const login = useAuthStore((s) => s.login);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const sessionConflict = useAuthStore((s) => s.sessionConflict);
  const clearSessionConflict = useAuthStore((s) => s.clearSessionConflict);
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: sso } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatus>("/auth/sso-status"),
    staleTime: 60000,
  });

  useEffect(() => {
    // Handle SSO code exchange (new secure flow)
    const ssoCode = searchParams.get("sso_code");
    if (ssoCode) {
      window.history.replaceState(null, "", window.location.pathname);
      api.post<{ access_token: string; refresh_token: string; user_id: string }>("/auth/sso/exchange", { code: ssoCode })
        .then((res) => {
          setAccessToken(res.access_token);
          localStorage.setItem("refresh_token", res.refresh_token);
          const pendingInvite = sessionStorage.getItem("pending_invite_token");
          if (pendingInvite) {
            sessionStorage.removeItem("pending_invite_token");
            fetchMe().then(() => router.replace(`/invite?token=${pendingInvite}`));
            return;
          }
          const redirect = safeRedirect(searchParams.get("redirect"));
          fetchMe().then(() => router.replace(redirect));
        })
        .catch(() => {
          toast.error("SSO login failed: code expired or invalid. Please try again.");
        });
      return;
    }

    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.substring(1));
    const error = params.get("error");
    if (error) {
      toast.error(`SSO login failed: ${error}`);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }
    // Handle SSO session conflict redirect
    const sessionConflict = params.get("session_conflict");
    const ssoConflictToken = params.get("pending_token");
    if (sessionConflict === "true" && ssoConflictToken) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      // Fetch sessions for this pending token
      api.get<{ sessions: Session[]; limit: number }>("/auth/login/pending-sessions", { token: ssoConflictToken })
        .then((res) => {
          useAuthStore.setState({
            sessionConflict: {
              pendingToken: ssoConflictToken,
              sessions: res.sessions,
              limit: res.limit,
            },
          });
        })
        .catch(() => {
          toast.error("Session conflict expired. Please try again.");
        });
      return;
    }
  }, [searchParams, fetchMe, router]);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validateEmail = () => {
    if (email && !emailRegex.test(email)) {
      setEmailError("Please enter a valid email address");
    } else {
      setEmailError("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      // If sessionConflict was set (409), the dialog will handle it — don't navigate
      const conflict = useAuthStore.getState().sessionConflict;
      if (conflict) {
        return;
      }
      const redirect = safeRedirect(searchParams.get("redirect"));
      router.push(redirect);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleConflictResolved = async () => {
    clearSessionConflict();
    await fetchMe();
    const redirect = safeRedirect(searchParams.get("redirect"));
    router.push(redirect);
  };

  const handleConflictClose = () => {
    clearSessionConflict();
    // Email and password fields are preserved since we don't clear them
  };

  const ssoEnabled = sso?.enabled ?? false;
  const enforceSSO = sso?.enforce_sso ?? false;
  const ssoProviders = (sso?.providers ?? []).filter((p) => p.enabled);

  return (
    <AuthShell>
      <Card className="w-full">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl font-semibold">Sign in</CardTitle>
            <CardDescription className="text-sm">
              {enforceSSO ? "Sign in with SSO to continue" : "Enter your credentials to continue"}
            </CardDescription>
          </CardHeader>

          {ssoEnabled && ssoProviders.length > 0 && (
            <CardContent className={enforceSSO ? "" : "pb-0"}>
              <div className="space-y-2">
                {ssoProviders.map((p) => (
                  <a key={p.name} href={`${API_BASE}/auth/sso/${p.name}`} onClick={() => setSsoLoading(p.name)}>
                    <Button variant="outline" className="w-full gap-2 mb-1" type="button" disabled={ssoLoading === p.name}>
                      {ssoLoading === p.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <ProviderIcon providerType={p.provider_type} />}
                      {ssoLoading === p.name ? `Redirecting to ${p.label}…` : `Sign in with ${p.label}`}
                    </Button>
                  </a>
                ))}
              </div>
            </CardContent>
          )}

          {!enforceSSO && (
            <>
              {ssoEnabled && (
                <div className="relative px-6 py-3">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs uppercase text-muted-foreground">
                    or
                  </span>
                </div>
              )}
              <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                      onBlur={validateEmail}
                      autoComplete="email"
                      placeholder="you@example.com"
                      className={emailError ? "border-destructive focus-visible:ring-destructive" : ""}
                    />
                    {emailError && <p className="text-xs text-destructive">{emailError}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        placeholder="••••••••"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in…" : "Sign in"}
                  </Button>
                </CardContent>
                <CardFooter className="flex justify-between text-sm">
                  <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground transition-colors text-xs">Forgot password?</Link>
                  {(sso?.allow_registration ?? true) && (
                    <Link href="/register" className="text-muted-foreground hover:text-foreground transition-colors text-xs">Create account</Link>
                  )}
                </CardFooter>
              </form>
            </>
          )}

          {enforceSSO && (
            <CardFooter className="justify-center">
              <p className="text-xs text-muted-foreground">Your organization requires SSO authentication</p>
            </CardFooter>
          )}
        </Card>

      {sessionConflict && (
        <SessionConflictDialog
          open={!!sessionConflict}
          onClose={handleConflictClose}
          pendingToken={sessionConflict.pendingToken}
          sessions={sessionConflict.sessions}
          limit={sessionConflict.limit}
          onResolved={handleConflictResolved}
        />
      )}
    </AuthShell>
  );
}
