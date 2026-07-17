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
import { Eye, EyeOff, Check, X, User, Mail, Lock, Info } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";
import { ProviderIcon } from "@/components/provider-icon";

interface PasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_number: boolean;
  require_special: boolean;
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
  password_policy?: PasswordPolicy;
  providers?: SSOStatusProvider[];
}

function FormSkeleton() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center space-y-2">
        <Skeleton className="h-7 w-48 mx-auto" />
        <Skeleton className="h-4 w-36 mx-auto" />
      </CardHeader>
      <CardContent className="space-y-4 pb-6">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-full" />
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
  const strengthColor = strengthPct <= 33 ? "bg-destructive/50" : strengthPct <= 66 ? "bg-warning/50" : "bg-success/50";
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
    <AuthShell>
      {ssoLoading ? (
          <FormSkeleton />
        ) : (
          <Card className="w-full">
            <CardHeader className="text-center">
              <CardTitle className="text-xl font-bold tracking-tight">Create your account</CardTitle>
              <CardDescription>Get started with BurnerByte</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4 pb-6">
                {/* SSO buttons */}
                {sso?.enabled && sso.providers && sso.providers.filter(p => p.enabled).length > 0 && (
                  <>
                    <div className="space-y-2">
                      {sso.providers.filter(p => p.enabled).map((p) => (
                        <Button key={p.name} variant="outline" className="w-full gap-2" asChild>
                          <a href={`/api/v1/auth/sso/${p.name}`}>
                            <ProviderIcon providerType={p.provider_type} />
                            Continue with {p.label}
                          </a>
                        </Button>
                      ))}
                    </div>
                    <div className="relative">
                      <Separator />
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs uppercase text-muted-foreground">
                        or
                      </span>
                    </div>
                  </>
                )}

                {/* Display name */}
                <div className="space-y-1.5">
                  <Label htmlFor="name">Display name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input id="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" placeholder="Your full name" className="pl-9" />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
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
                      className={`pl-9 ${emailError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    />
                  </div>
                  {emailError && <p className="text-xs text-destructive">{emailError}</p>}
                </div>

                {/* Password */}
                <div className="space-y-1.5">
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
                                {req.met ? <Check className="h-3 w-3 text-success" /> : <X className="h-3 w-3 text-muted-foreground" />}
                                <span className={req.met ? "text-success" : "text-muted-foreground"}>{req.label}</span>
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150"
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
                <div className="space-y-1.5">
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
                      className={`pl-9 pr-10 ${passwordsMismatch ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors duration-150"
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {passwordsMismatch && <p className="text-xs text-destructive">Passwords don&apos;t match</p>}
                  {passwordsMatch && <p className="text-xs text-success flex items-center gap-1"><Check className="h-3 w-3" /> Passwords match</p>}
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
                    <Link href="/terms" className="underline hover:text-foreground transition-colors duration-150">Terms of Service</Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="underline hover:text-foreground transition-colors duration-150">Privacy Policy</Link>
                  </span>
                </label>

                <Button type="submit" className="w-full h-11 font-semibold" disabled={loading || !agreed || passwordsMismatch}>
                  {loading ? "Creating account…" : "Create account"}
                </Button>
              </CardContent>
              <CardFooter className="justify-center pt-0">
                <Link href="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-150">Already have an account? Sign in</Link>
              </CardFooter>
            </form>
          </Card>
        )}
    </AuthShell>
  );
}
