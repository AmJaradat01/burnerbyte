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
import { KeyRound, Link2, Monitor, Save, Shield, Trash2, Unlink } from "lucide-react";
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
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-48" /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
    </div>
  );

  const initials = user.display_name
    ? user.display_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase();

  const isSSO = !!user.sso_provider;

  return (
    <div className="space-y-6">
      {/* Identity row */}
      <div className="flex items-center gap-4">
        <Avatar className="h-14 w-14 text-lg">
          <AvatarImage src={user.avatar_url} alt={user.display_name} />
          <AvatarFallback className="bg-muted font-semibold text-muted-foreground">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-title truncate">{user.display_name || user.email}</h1>
            {user.is_system_admin && <Badge variant="secondary" className="text-[10px]">System Admin</Badge>}
            {user.email_verified && <Badge className="bg-success/10 text-success border-success/20 text-[10px] gap-1"><Shield className="h-2.5 w-2.5" />Verified</Badge>}
          </div>
          <p className="text-sm text-muted-foreground font-mono truncate">{user.email}</p>
        </div>
        <div className="hidden sm:block text-right text-xs text-muted-foreground shrink-0">
          <p>Joined {new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short" })}</p>
          {isSSO && <p className="mt-0.5">via {user.sso_provider}</p>}
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left */}
        <div className="space-y-6">
          <ProfileForm user={user} onSaved={fetchMe} />
          <DateTimeCard />
        </div>

        {/* Right */}
        <div className="space-y-6">
          {!isSSO ? <PasswordCard /> : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Password</CardTitle>
                <CardDescription>Managed by {user.sso_provider}. Change it through your identity provider.</CardDescription>
              </CardHeader>
            </Card>
          )}
          <ConnectedAccountsCard />
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Sessions</CardTitle>
              <CardDescription>Active login sessions across your devices.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/profile/sessions">
                <Button variant="outline" size="sm"><Monitor className="h-3.5 w-3.5 mr-1.5" />Manage Sessions</Button>
              </Link>
            </CardContent>
          </Card>

          {/* Danger zone */}
          <div className="rounded-xl border border-destructive/30 p-5">
            <p className="text-sm font-medium text-destructive">Delete Account</p>
            <p className="text-sm text-muted-foreground mt-1 mb-3">Permanently delete your account, inboxes, and all associated data. This cannot be undone.</p>
            <Link href="/profile/delete">
              <Button variant="destructive" size="sm"><Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete Account</Button>
            </Link>
          </div>
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
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Profile</CardTitle>
        <CardDescription>Your public identity across the platform.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-label">Email</Label>
          <Input id="email" value={user.email} disabled className="font-mono text-sm opacity-60" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="displayName" className="text-label">Display Name</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="avatar" className="text-label">Avatar URL</Label>
          <Input id="avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
          <p className="text-xs text-muted-foreground">Direct image link. Leave empty for initials.</p>
        </div>
        {dirty && (
          <Button onClick={handleSave} disabled={saving} size="sm"><Save className="h-3.5 w-3.5 mr-1.5" />{saving ? "Saving…" : "Save"}</Button>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
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
      toast.success("Password changed. Signing out…");
      setTimeout(() => logout(), 1500);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); setChanging(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Password</CardTitle>
        <CardDescription>Changing your password signs out all sessions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="currentPw" className="text-label">Current</Label>
          <Input id="currentPw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="newPw" className="text-label">New</Label>
          <Input id="newPw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          {newPassword.length > 0 && newPassword.length < 8 && <p className="text-xs text-destructive">Min 8 characters</p>}
          {newPassword.length >= 8 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-200 ${newPassword.length >= 12 ? "w-full bg-success" : newPassword.length >= 10 ? "w-2/3 bg-warning" : "w-1/3 bg-destructive/60"}`} />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums w-9">{newPassword.length >= 12 ? "Strong" : newPassword.length >= 10 ? "Fair" : "Weak"}</span>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPw" className="text-label">Confirm</Label>
          <Input id="confirmPw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          {mismatch && <p className="text-xs text-destructive">Does not match</p>}
        </div>
        <Button onClick={handleChange} disabled={changing || !valid} size="sm"><KeyRound className="h-3.5 w-3.5 mr-1.5" />{changing ? "Changing…" : "Update Password"}</Button>
      </CardContent>
    </Card>
  );
}

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Amman", "Asia/Dubai", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney",
];

function DateTimeCard() {
  const { settings } = useDateFormat();
  const qc = useQueryClient();
  const [tz, setTz] = useState(""); const [dateFmt, setDateFmt] = useState(""); const [timeFmt, setTimeFmt] = useState("");
  const [saving, setSaving] = useState(false); const [synced, setSynced] = useState("");

  const key = settings ? `${settings.timezone}-${settings.date_format}-${settings.time_format}` : "";
  if (key && key !== synced) { setTz(settings!.timezone); setDateFmt(settings!.date_format); setTimeFmt(settings!.time_format); setSynced(key); }

  const dirty = synced && (tz !== settings?.timezone || dateFmt !== settings?.date_format || timeFmt !== settings?.time_format);

  const save = async () => {
    setSaving(true);
    try { await api.patch("/auth/me", { timezone: tz, date_format: dateFmt, time_format: timeFmt }); qc.invalidateQueries({ queryKey: ["datetime-settings"] }); toast.success("Preferences saved"); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Date & Time</CardTitle>
        <CardDescription>Display preferences for timestamps across the app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-label">Timezone</Label>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-label">Date</Label>
            <Select value={dateFmt} onValueChange={setDateFmt}>
              <SelectTrigger><SelectValue placeholder="Format" /></SelectTrigger>
              <SelectContent><SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem><SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem><SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-label">Time</Label>
            <Select value={timeFmt} onValueChange={setTimeFmt}>
              <SelectTrigger><SelectValue placeholder="Format" /></SelectTrigger>
              <SelectContent><SelectItem value="24h">24-hour</SelectItem><SelectItem value="12h">12-hour</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        {dirty && <Button onClick={save} disabled={saving} size="sm"><Save className="h-3.5 w-3.5 mr-1.5" />{saving ? "Saving…" : "Save"}</Button>}
      </CardContent>
    </Card>
  );
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1";
interface SSOIdentity { id: string; provider: string; subject: string; email: string; display_name: string; linked_at: string; last_used_at: string; }
interface SSOStatusProvider { name: string; provider_type: string; label: string; enabled: boolean; }
interface SSOStatusResponse { enabled: boolean; providers?: SSOStatusProvider[]; enforce_sso?: boolean; }

function ConnectedAccountsCard() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const { data: identities, isLoading } = useQuery({ queryKey: ["sso-identities"], queryFn: () => api.get<SSOIdentity[]>("/auth/me/sso") });
  const { data: ssoStatus } = useQuery({ queryKey: ["sso-status"], queryFn: () => api.get<SSOStatusResponse>("/auth/sso-status"), staleTime: 60000 });

  const providers = (ssoStatus?.providers ?? []).filter((p) => p.enabled);
  const linkedProviders = new Set((identities ?? []).map((i) => i.provider));
  const unlinkedProviders = providers.filter((p) => !linkedProviders.has(p.name));
  const enforceSSO = ssoStatus?.enforce_sso ?? false;
  const hasPassword = user?.sso_provider === undefined || user?.sso_provider === null;

  const handleUnlink = async (provider: string) => {
    setUnlinking(provider);
    try { await api.del(`/auth/me/sso/${provider}`); qc.invalidateQueries({ queryKey: ["sso-identities"] }); toast.success(`${provider} unlinked`); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setUnlinking(null); }
  };

  if (!ssoStatus?.enabled || providers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Connected Accounts</CardTitle>
        <CardDescription>Linked identity providers for single sign-on.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : (
          <>
            {(identities ?? []).map((identity) => {
              const mp = providers.find((p) => p.name === identity.provider);
              return (
                <div key={identity.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <ProviderIcon providerType={mp?.provider_type ?? identity.provider} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{mp ? mp.label : providerTypeLabel(identity.provider)}</p>
                      <p className="text-xs text-muted-foreground truncate">{identity.email}</p>
                    </div>
                  </div>
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={unlinking === identity.provider || !hasPassword || enforceSSO} title={!hasPassword ? "Set a password first" : enforceSSO ? "SSO required" : "Unlink"}><Unlink className="h-3.5 w-3.5" /></Button>}
                    title="Unlink account?"
                    description={`Disconnect ${identity.provider}. You can re-link later.`}
                    onConfirm={() => handleUnlink(identity.provider)}
                  />
                </div>
              );
            })}
            {unlinkedProviders.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0 opacity-50">
                    <ProviderIcon providerType={p.provider_type} className="h-4 w-4" />
                  </div>
                  <p className="text-sm text-muted-foreground">{p.label}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { window.location.href = `${API_BASE}/auth/sso/${p.name}?intent=link`; }}><Link2 className="h-3.5 w-3.5 mr-1.5" />Link</Button>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
