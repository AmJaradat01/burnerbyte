"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Clock, KeyRound, Link2, Monitor, Save, Shield, Trash2, Unlink, UserRound } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDateFormat } from "@/hooks/use-date-format";
import { ProviderIcon, providerTypeLabel } from "@/components/provider-icon";

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
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0" aria-hidden="true">
          <UserRound className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h1 className="text-headline">Profile</h1>
          <p className="text-sm text-muted-foreground">Manage your account settings and preferences.</p>
        </div>
      </header>

      {/* Identity banner */}
      <Card>
        <CardContent className="pt-6 pb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <Avatar className="h-20 w-20 text-xl ring-4 ring-background">
              <AvatarImage src={user.avatar_url} alt={user.display_name} />
              <AvatarFallback className="bg-muted text-muted-foreground font-bold">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 pt-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xl font-bold truncate">{user.display_name || "Unnamed"}</p>
                {user.is_system_admin && <Badge variant="secondary">Admin</Badge>}
              </div>
              <p className="text-sm text-muted-foreground font-mono truncate">{user.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {user.email_verified ? (
                  <Badge className="bg-success/10 text-success border-success/20 gap-1"><Shield className="h-3 w-3" /> Verified</Badge>
                ) : (
                  <Badge className="bg-warning/10 text-warning border-warning/20 gap-1">Unverified</Badge>
                )}
                {isSSO && <Badge variant="outline" className="gap-1"><KeyRound className="h-3 w-3" /> SSO via {user.sso_provider}</Badge>}
                {user.auth_method_lock && <Badge variant="outline" className="gap-1 text-primary border-primary/20"><Shield className="h-3 w-3" /> Locked to {user.auth_method_lock}</Badge>}
              </div>
            </div>
            <div className="hidden sm:block text-right shrink-0">
              <p className="text-xs text-muted-foreground">Member since</p>
              <p className="text-sm font-medium">{new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
              {user.last_login_at && <p className="text-xs text-muted-foreground mt-1">Last login {new Date(user.last_login_at).toLocaleDateString()}</p>}
            </div>
          </div>
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
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
                  <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                Account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/profile/sessions" className="block">
                <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <Monitor className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Manage Sessions</p>
                      <p className="text-xs text-muted-foreground">View and revoke active sessions</p>
                    </div>
                  </div>
                </div>
              </Link>
              <Link href="/profile/delete" className="block">
                <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-3 transition-colors hover:bg-destructive/5">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-destructive">Delete Account</p>
                      <p className="text-xs text-muted-foreground">Permanently remove your account</p>
                    </div>
                  </div>
                </div>
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
                    <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  Password
                </CardTitle>
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
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          Account Details
        </CardTitle>
        <CardDescription>Update your display name and avatar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Shield className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <p className="text-sm font-mono">{user.email}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">Read-only</Badge>
        </div>
        <div className="rounded-lg border p-3 space-y-2">
          <Label htmlFor="displayName">Display Name</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="rounded-lg border p-3 space-y-2">
          <Label htmlFor="avatar">Avatar URL</Label>
          <Input id="avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://example.com/avatar.png" />
          <p className="text-xs text-muted-foreground">Direct link to an image. Leave empty to use initials.</p>
        </div>
        {dirty && (
          <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        )}
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
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          Change Password
        </CardTitle>
        <CardDescription>You will be signed out of all sessions after changing your password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border p-3 space-y-2">
          <Label htmlFor="currentPw">Current Password</Label>
          <Input id="currentPw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="rounded-lg border p-3 space-y-2">
          <Label htmlFor="newPw">New Password</Label>
          <Input id="newPw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          {newPassword.length > 0 && newPassword.length < 8 && (
            <p className="text-xs text-destructive">Must be at least 8 characters</p>
          )}
          {newPassword.length >= 8 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all ${newPassword.length >= 12 ? "w-full bg-success" : newPassword.length >= 10 ? "w-2/3 bg-warning/50" : "w-1/3 bg-destructive/50"}`} />
              </div>
              <span className="text-[10px] text-muted-foreground">{newPassword.length >= 12 ? "Strong" : newPassword.length >= 10 ? "Medium" : "Weak"}</span>
            </div>
          )}
        </div>
        <div className="rounded-lg border p-3 space-y-2">
          <Label htmlFor="confirmPw">Confirm New Password</Label>
          <Input id="confirmPw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          {mismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
        </div>
        <Button onClick={handleChange} disabled={changing || !valid} className="w-full gap-2" variant={valid ? "default" : "outline"}>
          <KeyRound className="h-4 w-4" />
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
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          Date & Time Preferences
        </CardTitle>
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
        <div className="grid grid-cols-2 gap-3">
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
        </div>
        {dirty && (
          <Button onClick={save} disabled={saving} className="w-full gap-2">
            <Clock className="h-4 w-4" />
            {saving ? "Saving…" : "Save Preferences"}
          </Button>
        )}
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
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          Connected Accounts
        </CardTitle>
        <CardDescription>Manage your linked SSO identities.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {identitiesLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                <Skeleton className="h-8 w-8 rounded-md shrink-0" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {(identities ?? []).map((identity) => {
              const matchingProvider = providers.find((p) => p.name === identity.provider);
              return (
              <div key={identity.id} className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <ProviderIcon providerType={matchingProvider?.provider_type ?? identity.provider} className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{matchingProvider ? matchingProvider.label : providerTypeLabel(identity.provider)}</p>
                    <p className="text-xs text-muted-foreground">{identity.email}</p>
                    <p className="text-xs text-muted-foreground">Linked {new Date(identity.linked_at).toLocaleDateString()}</p>
                  </div>
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
              );
            })}

            {unlinkedProviders.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border border-dashed p-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0 opacity-60">
                    <ProviderIcon providerType={p.provider_type} className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground">Not connected</p>
                  </div>
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
