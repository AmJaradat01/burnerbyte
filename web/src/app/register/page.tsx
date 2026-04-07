"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Shield, Zap, Clock, Eye, EyeOff, Check, X } from "lucide-react";

interface PasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_number: boolean;
  require_special: boolean;
}

interface SSOStatus {
  enabled: boolean;
  allow_registration: boolean;
  provider?: string;
  provider_label?: string;
  enforce_sso?: boolean;
  password_policy?: PasswordPolicy;
}

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: sso } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatus>("/auth/sso-status"),
    staleTime: 60000,
  });

  useEffect(() => {
    if (sso && !sso.allow_registration) {
      router.replace("/login");
    }
  }, [sso, router]);

  const policy = sso?.password_policy;

  const requirements = policy
    ? [
        { met: password.length >= policy.min_length, label: `At least ${policy.min_length} characters` },
        ...(policy.require_uppercase ? [{ met: /[A-Z]/.test(password), label: "Uppercase letter" }] : []),
        ...(policy.require_lowercase ? [{ met: /[a-z]/.test(password), label: "Lowercase letter" }] : []),
        ...(policy.require_number ? [{ met: /\d/.test(password), label: "Number" }] : []),
        ...(policy.require_special ? [{ met: /[^A-Za-z0-9]/.test(password), label: "Special character" }] : []),
      ]
    : [];

  const metCount = requirements.filter((r) => r.met).length;
  const total = requirements.length;
  const strengthPct = total > 0 ? (metCount / total) * 100 : 0;
  const strengthColor = strengthPct <= 33 ? "bg-red-500" : strengthPct <= 66 ? "bg-amber-500" : "bg-emerald-500";

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
      await register(email, password, displayName);
      const redirect = searchParams.get("redirect") || "/";
      router.push(redirect);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (sso && !sso.allow_registration) return null;

  return (
    <div className="flex min-h-screen">
      {/* Left branding panel - hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary text-primary-foreground flex-col justify-center px-16">
        <div className="max-w-md mx-auto space-y-8">
          <div>
            <span className="text-5xl">🔥</span>
            <h1 className="text-3xl font-bold mt-4">BurnerByte</h1>
            <p className="text-lg text-primary-foreground/80 mt-2">Self-hosted temporary email</p>
          </div>
          <div className="space-y-4">
            {[
              { icon: Shield, text: "Privacy first" },
              { icon: Zap, text: "Instant inboxes" },
              { icon: Clock, text: "Auto-expiring" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-primary-foreground/70" />
                <span className="text-primary-foreground/90">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-muted/50 to-background p-6">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <div className="text-3xl mb-2 lg:hidden">🔥</div>
            <CardTitle className="text-2xl">Create your account</CardTitle>
            <CardDescription>Get started with BurnerByte</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4 pb-6">
              {/* SSO button */}
              {sso?.enabled && sso.provider && (
                <>
                  <Button variant="outline" className="w-full h-11" asChild>
                    <a href={`/api/v1/auth/sso/${sso.provider}`}>
                      Continue with {sso.provider_label}
                    </a>
                  </Button>
                  <div className="relative">
                    <Separator />
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                      or
                    </span>
                  </div>
                </>
              )}

              {/* Display name */}
              <div className="space-y-2">
                <Label htmlFor="name">Display name</Label>
                <Input id="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" placeholder="Your full name" />
              </div>

              {/* Email with validation */}
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

              {/* Password with visibility toggle */}
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Create a password"
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

                {/* Password strength indicator */}
                {policy && password.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${strengthColor}`} style={{ width: `${strengthPct}%` }} />
                    </div>
                    <ul className="space-y-1">
                      {requirements.map((req) => (
                        <li key={req.label} className="flex items-center gap-2 text-xs">
                          {req.met ? (
                            <Check className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <X className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span className={req.met ? "text-emerald-600" : "text-muted-foreground"}>{req.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Terms checkbox */}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-xs text-muted-foreground leading-tight">
                  I agree to the{" "}
                  <Link href="/terms" className="underline hover:text-foreground">Terms of Service</Link>{" "}
                  and{" "}
                  <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>
                </span>
              </label>

              <Button type="submit" className="w-full h-11" disabled={loading || !agreed}>
                {loading ? "Creating account…" : "Create account"}
              </Button>
            </CardContent>
            <CardFooter className="justify-center pt-0">
              <Link href="/login" className="text-sm text-muted-foreground hover:underline">Already have an account? Sign in</Link>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
