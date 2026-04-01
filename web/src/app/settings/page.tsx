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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, Building2, Calendar, CheckCircle2, Clock, Database, Globe, HardDrive, Inbox, Info, Mail, Monitor, Palette, RefreshCw, Settings, Shield, Trash2, UserPlus, Users, XCircle } from "lucide-react";
import { UnifiedUsersTab } from "@/components/settings/unified-users-tab";
import { RolesTab } from "@/components/settings/roles-tab";
import type { Organization, Membership, Invite, OrgSettings, PaginatedResponse, SystemStats, User } from "@/types";

export default function SettingsPage() {
  const { currentOrg, fetchOrgs } = useOrgStore();
  const user = useAuthStore((s) => s.user);
  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const isAdmin = user?.is_system_admin ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your organization, members, and system configuration.</p>
      </div>
      <Tabs defaultValue="general">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> General</TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Users</TabsTrigger>
          {isAdmin && <TabsTrigger value="roles" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Roles</TabsTrigger>}
          {isAdmin && <TabsTrigger value="overview" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> System</TabsTrigger>}
          {isAdmin && <TabsTrigger value="orgs" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Organizations</TabsTrigger>}
          {isAdmin && <TabsTrigger value="health" className="gap-1.5"><Monitor className="h-3.5 w-3.5" /> Health</TabsTrigger>}
        </TabsList>
        <TabsContent value="general"><GeneralTab org={currentOrg} onSaved={fetchOrgs} /></TabsContent>
        <TabsContent value="users"><UnifiedUsersTab orgId={currentOrg.id} /></TabsContent>
        {isAdmin && <TabsContent value="roles"><RolesTab /></TabsContent>}
        {isAdmin && <TabsContent value="overview"><OverviewTab /></TabsContent>}
        {isAdmin && <TabsContent value="orgs"><OrgsTab /></TabsContent>}
        {isAdmin && <TabsContent value="health"><HealthTab /></TabsContent>}
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organization</CardTitle>
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

          {/* Branding */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Palette className="h-4 w-4" /> Branding</CardTitle>
              <CardDescription>Customize the look of your org.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Primary Color</Label>
                <div className="flex gap-2">
                  <Input value={settings.primary_color ?? ""} onChange={(e) => set("primary_color", e.target.value)} placeholder="#6366f1" className="flex-1" />
                  <input type="color" value={settings.primary_color || "#6366f1"} onChange={(e) => set("primary_color", e.target.value)} className="h-9 w-9 rounded-md border cursor-pointer p-0.5" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Footer Text</Label>
                <Input value={settings.footer_text ?? ""} onChange={(e) => set("footer_text", e.target.value)} placeholder="Powered by BurnerByte" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Policies */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" /> Policies & Quotas</CardTitle>
              <CardDescription>Limits and defaults for your organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label>Attachments enabled</Label>
                    <p className="text-xs text-muted-foreground">Allow file attachments on emails</p>
                  </div>
                  <Switch checked={settings.attachments_enabled ?? true} onCheckedChange={(v) => set("attachments_enabled", v)} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <Label>Enforce SSO</Label>
                    <p className="text-xs text-muted-foreground">Require SSO for all members</p>
                  </div>
                  <Switch checked={settings.enforce_sso ?? false} onCheckedChange={(v) => set("enforce_sso", v)} />
                </div>
              </div>
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
            </CardContent>
          </Card>

          {user?.is_system_admin && <SSOCard />}

          <DangerZone org={org} onDeleted={onSaved} />
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-4 flex justify-end">
          <Button onClick={save} disabled={saving} size="lg" className="shadow-lg">
            {saving ? "Saving…" : "Save Settings"}
          </Button>
        </div>
      )}
    </div>
  );
}

interface SSOConfigData {
  provider: string;
  client_id: string;
  client_secret: string;
  redirect_url: string;
  tenant_id?: string;
  issuer_url?: string;
  auto_provision?: boolean;
  default_org_role?: string;
  default_team_role?: string;
  allowed_domains?: string;
}

