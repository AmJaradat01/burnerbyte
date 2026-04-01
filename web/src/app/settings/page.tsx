"use client";

import { useState } from "react";
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
import type { Organization, Membership, Invite, OrgSettings, PaginatedResponse, SystemStats } from "@/types";

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
          <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Members</TabsTrigger>
          {isAdmin && <TabsTrigger value="users" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="overview" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> System</TabsTrigger>}
          {isAdmin && <TabsTrigger value="orgs" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Organizations</TabsTrigger>}
          {isAdmin && <TabsTrigger value="health" className="gap-1.5"><Monitor className="h-3.5 w-3.5" /> Health</TabsTrigger>}
        </TabsList>
        <TabsContent value="general"><GeneralTab org={currentOrg} onSaved={fetchOrgs} /></TabsContent>
        <TabsContent value="members"><MembersTab orgId={currentOrg.id} /></TabsContent>
        {isAdmin && <TabsContent value="users"><UsersTab /></TabsContent>}
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

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-amber-100 text-amber-700 border-amber-200",
  admin: "bg-blue-100 text-blue-700 border-blue-200",
  member: "bg-gray-100 text-gray-700 border-gray-200",
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function MembersTab({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["org-members", orgId, page],
    queryFn: () => api.get<{ data: Membership[]; total: number; total_pages: number }>(`/orgs/${orgId}/members`, { page: String(page), per_page: "20" }),
  });

  const { data: invitesData } = useQuery({
    queryKey: ["org-invites", orgId],
    queryFn: () => api.get<{ data: Invite[] }>(`/orgs/${orgId}/invites`),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/orgs/${orgId}/members/${userId}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-members", orgId] }); toast.success("Role updated"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.del(`/orgs/${orgId}/members/${userId}`),
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: ["org-members"] });
      const key = ["org-members", orgId, page];
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: { data: Membership[]; total: number; total_pages: number } | undefined) =>
        old ? { ...old, data: old.data.filter((m) => m.user_id !== userId) } : old
      );
      return { prev, key };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["org-members"] }),
    onSuccess: () => toast.success("Member removed"),
  });

  const filtered = data?.data?.filter((m) =>
    (m.display_name?.toLowerCase() || "").includes(search.toLowerCase()) ||
    (m.email?.toLowerCase() || "").includes(search.toLowerCase())
  );

  const pendingInvites = invitesData?.data ?? [];

  if (isError) return <ErrorState message="Failed to load members" onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground">Total Members</p>
            <p className="text-2xl font-bold">{data?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground">Pending Invites</p>
            <p className="text-2xl font-bold">{pendingInvites.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground">Owners</p>
            <p className="text-2xl font-bold">{data?.data?.filter((m) => m.role === "owner").length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + invite */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <InviteDialog orgId={orgId} />
      </div>

      {/* Member cards */}
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered?.map((m) => {
            const isYou = m.user_id === user?.id;
            return (
              <Card key={m.id} className={`${isYou ? "border-primary/30" : ""} cursor-pointer transition-shadow hover:shadow-md`}>
                <MemberDetailDialog member={m} orgId={orgId}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {(m.display_name || m.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{m.display_name || "—"}</p>
                        {isYou && <Badge variant="outline" className="text-[10px] px-1.5 py-0">you</Badge>}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{m.email || "—"}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Joined {new Date(m.created_at).toLocaleDateString()}</span>
                        <span>·</span>
                        <span>{m.last_login_at ? `Active ${timeAgo(m.last_login_at)}` : "Never active"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Select value={m.role} onValueChange={(role) => changeRole.mutate({ userId: m.user_id, role })}>
                        <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["owner", "admin", "member"].map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {!isYou && (
                        <ConfirmDialog
                          trigger={<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                          title="Remove member?"
                          description={`${m.display_name || m.email} will lose access to this organization.`}
                          onConfirm={() => removeMember.mutate(m.user_id)}
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
                </MemberDetailDialog>
              </Card>
            );
          })}
          {(!filtered || filtered.length === 0) && (
            <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
              {search ? "No matching members" : "No members yet"}
            </div>
          )}
        </div>
      )}

      <Pagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Pending Invites
              <Badge variant="secondary" className="ml-1 text-xs">{pendingInvites.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {pendingInvites.map((inv) => (
              <PendingInviteRow key={inv.id} invite={inv} orgId={orgId} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MemberDetailDialog({ member, orgId, children }: { member: Membership; orgId: string; children: React.ReactNode }) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.is_system_admin ?? false;
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(member.display_name || "");
  const [saving, setSaving] = useState(false);

  const dirty = displayName !== (member.display_name || "");

  const save = async () => {
    setSaving(true);
    try {
      if (isAdmin) {
        await api.patch(`/admin/users/${member.user_id}`, { display_name: displayName });
      } else {
        await api.patch("/auth/me", { display_name: displayName });
      }
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
      toast.success("Member updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setDisplayName(member.display_name || ""); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Member Details</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
              {(member.display_name || member.email || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <Badge variant="outline" className={`capitalize text-xs ${ROLE_COLORS[member.role] ?? ""}`}>{member.role}</Badge>
              <p className="text-xs text-muted-foreground mt-1">Joined {new Date(member.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={member.email || ""} disabled className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label>Last Active</Label>
            <Input value={member.last_login_at ? timeAgo(member.last_login_at) : "Never"} disabled className="bg-muted" />
          </div>
          {dirty && (
            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const invite = async () => {
    if (!email) return;
    setSending(true);
    try {
      await api.post(`/orgs/${orgId}/invites`, { email, org_role: role });
      toast.success(`Invite sent to ${email}`);
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
      setOpen(false);
      setEmail("");
      setRole("member");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Invite Member</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>They&apos;ll receive an email with a link to join your organization.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" onKeyDown={(e) => e.key === "Enter" && invite()} />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner — Full control</SelectItem>
                <SelectItem value="admin">Admin — Manage settings & members</SelectItem>
                <SelectItem value="member">Member — Standard access</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={invite} className="w-full" disabled={!email || sending}>
            {sending ? "Sending…" : "Send Invite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PendingInviteRow({ invite: inv, orgId }: { invite: Invite; orgId: string }) {
  const qc = useQueryClient();
  const [resending, setResending] = useState(false);

  const revoke = useMutation({
    mutationFn: () => api.del(`/orgs/${orgId}/invites/${inv.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-invites", orgId] }); toast.success("Invite revoked"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const resend = async () => {
    setResending(true);
    try {
      await api.post(`/orgs/${orgId}/invites`, { email: inv.email, org_role: inv.org_role });
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
      toast.success(`Invite resent to ${inv.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setResending(false);
    }
  };

  const daysLeft = Math.max(0, Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / 86400000));

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
          {inv.email.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-medium">{inv.email}</p>
          <p className="text-xs text-muted-foreground">
            {daysLeft > 0 ? `Expires in ${daysLeft}d` : "Expiring today"} · Sent {new Date(inv.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`capitalize text-xs ${ROLE_COLORS[inv.org_role] ?? ""}`}>{inv.org_role}</Badge>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={resend} disabled={resending}>
          <RefreshCw className={`h-3 w-3 ${resending ? "animate-spin" : ""}`} /> Resend
        </Button>
        <ConfirmDialog
          trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"><XCircle className="h-3.5 w-3.5" /></Button>}
          title="Revoke invite?"
          description={`The invite to ${inv.email} will be cancelled.`}
          onConfirm={() => revoke.mutate()}
        />
      </div>
    </div>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-users", page],
    queryFn: () => api.get<PaginatedResponse<{ id: string; email: string; display_name: string; is_system_admin: boolean; email_verified: boolean; sso_provider?: string; created_at: string; updated_at: string }>>("/admin/users", { page: String(page), per_page: "20" }),
  });

  const deleteUser = useMutation({
    mutationFn: (userId: string) => api.del(`/admin/users/${userId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("User deleted"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete user"),
  });

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; email: string } | null>(null);

  const filtered = data?.data?.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.display_name.toLowerCase().includes(search.toLowerCase())
  );

  if (isError) return <ErrorState message="Failed to load users" onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground">Total Users</p>
            <p className="text-2xl font-bold">{data?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground">Verified</p>
            <p className="text-2xl font-bold">{data?.data?.filter((u) => u.email_verified).length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-muted-foreground">System Admins</p>
            <p className="text-2xl font-bold">{data?.data?.filter((u) => u.is_system_admin).length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Input placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered?.map((u) => (
            <Card key={u.id} className="relative">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.display_name}</p>
                    <p className="text-sm text-muted-foreground font-mono truncate">{u.email}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {u.is_system_admin && <Badge variant="default" className="text-[10px]">Admin</Badge>}
                      <Badge variant={u.email_verified ? "default" : "outline"} className="text-[10px]">
                        {u.email_verified ? <><CheckCircle2 className="h-3 w-3 mr-0.5" /> Verified</> : <><XCircle className="h-3 w-3 mr-0.5" /> Unverified</>}
                      </Badge>
                      {u.sso_provider && <Badge variant="outline" className="text-[10px]"><Shield className="h-3 w-3 mr-0.5" /> {u.sso_provider}</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      <Calendar className="inline h-3 w-3 mr-0.5" /> Joined {new Date(u.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {u.id !== currentUser?.id && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ id: u.id, email: u.email })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered?.length === 0 && <p className="text-sm text-muted-foreground col-span-2 text-center py-8">No users found.</p>}
        </div>
      )}

      {data && data.total_pages > 1 && <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete user"
        description={`Permanently delete ${deleteTarget?.email}? This will remove all their data including org memberships, inboxes, and emails. This action cannot be undone.`}
        onConfirm={() => { if (deleteTarget) { deleteUser.mutate(deleteTarget.id); setDeleteTarget(null); } }}
        variant="destructive"
      />
    </div>
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
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);

  if (data && !initialized) { setForm(data); setInitialized(true); }

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
  const [initialized, setInitialized] = useState(false);

  // Sync form state when org loads
  if (org && !initialized) {
    setName(org.name);
    setLogoUrl(org.logo_url ?? "");
    setInitialized(true);
  }

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
