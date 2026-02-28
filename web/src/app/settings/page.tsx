"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import type { Organization, Membership, OrgSettings } from "@/types";

export default function SettingsPage() {
  const { currentOrg, fetchOrgs } = useOrgStore();

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{currentOrg.name} — Settings</h1>
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><OrgSettingsForm org={currentOrg} onSaved={fetchOrgs} /></TabsContent>
        <TabsContent value="members"><MembersTab orgId={currentOrg.id} /></TabsContent>
      </Tabs>
    </div>
  );
}

function OrgSettingsForm({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const [name, setName] = useState(org.name);
  const [settings, setSettings] = useState<OrgSettings>(org.settings || {});
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/orgs/${org.id}`, { name });
      await api.put(`/orgs/${org.id}/settings`, settings);
      onSaved();
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Organization</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Separator />
        <CardDescription>Policies</CardDescription>
        <div className="flex items-center justify-between">
          <Label>Attachments enabled</Label>
          <Switch checked={settings.attachments_enabled ?? true} onCheckedChange={(v) => setSettings({ ...settings, attachments_enabled: v })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Default inbox TTL</Label>
            <Input value={settings.default_inbox_ttl ?? ""} onChange={(e) => setSettings({ ...settings, default_inbox_ttl: e.target.value })} placeholder="1h" />
          </div>
          <div className="space-y-2">
            <Label>Max inbox TTL</Label>
            <Input value={settings.max_inbox_ttl ?? ""} onChange={(e) => setSettings({ ...settings, max_inbox_ttl: e.target.value })} placeholder="24h" />
          </div>
          <div className="space-y-2">
            <Label>Max attachment size (MB)</Label>
            <Input type="number" value={settings.max_attachment_size_mb ?? ""} onChange={(e) => setSettings({ ...settings, max_attachment_size_mb: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Max domains</Label>
            <Input type="number" value={settings.max_domains ?? ""} onChange={(e) => setSettings({ ...settings, max_domains: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Max teams</Label>
            <Input type="number" value={settings.max_teams ?? ""} onChange={(e) => setSettings({ ...settings, max_teams: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Max inboxes per domain</Label>
            <Input type="number" value={settings.max_inboxes_per_domain ?? ""} onChange={(e) => setSettings({ ...settings, max_inboxes_per_domain: Number(e.target.value) })} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label>Enforce SSO</Label>
          <Switch checked={settings.enforce_sso ?? false} onCheckedChange={(v) => setSettings({ ...settings, enforce_sso: v })} />
        </div>
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        <Separator />
        <div className="space-y-3">
          <CardDescription className="text-destructive font-semibold">Danger Zone</CardDescription>
          <p className="text-sm text-muted-foreground">Deleting the organization will permanently remove all teams, domains, inboxes, and emails. This cannot be undone.</p>
          <Input placeholder={`Type "${org.name}" to confirm`} value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} className="max-w-sm" />
          <Button variant="destructive" disabled={deleteConfirm !== org.name || deleting} onClick={async () => {
            setDeleting(true);
            try {
              await api.del(`/orgs/${org.id}`);
              toast.success("Organization deleted");
              onSaved();
              window.location.href = "/dashboard";
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed");
            } finally { setDeleting(false); }
          }}>{deleting ? "Deleting…" : "Delete organization"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MembersTab({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["org-members", orgId, page],
    queryFn: () => api.get<{ data: Membership[]; total: number; total_pages: number }>(`/orgs/${orgId}/members`, { page: String(page), per_page: "20" }),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/orgs/${orgId}/members/${userId}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-members", orgId] }); toast.success("Role updated"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/orgs/${orgId}/members/${userId}`),
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: ["org-members"] });
      const prev = qc.getQueryData(["org-members", orgId, page]);
      qc.setQueryData(["org-members", orgId, page], (old: any) =>
        old ? { ...old, data: old.data.filter((m: Membership) => m.user_id !== userId) } : old
      );
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["org-members", orgId, page], ctx.prev);
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Members</CardTitle>
        <InviteDialog orgId={orgId} />
      </CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
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
                <TableCell>{m.display_name}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>
                  <Select value={m.role} onValueChange={(role) => changeRole.mutate({ userId: m.user_id, role })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["owner", "admin", "member"].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm">Remove</Button>}
                    title="Remove member?"
                    description="This member will lose access to the organization."
                    onConfirm={() => remove.mutate(m.user_id)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination page={page} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
      </CardContent>
    </Card>
  );
}

function InviteDialog({ orgId }: { orgId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [open, setOpen] = useState(false);

  const invite = async () => {
    try {
      await api.post(`/orgs/${orgId}/invites`, { email, org_role: role });
      toast.success("Invite sent");
      setOpen(false);
      setEmail("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Invite member</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite a member</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["admin", "member"].map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={invite} className="w-full">Send invite</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
