"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Trash2 } from "lucide-react";

export default function DeleteAccountPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isSSO = !!user?.sso_provider;

  const handleDelete = async () => {
    if (confirm !== "DELETE") {
      toast.error("Type DELETE to confirm");
      return;
    }
    setDeleting(true);
    try {
      await api.del("/auth/me", { password: isSSO ? "" : password });
      toast.success("Account deleted");
      logout();
    } catch (e: unknown) {
      toast.error((e as Error).message);
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

      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
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
        <CardContent className="space-y-4">
          {!isSSO && (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password to confirm" />
            </div>
          )}
          {isSSO && (
            <p className="text-sm text-muted-foreground bg-muted rounded-lg p-3">
              You&apos;re signed in via {user.sso_provider}. No password required — just type DELETE below to confirm.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="confirm">Type DELETE to confirm</Label>
            <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
          </div>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting || confirm !== "DELETE" || (!isSSO && !password)}
            className="w-full"
          >
            {deleting ? "Deleting…" : "Delete My Account"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
