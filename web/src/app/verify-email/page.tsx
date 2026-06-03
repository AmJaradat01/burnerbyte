"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/logo";

export default function VerifyEmailPage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">(() => token ? "loading" : "error");

  useEffect(() => {
    if (!token) return;
    api.get(`/auth/verify-email/${token}`)
      .then(() => setStatus("success"))
      .catch(() => setStatus("error"));
  }, [token]);

  useEffect(() => {
    if (status !== "success") return;
    const timer = setTimeout(() => router.replace("/login"), 3000);
    return () => clearTimeout(timer);
  }, [status, router]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <Logo size="lg" />
          <p className="text-sm text-muted-foreground">Self-hosted temporary email</p>
        </div>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{status === "loading" ? "Verifying…" : status === "success" ? "Email verified" : "Verification failed"}</CardTitle>
            <CardDescription>
              {status === "success" && "Your email has been verified. Redirecting to sign in…"}
              {status === "error" && "The verification link is invalid or expired."}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/login" className="text-sm text-muted-foreground hover:underline">Go to sign in</Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
