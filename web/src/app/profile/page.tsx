"use client";

import { useState, useEffect } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Clock, KeyRound, Link2, LogOut, Monitor, Shield, Trash2, Unlink } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDateFormat } from "@/hooks/use-date-format";

export default function ProfilePage() {
  const { user, fetchMe } = useAuthStore();
  const qc = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("sso_linked");
    if (linked) {
      toast.success(`${linked} account linked successfully`);
      window.history.replaceState(null, "", window.location.pathname);
      qc.invalidateQueries({ queryKey: ["sso-identities"] });
    }
  }, [qc]);

  if (!user) return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-56" /></div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </div>
  );

  const initials = user.display_name
    ? user.display_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase();

  const isSSO = !!user.sso_provider;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your account settings and preferences.</p>
      </div>

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
            <p className="truncate text-sm font-medium text-muted-foreground">{user.email}</p>
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

          <DateTimePreferencesCard />

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
          <ConnectedAccountsCard />

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

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris",
  "Asia/Amman", "Asia/Dubai", "Asia/Tokyo", "Asia/Shanghai",
  "Australia/Sydney",
];

function DateTimePreferencesCard() {
  const { settings } = useDateFormat();
  const qc = useQueryClient();
  const [tz, setTz] = useState("");
  const [dateFmt, setDateFmt] = useState("");
  const [timeFmt, setTimeFmt] = useState("");
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState("");

  const key = settings ? `${settings.timezone}-${settings.date_format}-${settings.time_format}` : "";
  if (key && key !== synced) {
    setTz(settings!.timezone);
    setDateFmt(settings!.date_format);
    setTimeFmt(settings!.time_format);
    setSynced(key);
  }

  const dirty = synced && (tz !== settings?.timezone || dateFmt !== settings?.date_format || timeFmt !== settings?.time_format);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/auth/me", { timezone: tz, date_format: dateFmt, time_format: timeFmt });
      qc.invalidateQueries({ queryKey: ["datetime-settings"] });
      toast.success("Date & time preferences saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Date & Time Preferences</CardTitle>
        <CardDescription>Choose your timezone and display formats.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Timezone</Label>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger><SelectValue placeholder="Select timezone" /></SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Date Format</Label>
          <Select value={dateFmt} onValueChange={setDateFmt}>
            <SelectTrigger><SelectValue placeholder="Select format" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
              <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Time Format</Label>
          <Select value={timeFmt} onValueChange={setTimeFmt}>
            <SelectTrigger><SelectValue placeholder="Select format" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24-hour</SelectItem>
              <SelectItem value="12h">12-hour</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save Preferences"}
        </Button>
      </CardContent>
    </Card>
  );
}


const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";

interface SSOIdentity {
  id: string;
  provider: string;
  subject: string;
  email: string;
  display_name: string;
  linked_at: string;
  last_used_at: string;
}

interface SSOStatusProvider {
  name: string;
  provider_type: string;
  label: string;
  enabled: boolean;
}

interface SSOStatusResponse {
  enabled: boolean;
  providers?: SSOStatusProvider[];
  enforce_sso?: boolean;
}

function ConnectedAccountsCard() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const { data: identities, isLoading: identitiesLoading } = useQuery({
    queryKey: ["sso-identities"],
    queryFn: () => api.get<SSOIdentity[]>("/auth/me/sso"),
  });

  const { data: ssoStatus } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatusResponse>("/auth/sso-status"),
    staleTime: 60000,
  });

  const providers = (ssoStatus?.providers ?? []).filter((p) => p.enabled);
  const linkedProviders = new Set((identities ?? []).map((i) => i.provider));
  const unlinkedProviders = providers.filter((p) => !linkedProviders.has(p.name));
  const enforceSSO = ssoStatus?.enforce_sso ?? false;
  const hasPassword = user?.sso_provider === undefined || user?.sso_provider === null;

  const handleUnlink = async (provider: string) => {
    setUnlinking(provider);
    try {
      await api.del(`/auth/me/sso/${provider}`);
      qc.invalidateQueries({ queryKey: ["sso-identities"] });
      toast.success(`${provider} account unlinked`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to unlink");
    } finally {
      setUnlinking(null);
    }
  };

  const handleLink = (providerName: string) => {
    window.location.href = `${API_BASE}/auth/sso/${providerName}?intent=link`;
  };

  if (!ssoStatus?.enabled && (!identities || identities.length === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" /> Connected Accounts</CardTitle>
        <CardDescription>Manage your linked SSO identities.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {identitiesLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            {(identities ?? []).map((identity) => (
              <div key={identity.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium capitalize">{identity.provider}</p>
                  <p className="text-xs text-muted-foreground">{identity.email}</p>
                  <p className="text-xs text-muted-foreground">Linked {new Date(identity.linked_at).toLocaleDateString()}</p>
                </div>
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={unlinking === identity.provider || !hasPassword || enforceSSO}
                      title={!hasPassword ? "Set a password first" : enforceSSO ? "SSO required by organization" : "Unlink account"}
                    >
                      <Unlink className="h-3.5 w-3.5" />
                      {unlinking === identity.provider ? "Unlinking…" : "Unlink"}
                    </Button>
                  }
                  title="Unlink SSO account?"
                  description={`This will disconnect your ${identity.provider} account. You can re-link it later from your profile.`}
                  onConfirm={() => handleUnlink(identity.provider)}
                />
              </div>
            ))}

            {unlinkedProviders.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border border-dashed p-3">
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">Not connected</p>
                </div>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleLink(p.name)}>
                  <Link2 className="h-3.5 w-3.5" /> Link Account
                </Button>
              </div>
            ))}

            {(identities ?? []).length === 0 && unlinkedProviders.length === 0 && (
              <p className="text-sm text-muted-foreground">No SSO providers available.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
