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
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { toast } from "sonner";
import { Shield, Zap, Clock, Eye, EyeOff, Check, X, User, Mail, Lock, Info } from "lucide-react";

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

const features = [
  { icon: Shield, title: "Privacy First", desc: "Your data stays on your server. No third-party access." },
  { icon: Zap, title: "Instant Inboxes", desc: "Create disposable emails in seconds. Auto-expire when done." },
  { icon: Clock, title: "Full Control", desc: "Self-hosted with custom domains, teams, and RBAC." },
];

function BrandingPanel() {
  return (
    <div className="hidden lg:flex lg:w-2/5 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white flex-col justify-center px-12 py-12 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      <div className="relative z-10 space-y-8">
        <div>
          <span className="text-4xl">🔥</span>
          <h1 className="text-2xl font-bold mt-3">BurnerByte</h1>
          <p className="text-sm text-white/60 mt-1">Self-hosted temporary email</p>
        </div>
        <div className="space-y-3">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex items-start gap-3">
              <div className="rounded-md bg-white/10 p-1.5 shrink-0 mt-0.5">
                <Icon className="h-4 w-4 text-white/80" />
              </div>
              <div>
                <p className="font-medium text-white text-sm">{title}</p>
                <p className="text-white/50 text-xs mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-white/30 text-xs pt-4 border-t border-white/10">
          Trusted by teams who value privacy
        </p>
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader className="text-center space-y-2">
        <Skeleton className="h-7 w-48 mx-auto" />
        <Skeleton className="h-4 w-36 mx-auto" />
      </CardHeader>
      <CardContent className="space-y-4 pb-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-11 w-full" />
        </div>
        <Skeleton className="h-11 w-full" />
      </CardContent>
    </Card>
  );
}

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: sso, isLoading: ssoLoading } = useQuery({
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
  const strengthLabel = strengthPct <= 33 ? "Weak" : strengthPct <= 66 ? "Fair" : "Strong";

  const passwordsMismatch = confirmTouched && confirmPassword !== password;
  const passwordsMatch = confirmTouched && confirmPassword.length > 0 && confirmPassword === password;

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
    if (password !== confirmPassword) return;
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
      <BrandingPanel />

      <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-muted/50 to-background p-6">
        {ssoLoading ? (
          <FormSkeleton />
        ) : (
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
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" placeholder="Your full name" className="pl-9" />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                      onBlur={validateEmail}
                      autoComplete="email"
                      placeholder="you@example.com"
                      className={`pl-9 ${emailError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                    />
                  </div>
                  {emailError && <p className="text-xs text-red-500">{emailError}</p>}
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="password">Password</Label>
                    {policy && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Password requirements">
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 text-sm" side="top">
                          <p className="font-medium mb-2">Password requirements</p>
                          <ul className="space-y-1">
                            {requirements.map((req) => (
                              <li key={req.label} className="flex items-center gap-2 text-xs">
                                {req.met ? <Check className="h-3 w-3 text-emerald-500" /> : <X className="h-3 w-3 text-muted-foreground" />}
                                <span className={req.met ? "text-emerald-600" : "text-muted-foreground"}>{req.label}</span>
                              </li>
                            ))}
                          </ul>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Create a password"
                      className="pl-9 pr-10"
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

                  {/* Strength bar */}
                  {policy && password.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${strengthColor}`} style={{ width: `${strengthPct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 shrink-0">{strengthLabel}</span>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type={showConfirm ? "text" : "password"}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onBlur={() => setConfirmTouched(true)}
                      autoComplete="new-password"
                      placeholder="Confirm your password"
                      className={`pl-9 pr-10 ${passwordsMismatch ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {passwordsMismatch && <p className="text-xs text-red-500">Passwords don&apos;t match</p>}
                  {passwordsMatch && <p className="text-xs text-emerald-600">Passwords match</p>}
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

                <Button type="submit" className="w-full h-11" disabled={loading || !agreed || passwordsMismatch}>
                  {loading ? "Creating account…" : "Create account"}
                </Button>
              </CardContent>
              <CardFooter className="justify-center pt-0">
                <Link href="/login" className="text-sm text-muted-foreground hover:underline">Already have an account? Sign in</Link>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
