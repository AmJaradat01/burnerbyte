"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { MailCheck } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

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
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      {sent ? (
          <Card className="w-full">
            <CardHeader className="items-center text-center">
              <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-success/10" aria-hidden="true">
                <MailCheck className="h-6 w-6 text-success" />
              </div>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>If an account exists for {email}, we sent a password reset link.</CardDescription>
            </CardHeader>
            <CardFooter className="flex-col gap-3">
              <Button variant="outline" className="w-full" onClick={() => setSent(false)}>Try a different email</Button>
              <Link href="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Back to sign in</Link>
            </CardFooter>
          </Card>
        ) : (
          <Card className="w-full">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Reset password</CardTitle>
              <CardDescription>Enter your email to receive a reset link</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                    onBlur={validateEmail}
                    placeholder="you@example.com"
                    className={emailError ? "border-destructive focus-visible:ring-destructive" : ""}
                  />
                  {emailError && <p className="text-xs text-destructive">{emailError}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
              </CardContent>
              <CardFooter className="justify-center pt-0">
                <Link href="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Back to sign in</Link>
              </CardFooter>
            </form>
          </Card>
        )}
    </AuthShell>
  );
}
