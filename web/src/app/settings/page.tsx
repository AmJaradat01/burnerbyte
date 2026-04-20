"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
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
import { Activity, AlertTriangle, Archive, CheckCircle2, Clock, Database, Globe, HardDrive, Inbox, Info, Key, Link as LinkIcon, Loader2, Lock, Mail, Monitor, Paperclip, Pencil, Plus, Save, Search, Settings, Shield, Trash2, Users, UsersRound, XCircle } from "lucide-react";
import Link from "next/link";
import { UnifiedUsersTab } from "@/components/settings/unified-users-tab";
import { RolesTab } from "@/components/settings/roles-tab";
import { useRoles } from "@/hooks/use-roles";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Organization, OrgSettings, SystemStats } from "@/types";

export default function SettingsPage() {
  const { currentOrg, currentRole, fetchOrgs, hasPermission } = useOrgStore();
  const user = useAuthStore((s) => s.user);
  const isAdmin = hasPermission("org.settings.manage") || user?.is_system_admin;
  if (!isAdmin) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access settings.</p></div>;
  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const isSysAdmin = user?.is_system_admin ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your organization, members, and system configuration.</p>
      </div>
      <Tabs defaultValue="general">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> General</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Users</TabsTrigger>
          {isSysAdmin && <TabsTrigger value="roles" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Roles</TabsTrigger>}
          {isSysAdmin && <TabsTrigger value="sso" className="gap-1.5"><Key className="h-3.5 w-3.5" /> SSO</TabsTrigger>}
          {isSysAdmin && <TabsTrigger value="overview" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> System</TabsTrigger>}
          {isSysAdmin && <TabsTrigger value="health" className="gap-1.5"><Monitor className="h-3.5 w-3.5" /> Health</TabsTrigger>}
        </TabsList>
        <TabsContent value="general"><GeneralTab org={currentOrg} onSaved={fetchOrgs} /></TabsContent>
        <TabsContent value="users"><UnifiedUsersTab orgId={currentOrg.id} /></TabsContent>
        {isSysAdmin && <TabsContent value="roles"><RolesTab /></TabsContent>}
        {isSysAdmin && <TabsContent value="sso"><SSOProvidersTab /></TabsContent>}
        {isSysAdmin && <TabsContent value="overview"><OverviewTab /></TabsContent>}
        {isSysAdmin && <TabsContent value="health"><HealthTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

function GeneralTab({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(org.name);
  const [logoUrl, setLogoUrl] = useState(org.logo_url ?? "");
  const [settings, setSettings] = useState<OrgSettings>(org.settings || {});
  const [saving, setSaving] = useState(false);

  // Re-sync local state when org refreshes after save
  const orgKey = `${org.id}-${org.updated_at}`;
  const [syncKey, setSyncKey] = useState(orgKey);
  if (orgKey !== syncKey) {
    setName(org.name);
    setLogoUrl(org.logo_url ?? "");
    setSettings(org.settings || {});
    setSyncKey(orgKey);
  }

  const dirty = name !== org.name || logoUrl !== (org.logo_url ?? "") || JSON.stringify(settings) !== JSON.stringify(org.settings || {});

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
          <Card className="overflow-hidden">
            <div className="h-2 bg-gradient-to-r from-primary/80 to-primary/20" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center">
                  <Settings className="h-4 w-4 text-primary" />
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
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-xl font-bold text-primary">
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
                <div className="h-7 w-7 rounded-md bg-violet-100 flex items-center justify-center">
                  <Shield className="h-4 w-4 text-violet-600" />
                </div>
                Policies & Quotas
              </CardTitle>
              <CardDescription>Limits and defaults for your organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-green-100 flex items-center justify-center shrink-0">
                      <Paperclip className="h-4 w-4 text-green-600" />
                    </div>
                    <div>
                      <Label>Attachments enabled</Label>
                      <p className="text-xs text-muted-foreground">Allow file attachments on emails</p>
                    </div>
                  </div>
                  <Switch checked={settings.attachments_enabled ?? true} onCheckedChange={(v) => set("attachments_enabled", v)} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-blue-100 flex items-center justify-center shrink-0">
                      <Lock className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <Label>Enforce SSO</Label>
                      <p className="text-xs text-muted-foreground">Require SSO for all members</p>
                    </div>
                  </div>
                  <Switch checked={settings.enforce_sso ?? false} onCheckedChange={(v) => set("enforce_sso", v)} />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quotas</p>
                <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Default inbox TTL</Label>
                  <Input value={settings.default_inbox_ttl ?? ""} onChange={(e) => set("default_inbox_ttl", e.target.value)} placeholder="1h" className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max inbox TTL</Label>
                  <Input value={settings.max_inbox_ttl ?? ""} onChange={(e) => set("max_inbox_ttl", e.target.value)} placeholder="24h" className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max attachment (MB)</Label>
                  <Input type="number" value={settings.max_attachment_size_mb ?? ""} onChange={(e) => set("max_attachment_size_mb", Number(e.target.value) || undefined)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max domains</Label>
                  <Input type="number" value={settings.max_domains ?? ""} onChange={(e) => set("max_domains", Number(e.target.value) || undefined)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max teams</Label>
                  <Input type="number" value={settings.max_teams ?? ""} onChange={(e) => set("max_teams", Number(e.target.value) || undefined)} className="h-8" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max inboxes/domain</Label>
                  <Input type="number" value={settings.max_inboxes_per_domain ?? ""} onChange={(e) => set("max_inboxes_per_domain", Number(e.target.value) || undefined)} className="h-8" />
                </div>
              </div>
              </div>
            </CardContent>
          </Card>

          <DangerZone org={org} onDeleted={onSaved} />
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-4 flex justify-end">
          <Button onClick={save} disabled={saving} size="lg" className="shadow-lg gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      )}
    </div>
  );
}

function DangerZone({ org, onDeleted }: { org: Organization; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.del(`/orgs/${org.id}`);
      toast.success("Organization deleted");
      onDeleted();
      window.location.href = "/dashboard";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        <CardDescription>Permanently delete this organization and all its data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">This removes all teams, domains, inboxes, emails, and members. This cannot be undone.</p>
        <div className="space-y-2">
          <Label className="text-xs">Type &quot;{org.name}&quot; to confirm</Label>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={org.name} className="max-w-xs" />
        </div>
        <Button variant="destructive" disabled={confirm !== org.name || deleting} onClick={handleDelete} className="gap-1.5">
          <Trash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete Organization"}
        </Button>
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

function OverviewTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<SystemStats>("/admin/stats"),
  });

  const { data: versionData } = useQuery({
    queryKey: ["admin-version"],
    queryFn: () => api.get<{ version: string }>("/admin/version"),
  });

  if (isError) return <ErrorState message="Failed to load stats" onRetry={() => refetch()} />;
  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">{Array.from({ length: 10 }).map((_, i) => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-8 w-16" /></CardContent></Card>)}</div>;
  if (!data) return null;

  const stats: { icon: typeof Mail; label: string; value: string; desc?: string; accent: string; href?: string }[] = [
    { icon: Users, label: "Users", value: data.total_users.toLocaleString(), accent: "text-blue-600 bg-blue-100" },
    { icon: UsersRound, label: "Teams", value: (data.total_teams ?? 0).toLocaleString(), accent: "text-indigo-600 bg-indigo-100", href: "/teams" },
    { icon: Globe, label: "Domains", value: data.total_domains.toLocaleString(), accent: "text-emerald-600 bg-emerald-100", href: "/domains" },
    { icon: Inbox, label: "Active Inboxes", value: (data.active_inboxes ?? 0).toLocaleString(), desc: `${(data.total_inboxes ?? 0).toLocaleString()} total created`, accent: "text-amber-600 bg-amber-100", href: "/" },
    { icon: Archive, label: "Total Created", value: (data.total_inboxes_created ?? 0).toLocaleString(), accent: "text-violet-600 bg-violet-100" },
    { icon: Mail, label: "Total Emails", value: data.total_emails.toLocaleString(), accent: "text-rose-600 bg-rose-100", href: "/analytics" },
    { icon: HardDrive, label: "Storage", value: formatBytes(data.storage_used_bytes ?? 0), accent: "text-slate-600 bg-slate-100" },
    { icon: Monitor, label: "Active Sessions", value: (data.total_sessions ?? 0).toLocaleString(), accent: "text-cyan-600 bg-cyan-100", href: "/profile/sessions" },
    { icon: LinkIcon, label: "Webhooks", value: (data.total_webhooks ?? 0).toLocaleString(), accent: "text-orange-600 bg-orange-100" },
    { icon: Key, label: "API Keys", value: (data.total_api_keys ?? 0).toLocaleString(), accent: "text-purple-600 bg-purple-100" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {stats.map((s) => {
          const inner = (
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shadow-sm ${s.accent}`}>
                  <s.icon className="h-4 w-4" />
                </div>
              </div>
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              {s.desc && <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>}
            </CardContent>
          );
          return s.href ? (
            <Link key={s.label} href={s.href} className="block">
              <Card className="transition-all hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5">{inner}</Card>
            </Link>
          ) : (
            <Card key={s.label} className="transition-all hover:shadow-md hover:-translate-y-0.5">{inner}</Card>
          );
        })}
      </div>
      <PlatformSettingsCard />
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">About</span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-muted-foreground text-xs">Version</p><p className="font-mono">{versionData?.version ?? "—"}</p></div>
            <div><p className="text-muted-foreground text-xs">Platform</p><p>BurnerByte — Self-hosted temporary email</p></div>
            <div><p className="text-muted-foreground text-xs">License</p><p>Apache 2.0</p></div>
          </div>
        </CardContent>
      </Card>
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
    }>("/admin/platform"),
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="h-7 w-7 rounded-md bg-slate-100 flex items-center justify-center">
            <Settings className="h-4 w-4 text-slate-600" />
          </div>
          Platform Settings
        </CardTitle>
        <CardDescription>Control access, security, and authentication policies.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Access */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-emerald-100 flex items-center justify-center">
              <Users className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Access</p>
          </div>
          <div className="flex items-center justify-between">
            <div><Label>Allow public registration</Label><p className="text-xs text-muted-foreground">When disabled, only invited users can join.</p></div>
            <Switch checked={form.allow_registration} onCheckedChange={(v) => set("allow_registration", v)} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label>Require email verification</Label><p className="text-xs text-muted-foreground">New users must verify their email before accessing the platform.</p></div>
            <Switch checked={form.email_verification} onCheckedChange={(v) => set("email_verification", v)} />
          </div>
        </div>

        {/* Password policy */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-amber-100 flex items-center justify-center">
              <Key className="h-3.5 w-3.5 text-amber-600" />
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Password Policy</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Min length</Label>
              <Input type="number" min={6} max={128} value={form.password_min_length} onChange={(e) => set("password_min_length", Number(e.target.value) || 8)} className="h-8" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between"><Label className="text-xs">Uppercase</Label><Switch checked={form.password_require_upper} onCheckedChange={(v) => set("password_require_upper", v)} /></div>
            <div className="flex items-center justify-between"><Label className="text-xs">Lowercase</Label><Switch checked={form.password_require_lower} onCheckedChange={(v) => set("password_require_lower", v)} /></div>
            <div className="flex items-center justify-between"><Label className="text-xs">Number</Label><Switch checked={form.password_require_number} onCheckedChange={(v) => set("password_require_number", v)} /></div>
            <div className="flex items-center justify-between"><Label className="text-xs">Special char</Label><Switch checked={form.password_require_special} onCheckedChange={(v) => set("password_require_special", v)} /></div>
          </div>
        </div>

        {/* Lockout */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-red-100 flex items-center justify-center">
              <Lock className="h-3.5 w-3.5 text-red-600" />
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account Lockout</p>
          </div>
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

        {/* Date & Time */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-blue-100 flex items-center justify-center">
              <Clock className="h-3.5 w-3.5 text-blue-600" />
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date & Time Defaults</p>
          </div>
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

        {/* Quotas & Limits */}
        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-purple-100 flex items-center justify-center">
              <Activity className="h-3.5 w-3.5 text-purple-600" />
            </div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quotas & Limits</p>
          </div>
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

        <div className="border-t pt-5">
          <Button onClick={save} disabled={saving} size="sm" className="gap-2">
            <Save className="h-4 w-4" />
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
  minio: HardDrive,
};

interface HealthResponse {
  services: Record<string, { status: string; latency: string }>;
  uptime: string;
}

function HealthTab() {
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
    <div className="space-y-4">
      {services.length > 0 && (
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            {allHealthy
              ? <Badge className="gap-1 bg-green-100 text-green-700 border-green-200"><CheckCircle2 className="h-3 w-3" /> All systems operational</Badge>
              : <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Degraded</Badge>
            }
          </div>
          {uptime && <span className="text-muted-foreground">Uptime: {uptime}</span>}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>)
        ) : services.length === 0 ? (
          <p className="text-sm text-muted-foreground col-span-full py-8 text-center">No services detected</p>
        ) : (
          services.map(([name, svc]) => {
            const ok = svc.status === "ok";
            const Icon = SERVICE_ICONS[name] ?? Database;
            return (
              <Card key={name} className={ok ? "" : "border-destructive/50"}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${ok ? "bg-green-100" : "bg-red-100"}`}>
                        <Icon className={`h-5 w-5 ${ok ? "text-green-600" : "text-red-600"}`} />
                      </div>
                      <div>
                        <p className="font-medium capitalize">{name}</p>
                        <p className="text-xs text-muted-foreground">{ok ? "Connected" : svc.status}</p>
                      </div>
                    </div>
                    {ok
                      ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                      : <XCircle className="h-5 w-5 text-red-600" />
                    }
                  </div>
                  <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                    <span>Latency</span>
                    <span className="font-mono">{svc.latency}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">Auto-refreshing every 15s · Last checked: {new Date().toLocaleTimeString()}</p>
      )}
    </div>
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
  default_team_role: "member", allowed_domains: "", claim_mappings: [], custom_claims: [], enabled: true,
};

function SSOProvidersTab() {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">SSO Providers</h3>
          <p className="text-sm text-muted-foreground">Configure single sign-on providers for your platform.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setEditing({ ...emptyProvider })}>
          <Plus className="h-4 w-4" /> Add Provider
        </Button>
      </div>

      {/* Provider list */}
      {(providers ?? []).map((p) => (
        <Card key={p.id}>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center shadow-sm ${p.enabled ? "bg-green-100" : "bg-gray-100"}`}>
                  <Shield className={`h-5 w-5 ${p.enabled ? "text-green-600" : "text-gray-400"}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{p.name}</p>
                    <Badge variant={p.enabled ? "default" : "secondary"} className="text-xs">{p.enabled ? "Enabled" : "Disabled"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">{p.provider_type} · {p.linked_user_count ?? 0} linked users</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={() => handleTest(p)} disabled={testing === p.id}>
                  {testing === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Test
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditing(p)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button variant="destructive" size="sm" className="gap-1" onClick={() => handleDelete(p)} disabled={deleting === p.id}>
                  <Trash2 className="h-3.5 w-3.5" /> {deleting === p.id ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </div>

            {/* Test result */}
            {testResults[p.id] && (
              <div className={`mt-3 p-2 rounded text-xs ${testResults[p.id].success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {testResults[p.id].success ? "✓" : "✗"} {testResults[p.id].message}
                {testResults[p.id].endpoint && <span className="ml-2 font-mono">{testResults[p.id].endpoint}</span>}
                {testResults[p.id].response_time && <span className="ml-2">({testResults[p.id].response_time})</span>}
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
      ))}

      {(providers ?? []).length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-muted-foreground">No SSO providers configured. Click &quot;Add Provider&quot; to get started.</p>
          </CardContent>
        </Card>
      )}

      {/* Edit/Create dialog - inline card */}
      {editing && (
        <Card className="border-primary/50">
          <CardHeader>
            <CardTitle className="text-base">{editing.id ? "Edit Provider" : "Add Provider"}</CardTitle>
            <CardDescription>Configure SSO provider settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input value={editing.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="e.g. google, github-corp" className="h-8 text-xs" disabled={!!editing.id} />
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
              <Label className="text-xs">Client ID</Label>
              <Input value={editing.client_id ?? ""} onChange={(e) => set("client_id", e.target.value)} placeholder="your-client-id" className="h-8 font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Client Secret</Label>
              <Input type="password" value={editing.client_secret ?? ""} onChange={(e) => set("client_secret", e.target.value)} placeholder="your-client-secret" className="h-8 font-mono text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Redirect URL</Label>
              <Input value={editing.redirect_url ?? ""} onChange={(e) => set("redirect_url", e.target.value)} placeholder="https://your-domain/api/v1/auth/sso/{name}/callback" className="h-8 font-mono text-xs" />
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
              {editing.auto_provision && (
                <div className="grid grid-cols-2 gap-3">
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
              )}
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
                <div key={i} className="grid grid-cols-5 gap-1 items-end">
                  <Input value={m.claim_name} onChange={(e) => {
                    const mappings = [...(editing.claim_mappings ?? [])];
                    mappings[i] = { ...mappings[i], claim_name: e.target.value };
                    set("claim_mappings", mappings);
                  }} placeholder="claim" className="h-7 text-xs" />
                  <Input value={m.claim_value} onChange={(e) => {
                    const mappings = [...(editing.claim_mappings ?? [])];
                    mappings[i] = { ...mappings[i], claim_value: e.target.value };
                    set("claim_mappings", mappings);
                  }} placeholder="value" className="h-7 text-xs" />
                  <Input value={m.org_role} onChange={(e) => {
                    const mappings = [...(editing.claim_mappings ?? [])];
                    mappings[i] = { ...mappings[i], org_role: e.target.value };
                    set("claim_mappings", mappings);
                  }} placeholder="org role" className="h-7 text-xs" />
                  <Input value={m.team_id ?? ""} onChange={(e) => {
                    const mappings = [...(editing.claim_mappings ?? [])];
                    mappings[i] = { ...mappings[i], team_id: e.target.value };
                    set("claim_mappings", mappings);
                  }} placeholder="team ID" className="h-7 text-xs" />
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => {
                    const mappings = (editing.claim_mappings ?? []).filter((_, idx) => idx !== i);
                    set("claim_mappings", mappings);
                  }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Domain Mappings Section (only for existing providers) */}
            {editing.id && (
              <DomainMappingsSection providerId={editing.id} providerName={editing.name ?? ""} />
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving} size="sm">
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
                <Badge variant="outline" className="text-[10px] text-violet-600 border-violet-200">
                  {m.team_name || m.team_id.slice(0, 8)} · {m.team_role}
                </Badge>
                <Badge variant="outline" className="text-[10px]">org: {m.org_role}</Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => startEdit(m)} title="Edit">
                  <Pencil className="h-3 w-3" />
                </Button>
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" disabled={deletingId === m.id} title="Delete">
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
                <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">
                  <CheckCircle2 className="h-3 w-3 mr-0.5" /> Yes
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">
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
                    <Badge variant="outline" className="text-[10px] text-violet-600 border-violet-200">
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
                    <Badge key={i} variant="outline" className="text-[10px] text-violet-600 border-violet-200">
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
