"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Shield, Zap, Clock } from "lucide-react";

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
    <div className="flex min-h-screen">
      {/* Left branding panel */}
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
        {sent ? (
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader className="text-center">
              <div className="text-3xl mb-2 lg:hidden">🔥</div>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>If an account exists for {email}, we sent a password reset link.</CardDescription>
            </CardHeader>
            <CardFooter className="flex gap-4">
              <Button variant="outline" onClick={() => setSent(false)}>Try again</Button>
              <Link href="/login" className="text-sm text-muted-foreground hover:underline">Back to sign in</Link>
            </CardFooter>
          </Card>
        ) : (
          <Card className="w-full max-w-md shadow-xl">
            <CardHeader className="text-center">
              <div className="text-3xl mb-2 lg:hidden">🔥</div>
              <CardTitle className="text-2xl">Reset password</CardTitle>
              <CardDescription>Enter your email to receive a reset link</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                    onBlur={validateEmail}
                    placeholder="you@example.com"
                    className={emailError ? "border-red-500 focus-visible:ring-red-500" : ""}
                  />
                  {emailError && <p className="text-xs text-red-500">{emailError}</p>}
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full h-11" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
                <Link href="/login" className="text-sm text-muted-foreground hover:underline">Back to sign in</Link>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
