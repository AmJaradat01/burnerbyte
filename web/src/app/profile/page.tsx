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
    const ssoError = params.get("sso_error");
    if (ssoError) {
      toast.error("Couldn't link account", { description: ssoError, duration: 8000 });
      window.history.replaceState(null, "", window.location.pathname);
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
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Profile hero */}
      <div className="relative rounded-2xl border overflow-hidden">
        {/* Decorative background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/3 to-transparent" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="relative">
              <Avatar className="h-24 w-24 text-2xl ring-4 ring-background shadow-lg">
                <AvatarImage src={user.avatar_url} alt={user.display_name} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold text-3xl">{initials}</AvatarFallback>
              </Avatar>
              {user.email_verified && (
                <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-success flex items-center justify-center ring-2 ring-background">
                  <Shield className="h-3 w-3 text-white" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight truncate">{user.display_name || "Unnamed"}</h1>
                {user.is_system_admin && <Badge className="bg-primary/10 text-primary border-primary/20 font-medium">System Admin</Badge>}
              </div>
              <p className="text-sm text-muted-foreground font-mono mt-1">{user.email}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {isSSO && (
                  <Badge variant="outline" className="gap-1.5 py-1">
                    <KeyRound className="h-3 w-3" /> Authenticated via {user.sso_provider}
                  </Badge>
                )}
                {user.auth_method_lock && (
                  <Badge variant="outline" className="gap-1.5 py-1 text-primary border-primary/30">
                    <Shield className="h-3 w-3" /> Locked to {user.auth_method_lock}
                  </Badge>
                )}
              </div>
            </div>
            <div className="hidden sm:block shrink-0">
              <div className="rounded-xl bg-background/80 backdrop-blur-sm border px-4 py-3 space-y-2 text-right">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Member since</p>
                  <p className="text-sm font-semibold">{new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
                </div>
                {user.last_login_at && (
                  <div className="pt-1 border-t border-border/50">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Last active</p>
                    <p className="text-xs font-medium">{new Date(user.last_login_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content grid */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left column — wider */}
        <div className="lg:col-span-3 space-y-6">
          <ProfileForm user={user} onSaved={fetchMe} />
          <DateTimePreferencesCard />
        </div>

        {/* Right column — narrower */}
        <div className="lg:col-span-2 space-y-6">
          {!isSSO ? <ChangePasswordForm /> : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  Password
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Managed by your identity provider ({user.sso_provider}).</p>
              </CardContent>
            </Card>
          )}

          <ConnectedAccountsCard />

          {/* Sessions & danger */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                Account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/profile/sessions" className="group block">
                <div className="flex items-center gap-3 rounded-xl border p-3.5 transition-all hover:bg-muted/50 hover:border-primary/20 hover:shadow-sm">
                  <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0 transition-colors group-hover:bg-primary/10">
                    <Monitor className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Active Sessions</p>
                    <p className="text-xs text-muted-foreground">View devices and revoke access</p>
                  </div>
                </div>
              </Link>
              <Link href="/profile/delete" className="group block">
                <div className="flex items-center gap-3 rounded-xl border border-destructive/20 p-3.5 transition-all hover:bg-destructive/5 hover:border-destructive/40 hover:shadow-sm">
                  <div className="h-9 w-9 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-destructive">Delete Account</p>
                    <p className="text-xs text-muted-foreground">Permanently remove all your data</p>
                  </div>
                </div>
              </Link>
            </CardContent>
          </Card>
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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          Account Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
          <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="text-sm font-mono truncate">{user.email}</p>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">Read-only</Badge>
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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          Change Password
        </CardTitle>
        <CardDescription>You&apos;ll be signed out of all sessions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="currentPw">Current Password</Label>
          <Input id="currentPw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="space-y-2">
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
        <div className="space-y-2">
          <Label htmlFor="confirmPw">Confirm New Password</Label>
          <Input id="confirmPw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          {mismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
        </div>
        <Button onClick={handleChange} disabled={changing || !valid} className="w-full gap-2">
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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Date & Time
        </CardTitle>
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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          Connected Accounts
        </CardTitle>
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
