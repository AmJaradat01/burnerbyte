"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { Palette, Settings, Shield, Trash2, UserPlus, Users } from "lucide-react";
import type { Organization, Membership, OrgSettings } from "@/types";

export default function SettingsPage() {
  const { currentOrg, fetchOrgs } = useOrgStore();
  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> General</TabsTrigger>
          <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Members</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><GeneralTab org={currentOrg} onSaved={fetchOrgs} /></TabsContent>
        <TabsContent value="members"><MembersTab orgId={currentOrg.id} /></TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralTab({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const [name, setName] = useState(org.name);
  const [logoUrl, setLogoUrl] = useState(org.logo_url ?? "");
  const [settings, setSettings] = useState<OrgSettings>(org.settings || {});
  const [saving, setSaving] = useState(false);

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
        {/* Left column */}
        <div className="space-y-6">
          {/* Org identity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organization</CardTitle>
              <CardDescription>Name and branding for your org.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  {settings.primary_color && <div className="h-9 w-9 rounded-md border shrink-0" style={{ backgroundColor: settings.primary_color }} />}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Footer Text</Label>
                <Input value={settings.footer_text ?? ""} onChange={(e) => set("footer_text", e.target.value)} placeholder="Powered by BurnerByte" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Quotas */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Shield className="h-4 w-4" /> Policies & Quotas</CardTitle>
              <CardDescription>Limits and defaults for your organization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Attachments enabled</Label>
                <Switch checked={settings.attachments_enabled ?? true} onCheckedChange={(v) => set("attachments_enabled", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Enforce SSO</Label>
                <Switch checked={settings.enforce_sso ?? false} onCheckedChange={(v) => set("enforce_sso", v)} />
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

          {/* Danger zone */}
          <DangerZone org={org} onDeleted={onSaved} />
        </div>
      </div>

      {/* Save bar */}
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !dirty} size="lg">
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
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

function MembersTab({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isError, refetch } = useQuery({
    queryKey: ["org-members", orgId, page],
    queryFn: () => api.get<{ data: Membership[]; total: number; total_pages: number }>(`/orgs/${orgId}/members`, { page: String(page), per_page: "20" }),
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

  if (isError) return <ErrorState message="Failed to load members" onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Input placeholder="Filter by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <InviteDialog orgId={orgId} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered?.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.display_name || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.email || "—"}</TableCell>
                  <TableCell>
                    <Select value={m.role} onValueChange={(role) => changeRole.mutate({ userId: m.user_id, role })}>
                      <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["owner", "admin", "member"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                      title="Remove member?"
                      description={`${m.display_name || m.email} will lose access to this organization.`}
                      onConfirm={() => removeMember.mutate(m.user_id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {(!filtered || filtered.length === 0) && (
                <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">{search ? "No matching members" : "No members"}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}

function InviteDialog({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const invite = async () => {
    if (!email) return;
    setSending(true);
    try {
      await api.post(`/orgs/${orgId}/invites`, { email, org_role: role });
      toast.success("Invite sent");
      setOpen(false);
      setEmail("");
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
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
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
