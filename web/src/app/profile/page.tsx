"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import Link from "next/link";
import { KeyRound, LogOut, Monitor, Shield, Trash2 } from "lucide-react";

export default function ProfilePage() {
  const { user, fetchMe } = useAuthStore();

  if (!user) return <div className="mx-auto max-w-5xl space-y-8"><Skeleton className="h-8 w-48" /><Skeleton className="h-32 w-full" /></div>;

  const initials = user.display_name
    ? user.display_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase();

  const isSSO = !!user.sso_provider;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <h1 className="text-2xl font-bold">Profile</h1>
      <p className="text-sm text-muted-foreground mt-0.5">Manage your account settings and preferences.</p>

      {/* Identity banner */}
      <Card>
        <CardContent className="flex items-center gap-4 py-6">
          <Avatar className="h-16 w-16 text-lg">
            <AvatarImage src={user.avatar_url} alt={user.display_name} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-lg font-semibold">{user.display_name || "Unnamed"}</p>
              {user.is_system_admin && <Badge variant="secondary">Admin</Badge>}
            </div>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {user.email_verified ? (
                <Badge variant="outline" className="text-green-600 border-green-600">Email verified</Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-600">Email not verified</Badge>
              )}
              {isSSO && <Badge variant="outline">SSO via {user.sso_provider}</Badge>}
            </div>
          </div>
          <p className="hidden text-xs text-muted-foreground sm:block">
            Member since {new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </CardContent>
      </Card>

      {/* Two-column layout */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          <ProfileForm user={user} onSaved={fetchMe} />

          {/* Quick links */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Monitor className="h-4 w-4" /> Account</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Link href="/profile/sessions">
                <Button variant="outline" size="sm" className="gap-2"><Monitor className="h-3.5 w-3.5" /> Manage Sessions</Button>
              </Link>
              <Link href="/profile/delete">
                <Button variant="destructive" size="sm" className="gap-2"><Trash2 className="h-3.5 w-3.5" /> Delete Account</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {!isSSO ? <ChangePasswordForm /> : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> Password</CardTitle>
                <CardDescription>Your account uses SSO ({user.sso_provider}). Password management is handled by your identity provider.</CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileForm({ user, onSaved }: { user: NonNullable<ReturnType<typeof useAuthStore.getState>["user"]>; onSaved: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = displayName !== (user.display_name ?? "") || avatarUrl !== (user.avatar_url ?? "");

  const handleSave = async () => {
    if (!displayName.trim()) { toast.error("Display name is required"); return; }
    setSaving(true);
    try {
      await api.patch("/auth/me", { display_name: displayName.trim(), avatar_url: avatarUrl.trim() || undefined });
      await onSaved();
      toast.success("Profile updated");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" /> Account Details</CardTitle>
        <CardDescription>Update your display name and avatar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={user.email} disabled className="bg-muted" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="displayName">Display Name</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="avatar">Avatar URL</Label>
          <Input id="avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://example.com/avatar.png" />
          <p className="text-xs text-muted-foreground">Direct link to an image. Leave empty to use initials.</p>
        </div>
        <Button onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const logout = useAuthStore((s) => s.logout);

  const valid = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleChange = async () => {
    if (!valid) return;
    setChanging(true);
    try {
      await api.put("/auth/me/password", { current_password: currentPassword, new_password: newPassword });
      toast.success("Password changed — signing you out");
      setTimeout(() => logout(), 1500);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
      setChanging(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><LogOut className="h-4 w-4" /> Change Password</CardTitle>
        <CardDescription>You will be signed out of all sessions after changing your password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="currentPw">Current Password</Label>
          <Input id="currentPw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <Separator />
        <div className="space-y-2">
          <Label htmlFor="newPw">New Password</Label>
          <Input id="newPw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          {newPassword.length > 0 && newPassword.length < 8 && (
            <p className="text-xs text-destructive">Must be at least 8 characters</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPw">Confirm New Password</Label>
          <Input id="confirmPw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          {mismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
        </div>
        <Button onClick={handleChange} disabled={changing || !valid}>
          {changing ? "Changing…" : "Change Password"}
        </Button>
      </CardContent>
    </Card>
  );
}
