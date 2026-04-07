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
                <Button type="submit" className="w-full h-11" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
              </CardContent>
              <CardFooter className="justify-center pt-0">
                <Link href="/login" className="text-sm text-muted-foreground hover:underline">Back to sign in</Link>
              </CardFooter>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
