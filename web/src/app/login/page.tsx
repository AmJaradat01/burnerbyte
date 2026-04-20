"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Shield, Zap, Clock, Eye, EyeOff, Loader2, KeyRound } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

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
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: sso } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatus>("/auth/sso-status"),
    staleTime: 60000,
  });

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.substring(1));
    const error = params.get("error");
    if (error) {
      toast.error(`SSO login failed: ${error}`);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);
      // Check for pending invite token from SSO flow started on invite page
      const pendingInvite = sessionStorage.getItem("pending_invite_token");
      if (pendingInvite) {
        sessionStorage.removeItem("pending_invite_token");
        fetchMe().then(() => router.replace(`/invite?token=${pendingInvite}`));
        return;
      }
      const redirect = searchParams.get("redirect") || "/";
      fetchMe().then(() => router.replace(redirect));
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
      const redirect = searchParams.get("redirect") || "/";
      router.push(redirect);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const ssoEnabled = sso?.enabled ?? false;
  const enforceSSO = sso?.enforce_sso ?? false;
  const ssoProviders = (sso?.providers ?? []).filter((p) => p.enabled);

  return (
    <div className="flex min-h-[calc(100vh-8rem)]">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-2/5 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex-col justify-center px-12 py-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
        <div className="relative z-10 space-y-8">
          <div>
            <span className="text-4xl">🔥</span>
            <h1 className="text-2xl font-bold mt-3">BurnerByte</h1>
            <p className="text-sm text-white/60 mt-1">Self-hosted temporary email</p>
          </div>
          <div className="space-y-3">
            {[{ icon: Shield, title: "Privacy First", desc: "Your data stays on your server. No third-party access." }, { icon: Zap, title: "Instant Inboxes", desc: "Create disposable emails in seconds. Auto-expire when done." }, { icon: Clock, title: "Full Control", desc: "Self-hosted with custom domains, teams, and RBAC." }].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <div className="rounded-md bg-white/10 p-1.5 shrink-0 mt-0.5"><Icon className="h-4 w-4 text-white/80" /></div>
                <div><p className="font-medium text-white text-sm">{title}</p><p className="text-white/50 text-xs mt-0.5 leading-relaxed">{desc}</p></div>
              </div>
            ))}
          </div>
          <p className="text-white/30 text-xs pt-4 border-t border-white/10">Trusted by teams who value privacy</p>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-muted/50 to-background p-6">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <div className="text-3xl mb-2 lg:hidden">🔥</div>
            <CardTitle className="text-2xl">Sign in to BurnerByte</CardTitle>
            <CardDescription>
              {enforceSSO ? "Sign in with SSO to continue" : "Enter your credentials to continue"}
            </CardDescription>
          </CardHeader>

          {ssoEnabled && ssoProviders.length > 0 && (
            <CardContent className={enforceSSO ? "" : "pb-0"}>
              <div className="space-y-2">
                {ssoProviders.map((p) => (
                  <a key={p.name} href={`${API_BASE}/auth/sso/${p.name}`} onClick={() => setSsoLoading(p.name)}>
                    <Button variant="outline" className="w-full gap-2 h-11 mb-1" type="button" disabled={ssoLoading === p.name}>
                      {ssoLoading === p.name ? <Loader2 className="h-4 w-4 animate-spin" /> : getProviderIcon(p.provider_type)}
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
                <CardContent className="space-y-4 pb-6">
                  <div className="space-y-2">
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
                      className={emailError ? "border-red-500 focus-visible:ring-red-500" : ""}
                    />
                    {emailError && <p className="text-xs text-red-500">{emailError}</p>}
                  </div>
                  <div className="space-y-2">
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
                  <Button type="submit" className="w-full h-11" disabled={loading}>
                    {loading ? "Signing in…" : "Sign in"}
                  </Button>
                </CardContent>
                <CardFooter className="flex justify-between text-sm pt-0">
                  <Link href="/forgot-password" className="text-muted-foreground hover:underline">Forgot password?</Link>
                  {(sso?.allow_registration ?? true) && (
                    <Link href="/register" className="text-muted-foreground hover:underline">Create account</Link>
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
      </div>
    </div>
  );
}
