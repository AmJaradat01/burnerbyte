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
import { toast } from "sonner";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

interface SSOStatus {
  enabled: boolean;
  allow_registration: boolean;
  provider?: string;
  provider_label?: string;
  enforce_sso?: boolean;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: sso } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatus>("/auth/sso-status"),
    staleTime: 60000,
  });

  // Handle SSO callback tokens from URL fragment (hash)
  // Tokens are passed as fragment to prevent logging by proxies/servers
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      // Strip tokens from URL immediately to prevent exposure in history
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);
      const redirect = searchParams.get("redirect") || "/";
      fetchMe().then(() => router.replace(redirect));
    }
  }, [searchParams, fetchMe, router]);

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
  const ssoUrl = ssoEnabled ? `${API_BASE}/auth/sso/${sso!.provider}` : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-muted/50 to-background">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="text-3xl mb-2">🔥</div>
          <CardTitle className="text-2xl">Sign in to BurnerByte</CardTitle>
          <CardDescription>
            {enforceSSO ? `Sign in with ${sso?.provider_label ?? "SSO"} to continue` : "Enter your credentials to continue"}
          </CardDescription>
        </CardHeader>

        {ssoEnabled && (
          <CardContent className={enforceSSO ? "" : "pb-0"}>
            <a href={ssoUrl}>
              <Button variant="outline" className="w-full gap-2 h-11" type="button">
                Sign in with {sso?.provider_label ?? "SSO"}
              </Button>
            </a>
          </CardContent>
        )}

        {!enforceSSO && (
          <>
            {ssoEnabled && (
              <div className="relative px-6 py-3">
                <div className="absolute inset-0 flex items-center px-6"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
              </div>
            )}
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4 pb-6">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" />
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
  );
}
