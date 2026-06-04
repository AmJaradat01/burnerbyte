"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { AuthShell } from "@/components/layout/auth-shell";

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
    <AuthShell>
      <Card className="w-full">
          <CardHeader className="items-center text-center">
            <div
              className={`mb-1 flex h-12 w-12 items-center justify-center rounded-full ${
                status === "success" ? "bg-success/10" : status === "error" ? "bg-destructive/10" : "bg-muted"
              }`}
              aria-hidden="true"
            >
              {status === "loading" && <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />}
              {status === "success" && <CheckCircle2 className="h-6 w-6 text-success" />}
              {status === "error" && <XCircle className="h-6 w-6 text-destructive" />}
            </div>
            <CardTitle>{status === "loading" ? "Verifying…" : status === "success" ? "Email verified" : "Verification failed"}</CardTitle>
            <CardDescription>
              {status === "loading" && "Confirming your verification link."}
              {status === "success" && "Your email has been verified. Redirecting to sign in…"}
              {status === "error" && "The verification link is invalid or expired."}
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Link href="/login" className="text-sm text-muted-foreground hover:underline">Go to sign in</Link>
          </CardFooter>
        </Card>
    </AuthShell>
  );
}