function SSOCard() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-sso"],
    queryFn: () => api.get<SSOConfigData>("/admin/sso"),
  });

  const [form, setForm] = useState({
    provider: "", client_id: "", client_secret: "", redirect_url: "",
    tenant_id: "", issuer_url: "",
    auto_provision: false, default_org_role: "member", allowed_domains: "",
  });
  const [saving, setSaving] = useState(false);
  const [syncKey, setSyncKey] = useState("");

  const dataKey = data ? JSON.stringify(data) : "";
  if (dataKey && dataKey !== syncKey) {
    setForm({
      provider: data!.provider || "",
      client_id: data!.client_id || "",
      client_secret: data!.client_secret || "",
      redirect_url: data!.redirect_url || "",
      tenant_id: data!.tenant_id || "",
      issuer_url: data!.issuer_url || "",
      auto_provision: data!.auto_provision ?? false,
      default_org_role: data!.default_org_role || "member",
      allowed_domains: data!.allowed_domains || "",
    });
    setSyncKey(dataKey);
  }

  const set = (key: string, val: string | boolean) => setForm((f) => ({ ...f, [key]: val }));

  const dirty = data !== undefined && (
    form.provider !== (data?.provider || "") ||
    form.client_id !== (data?.client_id || "") ||
    form.client_secret !== (data?.client_secret || "") ||
    form.redirect_url !== (data?.redirect_url || "") ||
    form.tenant_id !== (data?.tenant_id || "") ||
    form.issuer_url !== (data?.issuer_url || "") ||
    form.auto_provision !== (data?.auto_provision ?? false) ||
    form.default_org_role !== (data?.default_org_role || "member") ||
    form.allowed_domains !== (data?.allowed_domains || "")
  );

  const configured = data && data.provider && data.client_id;

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/sso", form);
      toast.success("SSO config saved — changes take effect immediately");
      setSyncKey("");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Card><CardContent className="pt-6"><Skeleton className="h-32 w-full" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" /> SSO / OIDC</CardTitle>
            <CardDescription>Configure single sign-on for your organization.</CardDescription>
          </div>
          {configured
            ? <Badge className="bg-green-100 text-green-700 border-green-200">Configured</Badge>
            : <Badge variant="secondary">Not configured</Badge>
          }
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Provider</Label>
          <Select value={form.provider} onValueChange={(v) => set("provider", v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Select provider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="azure">Azure AD</SelectItem>
              <SelectItem value="okta">Okta</SelectItem>
              <SelectItem value="oidc">Generic OIDC</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.provider === "azure" && (
          <div className="space-y-1">
            <Label className="text-xs">Tenant ID</Label>
            <Input value={form.tenant_id} onChange={(e) => set("tenant_id", e.target.value)} placeholder="your-tenant-id (or 'common' for multi-tenant)" className="h-8 font-mono text-xs" />
            <p className="text-[11px] text-muted-foreground">Found in Azure Portal → Azure Active Directory → Overview</p>
          </div>
        )}
        {(form.provider === "okta" || form.provider === "oidc") && (
          <div className="space-y-1">
            <Label className="text-xs">Issuer URL</Label>
            <Input value={form.issuer_url} onChange={(e) => set("issuer_url", e.target.value)} placeholder={form.provider === "okta" ? "https://your-org.okta.com" : "https://your-idp.com"} className="h-8 font-mono text-xs" />
            <p className="text-[11px] text-muted-foreground">The OIDC issuer URL (must support .well-known/openid-configuration)</p>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Client ID</Label>
          <Input value={form.client_id} onChange={(e) => set("client_id", e.target.value)} placeholder="your-client-id" className="h-8 font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Client Secret</Label>
          <Input type="password" value={form.client_secret} onChange={(e) => set("client_secret", e.target.value)} placeholder="your-client-secret" className="h-8 font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Redirect URL</Label>
          <Input value={form.redirect_url} onChange={(e) => set("redirect_url", e.target.value)} placeholder="https://your-domain/api/v1/auth/sso/callback" className="h-8 font-mono text-xs" />
        </div>

        {/* Provisioning */}
        <div className="border-t pt-3 space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Auto-provision users</Label>
              <p className="text-xs text-muted-foreground">Automatically add new SSO users to the organization</p>
            </div>
            <Switch checked={form.auto_provision} onCheckedChange={(v) => set("auto_provision", v)} />
          </div>
          {form.auto_provision && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Default Org Role</Label>
                <Select value={form.default_org_role} onValueChange={(v) => set("default_org_role", v)}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Allowed Email Domains</Label>
                <Input value={form.allowed_domains} onChange={(e) => set("allowed_domains", e.target.value)} placeholder="company.com, corp.com" className="h-8 text-xs" />
              </div>
            </div>
          )}
        </div>

        <Button onClick={save} disabled={saving || !dirty} className="w-full">
          {saving ? "Saving…" : "Save SSO Config"}
        </Button>
      </CardContent>
    </Card>
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

function OverviewTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => api.get<SystemStats>("/admin/stats"),
  });

  if (isError) return <ErrorState message="Failed to load stats" onRetry={() => refetch()} />;
  if (isLoading) return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 8 }).map((_, i) => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-8 w-16" /></CardContent></Card>)}</div>;
  if (!data) return null;

  const stats: { icon: typeof Mail; label: string; value: number; desc?: string; accent: string }[] = [
    { icon: Users, label: "Users", value: data.total_users, accent: "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400" },
    { icon: Building2, label: "Organizations", value: data.total_orgs, accent: "text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400" },
    { icon: Users, label: "Teams", value: data.total_teams ?? 0, accent: "text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400" },
    { icon: Globe, label: "Domains", value: data.total_domains, accent: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400" },
    { icon: Inbox, label: "Active Inboxes", value: data.active_inboxes ?? 0, desc: `${(data.total_inboxes ?? 0).toLocaleString()} total`, accent: "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400" },
    { icon: Mail, label: "Total Emails", value: data.total_emails, accent: "text-rose-600 bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400" },
    { icon: Monitor, label: "Sessions", value: data.total_sessions ?? 0, accent: "text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30 dark:text-cyan-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${s.accent}`}>
                  <s.icon className="h-4 w-4" />
                </div>
              </div>
              <p className="text-2xl font-bold tabular-nums">{(s.value ?? 0).toLocaleString()}</p>
              {s.desc && <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <PlatformSettingsCard />
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
    }>("/admin/platform"),
  });
  const qc = useQueryClient();
  const [form, setForm] = useState({
    allow_registration: true, email_verification: true,
    password_min_length: 8, password_require_upper: true, password_require_lower: true,
    password_require_number: true, password_require_special: true,
    lockout_max_attempts: 5, lockout_duration_mins: 15,
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
        <CardTitle className="text-base">Platform Settings</CardTitle>
        <CardDescription>Control access, security, and authentication policies.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Access */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Access</p>
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
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Password Policy</p>
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
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account Lockout</p>
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

        <Button onClick={save} disabled={saving} size="sm">
          {saving ? "Saving…" : "Save Platform Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}

function OrgsTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: () => api.get<PaginatedResponse<Organization>>("/admin/orgs", { page: "1", per_page: "1" }),
  });

  const org = data?.data?.[0];
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Sync form state when org loads or refreshes
  useEffect(() => {
    if (org) { setName(org.name); setLogoUrl(org.logo_url ?? ""); }
  }, [org]);

  const dirty = org ? (name !== org.name || logoUrl !== (org.logo_url ?? "")) : false;

  const save = async () => {
    if (!org) return;
    setSaving(true);
    try {
      await api.patch(`/orgs/${org.id}`, { name, logo_url: logoUrl || undefined });
      toast.success("Organization updated");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  if (isError) return <ErrorState message="Failed to load organization" onRetry={() => refetch()} />;
  if (isLoading || !org) return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organization Details</CardTitle>
          <CardDescription>View and update your organization info.</CardDescription>
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
          {dirty && (
            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? "Saving…" : "Update Organization"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Info className="h-4 w-4" /> Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: "ID", value: org.id, mono: true },
            { label: "Created", value: new Date(org.created_at).toLocaleString() },
            { label: "Updated", value: new Date(org.updated_at).toLocaleString() },
            { label: "Default TTL", value: org.settings.default_inbox_ttl || "System default" },
            { label: "Max TTL", value: org.settings.max_inbox_ttl || "System default" },
            { label: "Attachments", value: (org.settings.attachments_enabled ?? true) ? "Enabled" : "Disabled" },
            { label: "SSO", value: org.settings.enforce_sso ? "Enforced" : "Optional" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between py-1.5 border-b last:border-0">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className={`text-sm font-medium ${row.mono ? "font-mono text-xs" : ""}`}>{row.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

interface HealthResponse {
  services?: Record<string, { status: string; latency: string }>;
  uptime?: string;
  // Legacy flat format fallback
  [key: string]: unknown;
}

const SERVICE_ICONS: Record<string, typeof Database> = { postgres: Database, redis: HardDrive, minio: Globe };

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
