"use client";

import { useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import Link from "next/link";

export default function ProfilePage() {
  const { user, fetchMe } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  const updateProfile = async () => {
    setSaving(true);
    try {
      await api.patch("/auth/me", { display_name: displayName, avatar_url: avatarUrl || undefined });
      await fetchMe();
      toast.success("Profile updated");
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    setChangingPw(true);
    try {
      await api.put("/auth/me/password", { current_password: currentPassword, new_password: newPassword });
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      setChangingPw(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary overflow-hidden">
              {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : user?.display_name?.charAt(0).toUpperCase() || "?"}
            </div>
            <div>
              <CardTitle>Account Details</CardTitle>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="displayName">Display Name</Label>
            <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="avatar">Avatar URL</Label>
            <Input id="avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
          </div>
          <Button onClick={updateProfile} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Change Password</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="currentPw">Current Password</Label>
            <Input id="currentPw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="newPw">New Password</Label>
            <Input id="newPw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button onClick={changePassword} disabled={changingPw}>{changingPw ? "Changing…" : "Change Password"}</Button>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex gap-4">
        <Link href="/profile/sessions">
          <Button variant="outline">Manage Sessions</Button>
        </Link>
        <Link href="/profile/delete">
          <Button variant="destructive">Delete Account</Button>
        </Link>
      </div>
    </div>
  );
}
