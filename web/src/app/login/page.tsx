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
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { ProviderIcon } from "@/components/provider-icon";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

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
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-gradient-to-b from-muted/50 to-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Logo size="lg" />
        </div>
        <Card className="w-full shadow-xl">
          <CardHeader className="text-center">
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
