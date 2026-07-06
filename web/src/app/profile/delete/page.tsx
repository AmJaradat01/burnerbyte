"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Trash2 } from "lucide-react";

export default function DeleteAccountPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!user) return (
    <div className="max-w-md space-y-6">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );

  const isSSO = !!user.sso_provider;
  const canSubmit = confirm === "DELETE" && (isSSO || password.length > 0);

  const handleDelete = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setDeleting(true);
    try {
      await api.del("/auth/me", { password: isSSO ? "" : password });
      toast.success("Account deleted");
      logout();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Deletion failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/profile">
          <Button variant="ghost" size="sm" className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back to Profile</Button>
        </Link>
      </div>
      <header className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0" aria-hidden="true">
          <Trash2 className="h-4 w-4 text-destructive" />
        </div>
        <div className="min-w-0">
          <h1 className="text-headline">Delete Account</h1>
          <p className="text-sm text-muted-foreground">Permanently delete your account and all associated data.</p>
        </div>
      </header>

      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3" role="alert">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-destructive">Permanent action — cannot be undone</p>
          <p className="text-sm text-muted-foreground">Your account, all inboxes, received emails, API keys, and team memberships will be immediately and permanently deleted.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Confirm account deletion</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDelete} className="space-y-4">
            {!isSSO && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password to confirm" aria-describedby="pw-help" />
                <p id="pw-help" className="text-xs text-muted-foreground">Required to verify your identity.</p>
              </div>
            )}
            {isSSO && (
              <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
                You&apos;re signed in via {user.sso_provider}. No password required — type DELETE below to confirm.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="confirm">Type <span className="font-mono font-semibold">DELETE</span> to confirm</Label>
              <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" autoComplete="off" aria-describedby="confirm-help" />
              <p id="confirm-help" className="sr-only">Type the word DELETE in uppercase to enable the delete button.</p>
            </div>
            <Button
              type="submit"
              variant="destructive"
              disabled={deleting || !canSubmit}
              className="w-full"
              aria-busy={deleting}
            >
              {deleting ? "Deleting…" : "Delete My Account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
