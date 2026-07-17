"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { NoOrgState } from "@/components/no-org-state";
import { validateSSOProviderForm, ssoSummaryStats } from "@/lib/sso";
import { EmptyState } from "@/components/empty-state";
import { copyToClipboard } from "@/lib/clipboard";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, Check, CheckCircle2, Clock, Copy, Database, HardDrive, Key, Loader2, Lock, Mail, Monitor, Paperclip, Pencil, Play, Plus, Save, Search, Settings, Shield, Trash2, Users, XCircle } from "lucide-react";
import Link from "next/link";
import { UnifiedUsersTab } from "@/components/settings/unified-users-tab";
import { RolesTab } from "@/components/settings/roles-tab";
import { useRoles } from "@/hooks/use-roles";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ProviderIcon, providerTypeLabel } from "@/components/provider-icon";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Organization, OrgSettings, SystemStats } from "@/types";

export default function SettingsPage() {
  const { currentOrg, fetchOrgs, hasPermission } = useOrgStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = hasPermission("org.settings.manage") || user?.is_system_admin;
  if (!isAdmin) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access settings.</p></div>;

  const isSysAdmin = user?.is_system_admin ?? false;
  // Org-scoped settings (General, Users) need an organization; platform settings
  // (Roles, SSO, System) do not, so a system admin can manage the platform with
  // no org of their own.
  if (!currentOrg && !isSysAdmin) return <NoOrgState />;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0" aria-hidden="true">
          <Settings className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h1 className="text-headline">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your organization, members, and system configuration.</p>
        </div>
      </header>
      <Tabs defaultValue={currentOrg ? "general" : "overview"}>
        <TabsList className="flex-wrap">
          {currentOrg && <TabsTrigger value="general" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> General</TabsTrigger>}
          {currentOrg && <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Users</TabsTrigger>}
          {isSysAdmin && <>
            {currentOrg && <div className="mx-1 h-4 w-px bg-border self-center" />}
            <TabsTrigger value="roles" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Roles</TabsTrigger>
            <TabsTrigger value="sso" className="gap-1.5"><Key className="h-3.5 w-3.5" /> SSO</TabsTrigger>
            <TabsTrigger value="overview" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> System</TabsTrigger>
          </>}
        </TabsList>
        {currentOrg && <TabsContent value="general"><GeneralTab org={currentOrg} onSaved={fetchOrgs} /></TabsContent>}
        {currentOrg && <TabsContent value="users"><UnifiedUsersTab orgId={currentOrg.id} /></TabsContent>}
        {isSysAdmin && <TabsContent value="roles"><RolesTab /></TabsContent>}
        {isSysAdmin && <TabsContent value="sso"><SSOProvidersTab /></TabsContent>}
        {isSysAdmin && <TabsContent value="overview"><OverviewTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

function GeneralTab({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const [name, setName] = useState(org.name);
  const [logoUrl, setLogoUrl] = useState(org.logo_url ?? "");
  const [settings, setSettings] = useState<OrgSettings>(org.settings || {});
  const [saving, setSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Re-sync local state when org refreshes after save
  useEffect(() => {
    setName(org.name);
    setLogoUrl(org.logo_url ?? "");
    setSettings(org.settings || {});
  }, [org.id, org.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = name !== org.name || logoUrl !== (org.logo_url ?? "") || JSON.stringify(settings) !== JSON.stringify(org.settings || {});

  // Autosave with 2-second debounce
  useEffect(() => {
    if (!dirty) { setAutoSaveStatus("idle"); return; }
    setAutoSaveStatus("idle");
    const timeout = setTimeout(async () => {
      setAutoSaveStatus("saving");
      try {
        await api.patch(`/orgs/${org.id}`, { name, logo_url: logoUrl || undefined });
        await api.put(`/orgs/${org.id}/settings`, settings);
        onSaved();
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus("idle"), 2000);
      } catch {
        setAutoSaveStatus("idle");
      }
    }, 2000);
    return () => clearTimeout(timeout);
  }, [dirty, name, logoUrl, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/orgs/${org.id}`, { name, logo_url: logoUrl || undefined });
      await api.put(`/orgs/${org.id}/settings`, settings);
      onSaved();
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof OrgSettings>(key: K, val: OrgSettings[K]) => setSettings({ ...settings, [key]: val });

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          {/* Org identity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                </div>
                Organization
              </CardTitle>
              <CardDescription>Name and branding for your org.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 pb-2">
                {logoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={logoUrl} alt="" className="h-14 w-14 rounded-lg border object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-xl font-bold text-muted-foreground">
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="font-semibold">{name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{org.slug}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Created {new Date(org.created_at).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input value={org.slug} disabled className="bg-muted font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Logo URL</Label>
                <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
              </div>
            </CardContent>
          </Card>


        </div>

        <div className="space-y-6">
          {/* Policies */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                </div>
                Organization Policies
              </CardTitle>
              <CardDescription>Security and feature policies for this organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-3 transition-colors duration-150 hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <Label>Attachments enabled</Label>
                    <p className="text-xs text-muted-foreground">Allow file attachments on emails</p>
                  </div>
                </div>
                <Switch checked={settings.attachments_enabled ?? true} onCheckedChange={(v) => set("attachments_enabled", v)} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3 transition-colors duration-150 hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <Label>Enforce SSO</Label>
                    <p className="text-xs text-muted-foreground">Require SSO for all members</p>
                  </div>
                </div>
                <Switch checked={settings.enforce_sso ?? false} onCheckedChange={(v) => {
                  if (v) { toast.warning("Make sure SSO is configured before enforcing — members won't be able to sign in with passwords.", { duration: 6000 }); }
                  set("enforce_sso", v);
                }} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3 transition-colors duration-150 hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <Label>Default Inbox TTL</Label>
                    <p className="text-xs text-muted-foreground">Override platform default for this org</p>
                  </div>
                </div>
                <Input value={settings.default_inbox_ttl ?? ""} onChange={(e) => set("default_inbox_ttl", e.target.value)} placeholder="1h" className="h-8 w-24 text-xs text-right font-mono" />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3 transition-colors duration-150 hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <Label>Max Inbox TTL</Label>
                    <p className="text-xs text-muted-foreground">Maximum inbox lifetime for this org</p>
                  </div>
                </div>
                <Input value={settings.max_inbox_ttl ?? ""} onChange={(e) => set("max_inbox_ttl", e.target.value)} placeholder="24h" className="h-8 w-24 text-xs text-right font-mono" />
              </div>
            </CardContent>
          </Card>

          <DangerZone org={org} onDeleted={onSaved} />
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-4 flex items-center justify-end gap-3">
          {autoSaveStatus === "saving" && <span className="text-xs text-muted-foreground" role="status">Saving…</span>}
          {autoSaveStatus === "saved" && (
            <span className="flex items-center gap-1 text-xs text-success" role="status">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Saved
            </span>
          )}
          <Button onClick={save} disabled={saving} size="lg" className="gap-2">
            <Save className="h-4 w-4" aria-hidden="true" />
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      )}
    </div>
  );
}

function DangerZone({ org, onDeleted }: { org: Organization; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const user = useAuthStore((s) => s.user);
  const isSSO = !!user?.sso_provider;

  const reset = () => { setConfirm(""); setPassword(""); setError(""); };

  const handleDelete = async () => {
    if (confirm !== org.name) { setError("Organization name does not match."); return; }
    if (!isSSO && !password) { setError("Password is required."); return; }
    setError("");
    setDeleting(true);
    try {
      await api.del(`/orgs/${org.id}`, { password: isSSO ? "" : password });
      toast.success("Organization deleted");
      setOpen(false);
      onDeleted();
      window.location.href = "/dashboard";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete organization";
      setError(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-destructive">
          <div className="h-7 w-7 rounded-md bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          Danger Zone
        </CardTitle>
        <CardDescription>Permanently delete this organization and all its data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-sm text-muted-foreground">This removes all teams, domains, inboxes, emails, and members. This action cannot be undone.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
          <DialogTrigger asChild>
            <Button variant="destructive" className="gap-1.5">
              <Trash2 className="h-4 w-4" /> Delete Organization
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" /> Delete &quot;{org.name}&quot;
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                <p className="text-sm text-muted-foreground">
                  This will <strong>permanently delete</strong> the organization <strong>{org.name}</strong> and all associated data including teams, domains, inboxes, emails, webhooks, API keys, and audit logs. This action cannot be undone.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dz-confirm" className="text-sm">Type <span className="font-mono font-semibold">{org.name}</span> to confirm</Label>
                <Input id="dz-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={org.name} autoComplete="off" />
              </div>
              {!isSSO && (
                <div className="space-y-2">
                  <Label htmlFor="dz-password" className="text-sm">Enter your password</Label>
                  <Input id="dz-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your account password" autoComplete="current-password" />
                </div>
              )}
              {isSSO && (
                <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">
                  You&apos;re signed in via {user?.sso_provider}. No password required — confirm by typing the organization name above.
                </p>
              )}
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setOpen(false); reset(); }} disabled={deleting}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete} disabled={confirm !== org.name || (!isSSO && !password) || deleting} className="gap-1.5">
                  <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete Organization"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// SectionHeading is the one section-header vocabulary for the System tab: an
// icon chip, a title, and an optional description, rendered as the card's
// CardHeader. Every section uses it so the tab reads as one governance surface
// rather than a stack of differently-headed cards.
function SectionHeading({ icon: Icon, title, description }: { icon: typeof Database; title: string; description?: string }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        {title}
      </CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
    </CardHeader>
  );
}

function OverviewTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<SystemStats>("/admin/stats"),
    staleTime: 60_000,
  });

  if (isError) return <ErrorState message="Failed to load stats" onRetry={() => refetch()} />;
  if (isLoading) return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-10" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card><CardContent className="pt-6"><Skeleton className="h-40 w-full" /></CardContent></Card>
    </div>
  );
  if (!data) return null;

  const stats: { label: string; value: string; href?: string }[] = [
    { label: "Users", value: data.total_users.toLocaleString() },
    { label: "Teams", value: (data.total_teams ?? 0).toLocaleString(), href: "/teams" },
    { label: "Domains", value: data.total_domains.toLocaleString(), href: "/domains" },
    { label: "Active Inboxes", value: (data.active_inboxes ?? 0).toLocaleString(), href: "/" },
    { label: "Total Created", value: (data.total_inboxes_created ?? 0).toLocaleString() },
    { label: "Total Emails", value: data.total_emails.toLocaleString(), href: "/analytics" },
    { label: "Storage", value: formatBytes(data.storage_used_bytes ?? 0) },
    { label: "Active Sessions", value: (data.total_sessions ?? 0).toLocaleString(), href: "/profile/sessions" },
    { label: "Webhooks", value: (data.total_webhooks ?? 0).toLocaleString() },
    { label: "API Keys", value: (data.total_api_keys ?? 0).toLocaleString() },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeading icon={Activity} title="Platform overview" />
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3">
            {stats.map((s) => (
              <div key={s.label} className="flex items-baseline justify-between gap-2">
                {s.href ? (
                  <Link href={s.href} className="text-xs text-muted-foreground hover:underline">{s.label}</Link>
                ) : (
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                )}
                <span className="text-sm font-medium tabular-nums">{s.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <PlatformSettingsCard />
      <HealthSection />
      <MailerConfigSection />
      <StorageConfigSection />
    </div>
  );
}

function PlatformSettingsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-platform"],
    queryFn: () => api.get<{
      allow_registration: boolean; email_verification: boolean;
      password_min_length: number; password_require_upper: boolean; password_require_lower: boolean;
      password_require_number: boolean; password_require_special: boolean;
      lockout_max_attempts: number; lockout_duration_mins: number;
      timezone: string; date_format: string; time_format: string;
      default_inbox_ttl: string; max_inbox_ttl: string;
      max_attachment_size_mb: number; max_domains: number; max_teams: number; max_inboxes_per_domain: number;
      max_sessions_per_user: number;
      demo_enabled: boolean;
      demo_configured: boolean;
    }>("/admin/platform"),
    staleTime: 300_000,
  });
  const qc = useQueryClient();
  const [form, setForm] = useState({
    allow_registration: true, email_verification: true,
    password_min_length: 8, password_require_upper: true, password_require_lower: true,
    password_require_number: true, password_require_special: true,
    lockout_max_attempts: 5, lockout_duration_mins: 15,
    timezone: "UTC", date_format: "YYYY-MM-DD", time_format: "24h",
    default_inbox_ttl: "", max_inbox_ttl: "",
    max_attachment_size_mb: 0, max_domains: 0, max_teams: 0, max_inboxes_per_domain: 0,
    max_sessions_per_user: 5,
    demo_enabled: false,
  });
  const [saving, setSaving] = useState(false);

  // Sync form when data loads or refreshes
  useEffect(() => { if (data) setForm(data); }, [data]);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/platform", form);
      qc.invalidateQueries({ queryKey: ["admin-platform"] });
      toast.success("Platform settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Card><CardContent className="pt-6"><Skeleton className="h-40 w-full" /></CardContent></Card>;

  return (
    <Card>
      <SectionHeading icon={Settings} title="Platform Settings" description="Control access, security, and authentication policies." />
      <CardContent className="space-y-6">
        {/* Access */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Access</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3 transition-colors duration-150 hover:bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <Label>Allow public registration</Label>
                <p className="text-xs text-muted-foreground">When disabled, only invited users can join.</p>
              </div>
            </div>
            <Switch checked={form.allow_registration} onCheckedChange={(v) => set("allow_registration", v)} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3 transition-colors duration-150 hover:bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <Label>Require email verification</Label>
                <p className="text-xs text-muted-foreground">New users must verify their email before accessing the platform.</p>
              </div>
            </div>
            <Switch checked={form.email_verification} onCheckedChange={(v) => set("email_verification", v)} />
          </div>
        </div>

        {/* Password policy */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
              <Key className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Password Policy</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Min length</Label>
                <Input type="number" min={6} max={128} value={form.password_min_length} onChange={(e) => set("password_min_length", Number(e.target.value) || 8)} className="h-8" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between rounded-md border px-3 py-2 transition-colors duration-150 hover:bg-muted/50"><Label className="text-xs">Uppercase</Label><Switch checked={form.password_require_upper} onCheckedChange={(v) => set("password_require_upper", v)} /></div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2 transition-colors duration-150 hover:bg-muted/50"><Label className="text-xs">Lowercase</Label><Switch checked={form.password_require_lower} onCheckedChange={(v) => set("password_require_lower", v)} /></div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2 transition-colors duration-150 hover:bg-muted/50"><Label className="text-xs">Number</Label><Switch checked={form.password_require_number} onCheckedChange={(v) => set("password_require_number", v)} /></div>
              <div className="flex items-center justify-between rounded-md border px-3 py-2 transition-colors duration-150 hover:bg-muted/50"><Label className="text-xs">Special char</Label><Switch checked={form.password_require_special} onCheckedChange={(v) => set("password_require_special", v)} /></div>
            </div>
          </div>
        </div>

        {/* Lockout */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Account Lockout</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Max failed attempts</Label>
                <Input type="number" min={1} max={50} value={form.lockout_max_attempts} onChange={(e) => set("lockout_max_attempts", Number(e.target.value) || 5)} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Lockout duration (min)</Label>
                <Input type="number" min={1} max={1440} value={form.lockout_duration_mins} onChange={(e) => set("lockout_duration_mins", Number(e.target.value) || 15)} className="h-8" />
              </div>
            </div>
          </div>
        </div>

        {/* Date & Time */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Date & Time Defaults</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Timezone</Label>
              <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["UTC","America/New_York","America/Chicago","America/Denver","America/Los_Angeles","Europe/London","Europe/Berlin","Europe/Paris","Asia/Amman","Asia/Dubai","Asia/Tokyo","Asia/Shanghai","Australia/Sydney"].map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date Format</Label>
                <Select value={form.date_format} onValueChange={(v) => set("date_format", v)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                    <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Time Format</Label>
                <Select value={form.time_format} onValueChange={(v) => set("time_format", v)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">24-hour</SelectItem>
                    <SelectItem value="12h">12-hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Quotas & Limits */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Quotas & Limits</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Default inbox TTL</Label>
                <Input value={form.default_inbox_ttl} onChange={(e) => set("default_inbox_ttl", e.target.value)} placeholder="1h" className="h-8 font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max inbox TTL</Label>
                <Input value={form.max_inbox_ttl} onChange={(e) => set("max_inbox_ttl", e.target.value)} placeholder="24h" className="h-8 font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max attachment (MB)</Label>
                <Input type="number" min={0} value={form.max_attachment_size_mb} onChange={(e) => set("max_attachment_size_mb", Number(e.target.value) || 0)} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max domains</Label>
                <Input type="number" min={0} value={form.max_domains} onChange={(e) => set("max_domains", Number(e.target.value) || 0)} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max teams</Label>
                <Input type="number" min={0} value={form.max_teams} onChange={(e) => set("max_teams", Number(e.target.value) || 0)} className="h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max inboxes/domain</Label>
                <Input type="number" min={0} value={form.max_inboxes_per_domain} onChange={(e) => set("max_inboxes_per_domain", Number(e.target.value) || 0)} className="h-8" />
              </div>
            </div>
          </div>
        </div>

        {/* Session Limits */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
              <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Session Limits</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Max sessions per user</Label>
                <Input type="number" min={1} max={100} value={form.max_sessions_per_user} onChange={(e) => set("max_sessions_per_user", Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="h-8" />
              </div>
            </div>
          </div>
        </div>

        {/* Demo Mode */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-muted flex items-center justify-center">
              <Play className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold">Demo Mode</p>
          </div>
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="demo-toggle" className="text-sm font-medium">Enable public demo</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Shows a live inbox on the landing page and <code className="font-mono text-[11px] bg-muted px-1 rounded">/try</code> route. Visitors can see incoming emails without signing in.</p>
              </div>
              <Switch id="demo-toggle" checked={form.demo_enabled} onCheckedChange={(v) => set("demo_enabled", v)} />
            </div>
            {form.demo_enabled && data && !data.demo_configured && (
              <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-medium text-foreground">Configuration required</p>
                  <p className="text-muted-foreground">Set <code className="font-mono bg-muted px-1 rounded">DEMO_ASSIGNMENT_ID</code> and <code className="font-mono bg-muted px-1 rounded">DEMO_USER_ID</code> in your environment or config file. The demo will remain inactive until both values are provided.</p>
                </div>
              </div>
            )}
            {form.demo_enabled && data?.demo_configured && (
              <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                <span className="text-muted-foreground">Demo is configured and active. Visitors can access it at <code className="font-mono bg-muted px-1 rounded">/try</code>.</span>
              </div>
            )}
          </div>
        </div>

        <div className="border-t pt-5 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Changes take effect immediately after save.</p>
          <Button onClick={save} disabled={saving} size="sm" className="gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save Platform Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const SERVICE_ICONS: Record<string, typeof Database> = {
  postgres: Database,
  redis: Database,
  storage: HardDrive,
  minio: HardDrive,
};

interface HealthResponse {
  services: Record<string, { status: string; latency: string }>;
  uptime: string;
}

function HealthSection() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-health"],
    queryFn: () => api.get<HealthResponse>("/admin/health"),
    refetchInterval: 15000,
  });

  if (isError) return <ErrorState message="Failed to check health" onRetry={() => refetch()} />;

  // Support both new { services, uptime } and legacy flat { postgres: "ok" } formats
  let services: [string, { status: string; latency: string }][] = [];
  let uptime = "";
  if (data) {
    if (data.services && typeof data.services === "object") {
      services = Object.entries(data.services);
      uptime = data.uptime ?? "";
    } else {
      // Legacy flat format
      services = Object.entries(data)
        .filter(([k]) => k !== "services" && k !== "uptime")
        .map(([k, v]) => [k, { status: String(v), latency: "—" }]);
    }
  }

  const allHealthy = services.every(([, s]) => s.status === "ok");

  return (
    <Card>
      <SectionHeading icon={Monitor} title="Service health" description="Auto-refreshing every 15 seconds" />
      <CardContent>
        {services.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2 text-sm">
              {allHealthy
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                : <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
              <span className="font-medium">{allHealthy ? "All systems operational" : "Service degradation detected"}</span>
              {uptime && <span className="text-xs text-muted-foreground">· up {uptime}</span>}
            </div>
            <Badge variant={allHealthy ? "success" : "destructive"} className="gap-1">
              {allHealthy ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {services.filter(([, s]) => s.status === "ok").length}/{services.length} healthy
            </Badge>
          </div>
        )}
        <div className="divide-y divide-border">
          {isLoading && services.length === 0 ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="h-8 w-8 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))
          ) : services.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No services detected</p>
          ) : (
            services.map(([name, svc]) => {
              const ok = svc.status === "ok";
              const Icon = SERVICE_ICONS[name] ?? Database;
              return (
                <div key={name} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium capitalize">{name}</p>
                      <p className={`truncate text-xs ${ok ? "text-muted-foreground" : "text-destructive"}`}>{ok ? "Connected" : svc.status}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{svc.latency}</span>
                    {ok
                      ? <CheckCircle2 className="h-4 w-4 text-success" />
                      : <XCircle className="h-4 w-4 text-destructive" />}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface SmtpTestResult {
  success: boolean;
  message: string;
  response_time?: string;
}

interface MailerConfig {
  host: string;
  port: number;
  username: string;
  from: string;
  tls: boolean;
  has_password: boolean;
}

// MailerConfigSection edits the outbound SMTP settings at runtime. Saving
// persists to the database (password encrypted) and hot-reloads the live mailer,
// so changes take effect without a restart. "Test connection" dials the
// currently saved config; save before testing edits. The password is never
// returned by the API: leave it blank to keep the stored secret.
function MailerConfigSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["mailer-config"],
    queryFn: () => api.get<MailerConfig>("/admin/config/mailer"),
  });

  const [form, setForm] = useState<{ host: string; port: string; username: string; password: string; from: string; tls: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SmtpTestResult | null>(null);

  useEffect(() => {
    if (data) setForm({ host: data.host, port: data.port ? String(data.port) : "", username: data.username, password: "", from: data.from, tls: data.tls });
  }, [data]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await api.put("/admin/config/mailer", {
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username.trim(),
        password: form.password,
        from: form.from.trim(),
        tls: form.tls,
      });
      toast.success("SMTP settings saved");
      setForm({ ...form, password: "" });
      qc.invalidateQueries({ queryKey: ["mailer-config"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.post<SmtpTestResult>("/admin/infra/test-smtp", {}));
    } catch (e) {
      setResult({ success: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <SectionHeading icon={Mail} title="Email (SMTP)" description="Outbound mail for verification, password resets, and invites" />
      <CardContent className="space-y-4">
        {isLoading || !form ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Host</Label>
                <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.example.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Port</Label>
                <Input value={form.port} inputMode="numeric" onChange={(e) => setForm({ ...form, port: e.target.value.replace(/[^0-9]/g, "") })} placeholder="587" />
              </div>
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={data?.has_password ? "•••••••• (unchanged)" : "optional"} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>From address</Label>
                <Input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="no-reply@example.com" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.tls} onCheckedChange={(v) => setForm({ ...form, tls: v })} />
              <Label className="text-sm font-normal">Use TLS</Label>
            </div>
            {result && (
              <div className="flex items-center gap-2 text-sm">
                {result.success ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                <span className={result.success ? "" : "text-destructive"}>{result.message}</span>
                {result.success && result.response_time && (
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{result.response_time}</span>
                )}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" size="sm" onClick={test} disabled={testing || saving} className="gap-1.5">
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {testing ? "Testing" : "Test connection"}
              </Button>
              <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface StorageConfig {
  endpoint: string;
  access_key: string;
  bucket: string;
  use_ssl: boolean;
  has_secret_key: boolean;
}

// StorageConfigSection edits the S3/MinIO object-storage settings at runtime.
// Saving verifies the connection, persists (secret key encrypted), and broadcasts
// a reload so the API and SMTP ingest server both rebuild their clients live. The
// bucket is read-only here: changing it would strand existing attachments. The
// secret key is never returned; leave it blank to keep the stored value.
function StorageConfigSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["storage-config"],
    queryFn: () => api.get<StorageConfig>("/admin/config/storage"),
  });

  const [form, setForm] = useState<{ endpoint: string; accessKey: string; secretKey: string; useSSL: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SmtpTestResult | null>(null);

  useEffect(() => {
    if (data) setForm({ endpoint: data.endpoint, accessKey: data.access_key, secretKey: "", useSSL: data.use_ssl });
  }, [data]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await api.put("/admin/config/storage", {
        endpoint: form.endpoint.trim(),
        access_key: form.accessKey.trim(),
        secret_key: form.secretKey,
        use_ssl: form.useSSL,
      });
      toast.success("Storage settings saved");
      setForm({ ...form, secretKey: "" });
      qc.invalidateQueries({ queryKey: ["storage-config"] });
      qc.invalidateQueries({ queryKey: ["admin-health"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.post<SmtpTestResult>("/admin/infra/test-storage", {}));
    } catch (e) {
      setResult({ success: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <SectionHeading icon={HardDrive} title="Object Storage" description="S3-compatible storage for email attachments. Supports AWS S3, MinIO, and any S3-compatible provider." />
      <CardContent className="space-y-4">
        {isLoading || !form ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="storage-endpoint">Endpoint</Label>
                <Input id="storage-endpoint" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="s3.amazonaws.com or minio.internal:9000" />
                <p className="text-xs text-muted-foreground">For AWS use your region endpoint (e.g. s3.us-east-1.amazonaws.com). For self-hosted MinIO use host:port.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="storage-bucket">Bucket</Label>
                <Input id="storage-bucket" value={data?.bucket ?? ""} disabled className="bg-muted font-mono" />
                <p className="text-xs text-muted-foreground">Set during initial setup. Cannot be changed without migrating data.</p>
              </div>
              <div className="flex items-center gap-3 self-end pb-0.5">
                <Switch id="storage-ssl" checked={form.useSSL} onCheckedChange={(v) => setForm({ ...form, useSSL: v })} />
                <Label htmlFor="storage-ssl" className="text-sm font-normal">Use TLS (HTTPS)</Label>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t">
              <div className="space-y-1.5">
                <Label htmlFor="storage-ak">Access Key ID</Label>
                <Input id="storage-ak" value={form.accessKey} onChange={(e) => setForm({ ...form, accessKey: e.target.value })} placeholder="AKIA..." className="font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="storage-sk">Secret Access Key</Label>
                <Input id="storage-sk" type="password" value={form.secretKey} onChange={(e) => setForm({ ...form, secretKey: e.target.value })} placeholder={data?.has_secret_key ? "•••••••• (leave blank to keep current)" : "Enter secret key"} />
                {data?.has_secret_key && <p className="text-xs text-muted-foreground">Leave blank to keep the stored key unchanged.</p>}
              </div>
            </div>
            {result && (
              <div className="flex items-center gap-2 text-sm rounded-lg border px-3 py-2">
                {result.success ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                <span className={result.success ? "text-success" : "text-destructive"}>{result.message}</span>
                {result.success && result.response_time && (
                  <span className="font-mono text-xs text-muted-foreground tabular-nums ml-auto">{result.response_time}</span>
                )}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" size="sm" onClick={test} disabled={testing || saving || !form.endpoint} className="gap-1.5">
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {testing ? "Testing…" : "Test Connection"}
              </Button>
              <Button size="sm" onClick={save} disabled={saving || !form.endpoint || !form.accessKey} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}


// ── SSO Providers Tab ──

interface SSOProviderData {
  id: string;
  name: string;
  provider_type: string;
  client_id: string;
  client_secret: string;
  redirect_url: string;
  issuer_url?: string;
  tenant_id?: string;
  auto_provision: boolean;
  default_org_role: string;
  default_team_role: string;
  default_team_id?: string;
  allowed_domains?: string;
  claim_mappings?: { claim_name: string; claim_value: string; org_role: string; team_id?: string; team_role?: string }[];
  custom_claims?: string[];
  enabled: boolean;
  linked_user_count?: number;
  created_at: string;
  updated_at: string;
}

interface SSOTestResultData {
  success: boolean;
  endpoint: string;
  status_code?: number;
  message: string;
  response_time: string;
}

interface SSODomainMapping {
  id: string;
  provider_id: string;
  domain: string;
  org_role: string;
  team_id: string;
  team_role: string;
  team_name?: string;
  created_at: string;
  updated_at: string;
}

interface DomainMappingPreviewResult {
  email: string;
  email_domain: string;
  provider: string;
  matching_rules: SSODomainMapping[];
  would_bypass_invite: boolean;
  team_assignments: { team_id: string; team_name: string; team_role: string }[];
  org_role?: string;
}

const emptyProvider: Partial<SSOProviderData> = {
  name: "", provider_type: "google", client_id: "", client_secret: "", redirect_url: "",
  issuer_url: "", tenant_id: "", auto_provision: false, default_org_role: "member",
  default_team_role: "member", default_team_id: "", allowed_domains: "", claim_mappings: [], custom_claims: [], enabled: true,
};

export function SSOProvidersTab() {
  const qc = useQueryClient();
  const { data: providers, isLoading } = useQuery({
    queryKey: ["admin-sso-providers"],
    queryFn: () => api.get<SSOProviderData[]>("/admin/sso/providers"),
  });

  const [editing, setEditing] = useState<Partial<SSOProviderData> | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, SSOTestResultData>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const teams = useOrgStore((s) => s.teams);

  const validateForm = validateSSOProviderForm;

  const handleFieldChange = (key: string, val: unknown) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [key]: val };
      const newErrors = validateForm(updated);
      setErrors(newErrors);
      return updated;
    });
  };

  const handleFieldBlur = (key: string) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    if (editing) {
      const newErrors = validateForm(editing);
      setErrors(newErrors);
    }
  };

  const isFormValid = editing ? Object.keys(validateForm(editing)).length === 0 : false;

  // Reset validation state when editing changes
  const editingId = editing?.id ?? (editing ? "__new__" : null);
  const [lastEditingId, setLastEditingId] = useState<string | null>(null);
  if (editingId !== lastEditingId) {
    setLastEditingId(editingId);
    if (editing) {
      setTouched({});
      setErrors({});
    }
  }

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.id) {
        await api.put(`/admin/sso/providers/${editing.id}`, editing);
      } else {
        await api.post("/admin/sso/providers", editing);
      }
      qc.invalidateQueries({ queryKey: ["admin-sso-providers"] });
      setEditing(null);
      toast.success(editing.id ? "Provider updated" : "Provider created");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (provider: SSOProviderData) => {
    setTesting(provider.id);
    try {
      const result = await api.post<SSOTestResultData>("/admin/sso/test", provider);
      setTestResults((prev) => ({ ...prev, [provider.id]: result }));
    } catch (e: unknown) {
      setTestResults((prev) => ({ ...prev, [provider.id]: { success: false, endpoint: "", message: e instanceof Error ? e.message : "Test failed", response_time: "" } }));
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (provider: SSOProviderData) => {
    setDeleting(provider.id);
    try {
      await api.del(`/admin/sso/providers/${provider.id}`);
      qc.invalidateQueries({ queryKey: ["admin-sso-providers"] });
      toast.success(`Provider "${provider.name}" deleted`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setDeleting(null);
    }
  };

  const set = (key: string, val: unknown) => setEditing((f) => f ? { ...f, [key]: val } : f);

  if (isLoading) return <div className="space-y-4">{Array.from({ length: 2 }).map((_, i) => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-24 w-full" /></CardContent></Card>)}</div>;

  // Compute summary stats
  const providerList = providers ?? [];
  const { enabledCount, totalLinkedUsers } = ssoSummaryStats(providerList);

  return (
    <div className="space-y-4">
      {/* Styled header card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center" aria-hidden="true">
                <Shield className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">SSO Providers</CardTitle>
                <CardDescription>Configure single sign-on providers for your platform.</CardDescription>
              </div>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => setEditing({ ...emptyProvider })}>
              <Plus className="h-4 w-4" /> Add Provider
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Summary */}
      {providerList.length > 0 && (
        <p className="text-sm text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground">{enabledCount}</span> enabled provider{enabledCount !== 1 ? "s" : ""}
          {" · "}
          <span className="font-semibold text-foreground">{totalLinkedUsers}</span> linked user{totalLinkedUsers !== 1 ? "s" : ""}
        </p>
      )}

      {/* Provider list */}
      {providerList.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          testing={testing}
          deleting={deleting}
          testResults={testResults}
          onTest={handleTest}
          onEdit={setEditing}
          onDelete={handleDelete}
        />
      ))}

      {providerList.length === 0 && (
        <EmptyState
          icon={Key}
          title="No SSO providers configured"
          description="Add a provider to let your team sign in with single sign-on."
          action={{ label: "Add Provider", onClick: () => setEditing({ ...emptyProvider }) }}
        />
      )}

      {/* Edit/Create dialog - inline card */}
      {editing && (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center">
                <Key className="h-4 w-4 text-primary" />
              </div>
              {editing.id ? "Edit Provider" : "Add Provider"}
            </CardTitle>
            <CardDescription>Configure SSO provider settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
                <Input value={editing.name ?? ""} onChange={(e) => handleFieldChange("name", e.target.value)} onBlur={() => handleFieldBlur("name")} placeholder="e.g. google, github-corp" className="h-8 text-xs" disabled={!!editing.id} />
                {touched.name && errors.name && <p className="text-[10px] text-destructive">{errors.name}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Provider Type</Label>
                <Select value={editing.provider_type ?? "google"} onValueChange={(v) => set("provider_type", v)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="github">GitHub</SelectItem>
                    <SelectItem value="azure">Azure AD</SelectItem>
                    <SelectItem value="okta">Okta</SelectItem>
                    <SelectItem value="oidc">Generic OIDC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {editing.provider_type === "azure" && (
              <div className="space-y-1">
                <Label className="text-xs">Tenant ID</Label>
                <Input value={editing.tenant_id ?? ""} onChange={(e) => set("tenant_id", e.target.value)} placeholder="your-tenant-id" className="h-8 font-mono text-xs" />
              </div>
            )}
            {(editing.provider_type === "okta" || editing.provider_type === "oidc") && (
              <div className="space-y-1">
                <Label className="text-xs">Issuer URL</Label>
                <Input value={editing.issuer_url ?? ""} onChange={(e) => set("issuer_url", e.target.value)} placeholder="https://your-idp.com" className="h-8 font-mono text-xs" />
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Client ID <span className="text-destructive">*</span></Label>
              <Input value={editing.client_id ?? ""} onChange={(e) => handleFieldChange("client_id", e.target.value)} onBlur={() => handleFieldBlur("client_id")} placeholder="your-client-id" className="h-8 font-mono text-xs" />
              {touched.client_id && errors.client_id && <p className="text-[10px] text-destructive">{errors.client_id}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Client Secret <span className="text-destructive">*</span></Label>
              <Input type="password" value={editing.client_secret ?? ""} onChange={(e) => handleFieldChange("client_secret", e.target.value)} onBlur={() => handleFieldBlur("client_secret")} placeholder="your-client-secret" className="h-8 font-mono text-xs" />
              {touched.client_secret && errors.client_secret && <p className="text-[10px] text-destructive">{errors.client_secret}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Redirect URL <span className="text-destructive">*</span></Label>
              <Input value={editing.redirect_url ?? ""} onChange={(e) => handleFieldChange("redirect_url", e.target.value)} onBlur={() => handleFieldBlur("redirect_url")} placeholder="https://your-domain/api/v1/auth/sso/{name}/callback" className="h-8 font-mono text-xs" />
              {touched.redirect_url && errors.redirect_url && <p className="text-[10px] text-destructive">{errors.redirect_url}</p>}
            </div>

            <div className="border-t pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Enabled</Label>
                  <p className="text-[11px] text-muted-foreground">Show this provider on login pages</p>
                </div>
                <Switch checked={editing.enabled ?? true} onCheckedChange={(v) => set("enabled", v)} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">Auto-provision users</Label>
                  <p className="text-[11px] text-muted-foreground">Automatically add new SSO users to the organization</p>
                </div>
                <Switch checked={editing.auto_provision ?? false} onCheckedChange={(v) => set("auto_provision", v)} />
              </div>
              <div className={`grid grid-cols-2 gap-3 ${!editing.auto_provision ? "opacity-60" : ""}`}>
                <div className="space-y-1">
                  <Label className="text-xs">Default Org Role</Label>
                  <Select value={editing.default_org_role ?? "member"} onValueChange={(v) => set("default_org_role", v)}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Default Team Role</Label>
                  <Select value={editing.default_team_role ?? "member"} onValueChange={(v) => set("default_team_role", v)}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="lead">Lead</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className={`${!editing.auto_provision ? "opacity-60" : ""}`}>
                <div className="space-y-1">
                  <Label className="text-xs">Default Team</Label>
                  <Select value={editing.default_team_id ?? "__none__"} onValueChange={(v) => set("default_team_id", v === "__none__" ? undefined : v)}>
                    <SelectTrigger className="h-8"><SelectValue placeholder="No default team" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">These roles are applied when auto-provision is enabled.</p>
              <div className="space-y-1">
                <Label className="text-xs">Allowed Email Domains</Label>
                <Input value={editing.allowed_domains ?? ""} onChange={(e) => set("allowed_domains", e.target.value)} placeholder="company.com, corp.com" className="h-8 text-xs" />
              </div>
            </div>

            {/* Claim Mappings Editor */}
            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Claim Mappings</Label>
                <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={() => {
                  const mappings = [...(editing.claim_mappings ?? []), { claim_name: "", claim_value: "", org_role: "member", team_id: "", team_role: "" }];
                  set("claim_mappings", mappings);
                }}>
                  <Plus className="h-3 w-3" /> Add Rule
                </Button>
              </div>
              {(editing.claim_mappings ?? []).map((m, i) => (
                <div key={i} className="relative rounded-lg border p-3 space-y-2">
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2 h-6 w-6 p-0" aria-label="Remove claim mapping" title="Remove" onClick={() => {
                    const mappings = (editing.claim_mappings ?? []).filter((_, idx) => idx !== i);
                    set("claim_mappings", mappings);
                  }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Claim Name</Label>
                      <Input value={m.claim_name} onChange={(e) => {
                        const mappings = [...(editing.claim_mappings ?? [])];
                        mappings[i] = { ...mappings[i], claim_name: e.target.value };
                        set("claim_mappings", mappings);
                      }} placeholder="claim" className="h-7 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Claim Value</Label>
                      <Input value={m.claim_value} onChange={(e) => {
                        const mappings = [...(editing.claim_mappings ?? [])];
                        mappings[i] = { ...mappings[i], claim_value: e.target.value };
                        set("claim_mappings", mappings);
                      }} placeholder="value" className="h-7 text-xs" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px]">Org Role</Label>
                      <Input value={m.org_role} onChange={(e) => {
                        const mappings = [...(editing.claim_mappings ?? [])];
                        mappings[i] = { ...mappings[i], org_role: e.target.value };
                        set("claim_mappings", mappings);
                      }} placeholder="org role" className="h-7 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Team ID</Label>
                      <Input value={m.team_id ?? ""} onChange={(e) => {
                        const mappings = [...(editing.claim_mappings ?? [])];
                        mappings[i] = { ...mappings[i], team_id: e.target.value };
                        set("claim_mappings", mappings);
                      }} placeholder="team ID" className="h-7 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px]">Team Role</Label>
                      <Input value={m.team_role ?? ""} onChange={(e) => {
                        const mappings = [...(editing.claim_mappings ?? [])];
                        mappings[i] = { ...mappings[i], team_role: e.target.value };
                        set("claim_mappings", mappings);
                      }} placeholder="team role" className="h-7 text-xs" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Domain Mappings Section (only for existing providers) */}
            {editing.id && (
              <DomainMappingsSection providerId={editing.id} providerName={editing.name ?? ""} />
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving || !isFormValid} size="sm">
                {saving ? "Saving…" : editing.id ? "Update Provider" : "Create Provider"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}


// ── Provider Card (enhanced with info density, delete confirm, test email) ──

function ProviderCard({
  provider: p,
  testing,
  deleting,
  testResults,
  onTest,
  onEdit,
  onDelete,
}: {
  provider: SSOProviderData;
  testing: string | null;
  deleting: string | null;
  testResults: Record<string, SSOTestResultData>;
  onTest: (p: SSOProviderData) => void;
  onEdit: (p: Partial<SSOProviderData>) => void;
  onDelete: (p: SSOProviderData) => void;
}) {
  const providerColors: Record<string, string> = {
    github: "bg-foreground text-background",
    google: "bg-info/10 text-info",
    azure: "bg-info/10 text-info",
    okta: "bg-primary/10 text-primary",
    oidc: "bg-primary/10 text-primary",
  };
  const iconBg = p.enabled ? (providerColors[p.provider_type] ?? "bg-success/10 text-success") : "bg-muted text-muted-foreground";

  // Fetch domain mappings count for this provider
  const { data: domainMappings } = useQuery({
    queryKey: ["sso-domain-mappings", p.id],
    queryFn: () => api.get<SSODomainMapping[]>(`/admin/sso/providers/${p.id}/domain-mappings`),
    enabled: !!p.id,
  });
  const domainMappingsCount = domainMappings?.length ?? 0;

  const [copiedUrl, setCopiedUrl] = useState(false);
  const handleCopyUrl = () => {
    if (!p.redirect_url) return;
    copyToClipboard(p.redirect_url);
    setCopiedUrl(true);
    toast.success("Redirect URL copied");
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  // Parse allowed domains
  const allowedDomainsList = p.allowed_domains
    ? p.allowed_domains.split(",").map((d) => d.trim()).filter(Boolean)
    : [];

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${iconBg}`}>
              <ProviderIcon providerType={p.provider_type} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{p.name}</p>
                <Badge variant={p.enabled ? "success" : "secondary"} className="text-xs gap-1">
                  {p.enabled && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">{providerTypeLabel(p.provider_type)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {p.linked_user_count ?? 0} linked users · Created {new Date(p.created_at).toLocaleDateString()}
                {domainMappingsCount > 0 && <> · {domainMappingsCount} domain mapping{domainMappingsCount !== 1 ? "s" : ""}</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => onTest(p)} disabled={testing === p.id}>
              {testing === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Test
            </Button>
            <TestEmailDialog provider={p} />
            <Button variant="outline" size="sm" className="gap-1" onClick={() => onEdit(p)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            <ConfirmDialog
              trigger={
                <Button variant="destructive" size="sm" className="gap-1" disabled={deleting === p.id}>
                  <Trash2 className="h-3.5 w-3.5" /> {deleting === p.id ? "Deleting…" : "Delete"}
                </Button>
              }
              title="Delete SSO provider?"
              description={`Remove "${p.name}"? This provider has ${p.linked_user_count ?? 0} linked users who will lose SSO access.`}
              onConfirm={() => onDelete(p)}
            />
          </div>
        </div>

        {/* Provider details */}
        <div className="mt-3 pt-3 border-t space-y-2">
          {p.redirect_url && (
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="text-muted-foreground shrink-0">Redirect URL:</span>
              <span className="font-mono text-[11px] truncate min-w-0" title={p.redirect_url}>{p.redirect_url}</span>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors duration-150"
                aria-label="Copy redirect URL"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {allowedDomainsList.length > 0 && allowedDomainsList.map((d) => (
              <Badge key={d} variant="outline" className="text-[10px] font-mono">@{d}</Badge>
            ))}
            <Badge variant={p.auto_provision ? "secondary" : "outline"} className="text-[10px]">
              {p.auto_provision ? "Auto-provision on" : "Auto-provision off"}
            </Badge>
            {domainMappingsCount > 0 && (
              <Badge variant="outline" className="text-[10px]">{domainMappingsCount} mapping{domainMappingsCount !== 1 ? "s" : ""}</Badge>
            )}
          </div>
        </div>

        {/* Test result */}
        {testResults[p.id] && (
          <div className={`mt-3 p-3 rounded-lg border text-xs ${testResults[p.id].success ? "bg-success/5 text-success border-success/20" : "bg-destructive/5 text-destructive border-destructive/20"}`}>
            <div className="flex items-center gap-1.5">
              {testResults[p.id].success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              <span className="font-medium">{testResults[p.id].success ? "Connection successful" : "Connection failed"}</span>
            </div>
            <p className="mt-1 text-[11px] opacity-80">{testResults[p.id].message}
            {testResults[p.id].endpoint && <span className="ml-1 font-mono">{testResults[p.id].endpoint}</span>}
            {testResults[p.id].response_time && <span className="ml-1">({testResults[p.id].response_time})</span>}
            </p>
          </div>
        )}

        {/* Claim mappings display */}
        {p.claim_mappings && p.claim_mappings.length > 0 && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-1">Claim Mappings</p>
            <div className="space-y-1">
              {p.claim_mappings.map((m, i) => (
                <div key={i} className="text-xs text-muted-foreground">
                  {m.claim_name}={m.claim_value} → org:{m.org_role}{m.team_id ? `, team:${m.team_role}` : ""}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ── Test Email Dialog (accessible from provider card) ──

function TestEmailDialog({ provider }: { provider: SSOProviderData }) {
  const [testEmail, setTestEmail] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<DomainMappingPreviewResult | null>(null);

  const handlePreview = async () => {
    if (!testEmail) return;
    setPreviewLoading(true);
    setPreviewResult(null);
    try {
      const result = await api.post<DomainMappingPreviewResult>("/admin/sso/domain-mappings/preview", {
        email: testEmail,
        provider: provider.name,
      });
      setPreviewResult(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Mail className="h-3.5 w-3.5" /> Test Email
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Test Email Preview — {provider.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Preview what would happen if a user with this email authenticated via this provider.</p>
          <div className="flex gap-2">
            <Input
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="user@example.com"
              className="h-8 text-xs font-mono flex-1"
              onKeyDown={(e) => e.key === "Enter" && handlePreview()}
            />
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1 shrink-0" onClick={handlePreview} disabled={!testEmail || previewLoading}>
              {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              Preview
            </Button>
          </div>

          {previewResult && (
            <div className="rounded-lg border p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Domain:</span>
                <Badge variant="outline" className="font-mono text-[10px]">@{previewResult.email_domain}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Would bypass invite:</span>
                {previewResult.would_bypass_invite ? (
                  <Badge className="text-[10px] bg-success/10 text-success border-success/20">
                    <CheckCircle2 className="h-3 w-3 mr-0.5" /> Yes
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-warning border-warning/20">
                    <XCircle className="h-3 w-3 mr-0.5" /> No
                  </Badge>
                )}
              </div>
              {previewResult.matching_rules.length > 0 ? (
                <div className="space-y-1">
                  <span className="text-muted-foreground">Matching rules:</span>
                  {previewResult.matching_rules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-1.5 ml-2">
                      <Badge variant="outline" className="font-mono text-[10px]">@{rule.domain}</Badge>
                      <span className="text-muted-foreground">→</span>
                      <Badge variant="outline" className="text-[10px] text-primary border-primary/20">
                        {rule.team_name || rule.team_id.slice(0, 8)} · {rule.team_role}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">org: {rule.org_role}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No matching rules found for this domain.</p>
              )}
              {previewResult.team_assignments && previewResult.team_assignments.length > 0 && (
                <div className="space-y-1">
                  <span className="text-muted-foreground">Predicted team assignments:</span>
                  <div className="flex flex-wrap gap-1 ml-2">
                    {previewResult.team_assignments.map((ta, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] text-primary border-primary/20">
                        {ta.team_name} · {ta.team_role}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {previewResult.org_role && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Org role:</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{previewResult.org_role}</Badge>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ── Domain Mappings Section (within SSO Provider edit card) ──

interface DomainMappingFormState {
  domain: string;
  team_id: string;
  team_role: string;
  org_role: string;
}

const emptyMappingForm: DomainMappingFormState = {
  domain: "",
  team_id: "",
  team_role: "member",
  org_role: "member",
};

function DomainMappingsSection({ providerId, providerName }: { providerId: string; providerName: string }) {
  const qc = useQueryClient();
  const teams = useOrgStore((s) => s.teams);
  const { orgRoles, teamRoles } = useRoles();

  const [addingMapping, setAddingMapping] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [form, setForm] = useState<DomainMappingFormState>({ ...emptyMappingForm });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Test email preview state
  const [testEmail, setTestEmail] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<DomainMappingPreviewResult | null>(null);

  // Fetch domain mappings for this provider
  const { data: mappings, isLoading } = useQuery({
    queryKey: ["sso-domain-mappings", providerId],
    queryFn: () => api.get<SSODomainMapping[]>(`/admin/sso/providers/${providerId}/domain-mappings`),
    enabled: !!providerId,
  });

  const domainValid = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(form.domain);

  const setFormField = (key: keyof DomainMappingFormState, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
  };

  const startAdd = () => {
    setAddingMapping(true);
    setEditingMappingId(null);
    setForm({ ...emptyMappingForm, team_id: teams[0]?.id ?? "" });
  };

  const startEdit = (mapping: SSODomainMapping) => {
    setEditingMappingId(mapping.id);
    setAddingMapping(false);
    setForm({
      domain: mapping.domain,
      team_id: mapping.team_id,
      team_role: mapping.team_role,
      org_role: mapping.org_role,
    });
  };

  const cancelForm = () => {
    setAddingMapping(false);
    setEditingMappingId(null);
    setForm({ ...emptyMappingForm });
  };

  const handleSaveMapping = async () => {
    if (!form.domain || !form.team_id) return;
    setSaving(true);
    try {
      if (editingMappingId) {
        await api.put(`/admin/sso/providers/${providerId}/domain-mappings/${editingMappingId}`, {
          domain: form.domain,
          team_id: form.team_id,
          team_role: form.team_role,
          org_role: form.org_role,
        });
        toast.success("Domain mapping updated");
      } else {
        await api.post(`/admin/sso/providers/${providerId}/domain-mappings`, {
          domain: form.domain,
          team_id: form.team_id,
          team_role: form.team_role,
          org_role: form.org_role,
        });
        toast.success("Domain mapping created");
      }
      qc.invalidateQueries({ queryKey: ["sso-domain-mappings", providerId] });
      cancelForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMapping = async (mappingId: string) => {
    setDeletingId(mappingId);
    try {
      await api.del(`/admin/sso/providers/${providerId}/domain-mappings/${mappingId}`);
      qc.invalidateQueries({ queryKey: ["sso-domain-mappings", providerId] });
      toast.success("Domain mapping deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete mapping");
    } finally {
      setDeletingId(null);
    }
  };

  const handlePreview = async () => {
    if (!testEmail) return;
    setPreviewLoading(true);
    setPreviewResult(null);
    try {
      const result = await api.post<DomainMappingPreviewResult>("/admin/sso/domain-mappings/preview", {
        email: testEmail,
        provider: providerName,
      });
      setPreviewResult(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const mappingsList = mappings ?? [];

  return (
    <div className="border-t pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-semibold">Domain Mappings</Label>
          <p className="text-[11px] text-muted-foreground">Route users from specific email domains to teams automatically.</p>
        </div>
        {!addingMapping && !editingMappingId && (
          <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={startAdd}>
            <Plus className="h-3 w-3" /> Add Mapping
          </Button>
        )}
      </div>

      {/* Existing mappings list */}
      {isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : mappingsList.length > 0 ? (
        <div className="space-y-1.5">
          {mappingsList.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border p-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="font-mono text-[10px]">@{m.domain}</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="outline" className="text-[10px] text-primary border-primary/20">
                  {m.team_name || m.team_id.slice(0, 8)} · {m.team_role}
                </Badge>
                <Badge variant="outline" className="text-[10px]">org: {m.org_role}</Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => startEdit(m)} title="Edit" aria-label="Edit mapping">
                  <Pencil className="h-3 w-3" />
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" disabled={deletingId === m.id} title="Delete" aria-label="Delete mapping">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  }
                  title="Delete domain mapping?"
                  description={`Remove the mapping for @${m.domain} → ${m.team_name || "team"}? Users from this domain will no longer be auto-provisioned to this team.`}
                  onConfirm={() => handleDeleteMapping(m.id)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No domain mappings configured.</p>
      )}

      {/* Add/Edit mapping form */}
      {(addingMapping || editingMappingId) && (
        <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
          <p className="text-xs font-medium">{editingMappingId ? "Edit Mapping" : "New Mapping"}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Domain</Label>
              <Input
                value={form.domain}
                onChange={(e) => setFormField("domain", e.target.value)}
                placeholder="example.com"
                className="h-7 text-xs font-mono"
              />
              {form.domain && !domainValid && (
                <p className="text-[10px] text-destructive">Invalid domain format</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Team</Label>
              <Select value={form.team_id} onValueChange={(v) => setFormField("team_id", v)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select team" /></SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Team Role</Label>
              <Select value={form.team_role} onValueChange={(v) => setFormField("team_role", v)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {teamRoles.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Org Role</Label>
              <Select value={form.org_role} onValueChange={(v) => setFormField("org_role", v)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {orgRoles.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="h-6 text-xs" onClick={handleSaveMapping} disabled={!form.domain || !domainValid || !form.team_id || saving}>
              {saving ? "Saving…" : editingMappingId ? "Update" : "Add"}
            </Button>
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={cancelForm}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Test Email Preview (Task 14.2) */}
      <div className="border-t pt-3 space-y-2">
        <Label className="text-xs font-semibold">Test Email</Label>
        <p className="text-[11px] text-muted-foreground">Preview what would happen if a user with this email authenticated via this provider.</p>
        <div className="flex gap-2">
          <Input
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="user@example.com"
            className="h-7 text-xs font-mono flex-1"
            onKeyDown={(e) => e.key === "Enter" && handlePreview()}
          />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={handlePreview} disabled={!testEmail || previewLoading}>
            {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Preview
          </Button>
        </div>

        {previewResult && (
          <div className="rounded-lg border p-3 space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Domain:</span>
              <Badge variant="outline" className="font-mono text-[10px]">@{previewResult.email_domain}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Would bypass invite:</span>
              {previewResult.would_bypass_invite ? (
                <Badge className="text-[10px] bg-success/10 text-success border-success/20">
                  <CheckCircle2 className="h-3 w-3 mr-0.5" /> Yes
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-warning border-warning/20">
                  <XCircle className="h-3 w-3 mr-0.5" /> No
                </Badge>
              )}
            </div>
            {previewResult.matching_rules.length > 0 ? (
              <div className="space-y-1">
                <span className="text-muted-foreground">Matching rules:</span>
                {previewResult.matching_rules.map((rule, i) => (
                  <div key={i} className="flex items-center gap-1.5 ml-2">
                    <Badge variant="outline" className="font-mono text-[10px]">@{rule.domain}</Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/20">
                      {rule.team_name || rule.team_id.slice(0, 8)} · {rule.team_role}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">org: {rule.org_role}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No matching rules found for this domain.</p>
            )}
            {previewResult.team_assignments && previewResult.team_assignments.length > 0 && (
              <div className="space-y-1">
                <span className="text-muted-foreground">Predicted team assignments:</span>
                <div className="flex flex-wrap gap-1 ml-2">
                  {previewResult.team_assignments.map((ta, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] text-primary border-primary/20">
                      {ta.team_name} · {ta.team_role}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {previewResult.org_role && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Org role:</span>
                <Badge variant="outline" className="text-[10px] capitalize">{previewResult.org_role}</Badge>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
