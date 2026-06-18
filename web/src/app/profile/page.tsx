"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
    <div className="mx-auto max-w-2xl py-8 space-y-8">
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-56" /></div>
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-6">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    </div>
  );

  const initials = user.display_name
    ? user.display_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user.email[0].toUpperCase();

  const isSSO = !!user.sso_provider;

  return (
    <div className="mx-auto max-w-2xl py-2">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account settings and preferences.</p>
      </div>

      {/* Profile identity */}
      <section className="pb-8 mb-8 border-b">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar className="h-16 w-16 text-xl">
              <AvatarImage src={user.avatar_url} alt={user.display_name} />
              <AvatarFallback className="bg-primary/8 text-primary font-semibold">{initials}</AvatarFallback>
            </Avatar>
            {user.email_verified && (
              <div className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-success flex items-center justify-center ring-2 ring-background">
                <Shield className="h-2.5 w-2.5 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-lg font-semibold truncate">{user.display_name || "Unnamed"}</p>
              {user.is_system_admin && <Badge className="bg-primary/8 text-primary border-primary/20 text-[10px] font-medium">Admin</Badge>}
            </div>
            <p className="text-sm text-muted-foreground font-mono">{user.email}</p>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
              <span>Joined {new Date(user.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short" })}</span>
              {isSSO && <span className="flex items-center gap-1"><KeyRound className="h-3 w-3" />{user.sso_provider}</span>}
            </div>
          </div>
        </div>
      </section>

      {/* Profile details */}
      <section className="pb-8 mb-8 border-b">
        <h2 className="text-sm font-semibold mb-5">Profile Details</h2>
        <ProfileForm user={user} onSaved={fetchMe} />
      </section>

      {/* Security */}
      <section className="pb-8 mb-8 border-b">
        <h2 className="text-sm font-semibold mb-5">Security</h2>
        {!isSSO ? (
          <ChangePasswordForm />
        ) : (
          <p className="text-sm text-muted-foreground">Your password is managed by your identity provider ({user.sso_provider}).</p>
        )}
        <div className="mt-6">
          <ConnectedAccountsSection />
        </div>
      </section>

      {/* Preferences */}
      <section className="pb-8 mb-8 border-b">
        <h2 className="text-sm font-semibold mb-5">Preferences</h2>
        <DateTimePreferences />
      </section>

      {/* Sessions */}
      <section className="pb-8 mb-8 border-b">
        <h2 className="text-sm font-semibold mb-2">Sessions</h2>
        <p className="text-sm text-muted-foreground mb-4">Manage your active login sessions across devices.</p>
        <Link href="/profile/sessions">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Monitor className="h-3.5 w-3.5" /> Manage Sessions
          </Button>
        </Link>
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-destructive/20 bg-destructive/[0.02] p-5">
        <h2 className="text-sm font-semibold text-destructive">Delete Account</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          Permanently remove your account and all associated data. This action cannot be undone.
        </p>
        <Link href="/profile/delete">
          <Button variant="destructive" size="sm" className="gap-1.5">
            <Trash2 className="h-3.5 w-3.5" /> Delete Account
          </Button>
        </Link>
      </section>
    </div>
  );
}

/* ─── Profile Form ─── */

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
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-sm font-medium text-muted-foreground">Email</Label>
        <Input id="email" value={user.email} disabled className="max-w-md bg-muted/30 font-mono text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="displayName" className="text-sm font-medium">Display Name</Label>
        <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" className="max-w-md" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="avatar" className="text-sm font-medium">Avatar URL</Label>
        <Input id="avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://example.com/avatar.png" className="max-w-md" />
        <p className="text-xs text-muted-foreground">Direct link to an image. Leave empty for initials.</p>
      </div>
      {dirty && (
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save Changes"}
        </Button>
      )}
    </div>
  );
}

/* ─── Change Password ─── */

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
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="currentPw" className="text-sm font-medium">Current Password</Label>
        <Input id="currentPw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" className="max-w-md" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="newPw" className="text-sm font-medium">New Password</Label>
        <Input id="newPw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" className="max-w-md" />
        {newPassword.length > 0 && newPassword.length < 8 && (
          <p className="text-xs text-destructive">Must be at least 8 characters</p>
        )}
        {newPassword.length >= 8 && (
          <div className="flex items-center gap-2 max-w-md">
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all ${newPassword.length >= 12 ? "w-full bg-success" : newPassword.length >= 10 ? "w-2/3 bg-warning" : "w-1/3 bg-destructive/60"}`} />
            </div>
            <span className="text-[10px] text-muted-foreground">{newPassword.length >= 12 ? "Strong" : newPassword.length >= 10 ? "Fair" : "Weak"}</span>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPw" className="text-sm font-medium">Confirm New Password</Label>
        <Input id="confirmPw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" className="max-w-md" />
        {mismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
      </div>
      <div className="pt-1">
        <Button onClick={handleChange} disabled={changing || !valid} size="sm" className="gap-2">
          <KeyRound className="h-3.5 w-3.5" />
          {changing ? "Changing…" : "Change Password"}
        </Button>
        <p className="text-xs text-muted-foreground mt-2">You&apos;ll be signed out of all sessions.</p>
      </div>
    </div>
  );
}

/* ─── Date & Time Preferences ─── */

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris",
  "Asia/Amman", "Asia/Dubai", "Asia/Tokyo", "Asia/Shanghai",
  "Australia/Sydney",
];

function DateTimePreferences() {
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
      toast.success("Preferences saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Timezone</Label>
        <Select value={tz} onValueChange={setTz}>
          <SelectTrigger className="max-w-md"><SelectValue placeholder="Select timezone" /></SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Date Format</Label>
          <Select value={dateFmt} onValueChange={setDateFmt}>
            <SelectTrigger><SelectValue placeholder="Format" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
              <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Time Format</Label>
          <Select value={timeFmt} onValueChange={setTimeFmt}>
            <SelectTrigger><SelectValue placeholder="Format" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24-hour</SelectItem>
              <SelectItem value="12h">12-hour</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {dirty && (
        <Button onClick={save} disabled={saving} size="sm" className="gap-2">
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save Preferences"}
        </Button>
      )}
    </div>
  );
}

/* ─── Connected Accounts ─── */

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

function ConnectedAccountsSection() {
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
    <div>
      <h3 className="text-sm font-medium mb-3">Connected Accounts</h3>
      {identitiesLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="h-8 w-8 rounded-md" />
              <div className="space-y-1"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-40" /></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(identities ?? []).map((identity) => {
            const matchingProvider = providers.find((p) => p.name === identity.provider);
            return (
              <div key={identity.id} className="flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg transition-colors hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <ProviderIcon providerType={matchingProvider?.provider_type ?? identity.provider} className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{matchingProvider ? matchingProvider.label : providerTypeLabel(identity.provider)}</p>
                    <p className="text-xs text-muted-foreground">{identity.email}</p>
                  </div>
                </div>
                <ConfirmDialog
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground hover:text-destructive"
                      disabled={unlinking === identity.provider || !hasPassword || enforceSSO}
                      title={!hasPassword ? "Set a password first" : enforceSSO ? "SSO required by organization" : "Unlink account"}
                    >
                      <Unlink className="h-3.5 w-3.5" />
                      Unlink
                    </Button>
                  }
                  title="Unlink SSO account?"
                  description={`This will disconnect your ${identity.provider} account. You can re-link it later.`}
                  onConfirm={() => handleUnlink(identity.provider)}
                />
              </div>
            );
          })}

          {unlinkedProviders.map((p) => (
            <div key={p.name} className="flex items-center justify-between py-2.5 px-3 -mx-3 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0 opacity-50">
                  <ProviderIcon providerType={p.provider_type} className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{p.label}</p>
                  <p className="text-xs text-muted-foreground">Not connected</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleLink(p.name)}>
                <Link2 className="h-3.5 w-3.5" /> Link
              </Button>
            </div>
          ))}

          {(identities ?? []).length === 0 && unlinkedProviders.length === 0 && (
            <p className="text-sm text-muted-foreground">No SSO providers configured.</p>
          )}
        </div>
      )}
    </div>
  );
}
