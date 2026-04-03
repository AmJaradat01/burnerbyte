"use client";

import { useState } from "react";
import { useRoles, type RoleInfo, type PermissionInfo } from "@/hooks/use-roles";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { CheckCircle2, Edit2, Plus, Shield, Trash2, Users } from "lucide-react";

export function RolesTab() {
  const { orgRoles, teamRoles, orgPermissions, teamPermissions, refetch } = useRoles();
  const [editingRole, setEditingRole] = useState<RoleInfo | null>(null);
  const allPermissions = editingRole?.scope === "org" ? orgPermissions : teamPermissions;

  const deleteRole = async (role: RoleInfo) => {
    try {
      await api.del(`/admin/roles/${role.id}`);
      toast.success(`Role "${role.label}" deleted`);
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete role");
    }
  };

  if (!orgRoles.length && !teamRoles.length) {
    return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Roles & Permissions</h2>
          <p className="text-sm text-muted-foreground mt-1">Manage roles and their permissions.</p>
        </div>
        <CreateRoleDialog onCreated={refetch} />
      </div>

      {/* Org Roles */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Organization Roles</CardTitle>
              <CardDescription>Control access to organization-level resources.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-0">
          {orgRoles.map((role, i) => (
            <RoleRow key={role.id} role={role} permissions={orgPermissions} index={i} onEdit={() => setEditingRole(role)} onDelete={() => deleteRole(role)} />
          ))}
        </CardContent>
      </Card>

      {/* Team Roles */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Team Roles</CardTitle>
              <CardDescription>Control access to team-level resources.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-0">
          {teamRoles.map((role, i) => (
            <RoleRow key={role.id} role={role} permissions={teamPermissions} index={i} onEdit={() => setEditingRole(role)} onDelete={() => deleteRole(role)} />
          ))}
        </CardContent>
      </Card>

      {editingRole && (
        <EditRoleDialog role={editingRole} permissions={allPermissions} open={!!editingRole} onOpenChange={(open) => { if (!open) setEditingRole(null); }} onSaved={() => { setEditingRole(null); refetch(); }} />
      )}
    </div>
  );
}

function RoleRow({ role, permissions, index, onEdit, onDelete }: { role: RoleInfo; permissions: PermissionInfo[]; index: number; onEdit: () => void; onDelete: () => void }) {
  const permCount = role.permissions?.length ?? 0;
  return (
    <div className={`flex items-center justify-between py-4 ${index > 0 ? "border-t" : ""}`}>
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">{role.rank}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium">{role.label}</p>
            <Badge variant="outline" className="text-[10px] font-mono">{role.value}</Badge>
            {role.is_system && <Badge variant="secondary" className="text-[10px]">System</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">{role.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="secondary" className="text-xs">{permCount}/{permissions.length}</Badge>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onEdit}><Edit2 className="h-3.5 w-3.5" /> Edit</Button>
        {!role.is_system && (
          <ConfirmDialog
            trigger={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
            title="Delete role?"
            description={`Delete the "${role.label}" role. This cannot be undone. Users with this role will lose their permissions.`}
            onConfirm={onDelete}
          />
        )}
      </div>
    </div>
  );
}

function CreateRoleDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("org");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [rank, setRank] = useState(1);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/admin/roles", { scope, value: value.toLowerCase().replace(/\s+/g, "_"), label, description, rank });
      toast.success("Role created");
      setOpen(false);
      setValue(""); setLabel(""); setDescription(""); setRank(1);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Create Role</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Role</DialogTitle>
          <DialogDescription>Add a new custom role with specific permissions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="org">Organization</SelectItem>
                <SelectItem value="team">Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Value (slug)</Label>
              <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. auditor" />
            </div>
            <div className="space-y-2">
              <Label>Rank (higher = more access)</Label>
              <Input type="number" min={1} max={10} value={rank} onChange={(e) => setRank(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Auditor" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this role can do" />
          </div>
          <Button onClick={save} className="w-full" disabled={!value || !label || saving}>
            {saving ? "Creating…" : "Create Role"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditRoleDialog({ role, permissions, open, onOpenChange, onSaved }: { role: RoleInfo; permissions: PermissionInfo[]; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set(role.permissions ?? []));
  const [saving, setSaving] = useState(false);

  const togglePerm = (key: string) => {
    setSelectedPerms((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  };

  const dirty = label !== role.label || description !== role.description || JSON.stringify([...selectedPerms].sort()) !== JSON.stringify([...(role.permissions ?? [])].sort());

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/admin/roles/${role.id}`, { label, description, permissions: [...selectedPerms] });
      toast.success(`${role.label} updated`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit: {role.label} <Badge variant="outline" className="text-[10px] font-mono ml-2">{role.scope}/{role.value}</Badge></DialogTitle>
          <DialogDescription>Update label, description, and permissions.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="space-y-2"><Label>Label</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            <div className="space-y-2"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Permissions ({selectedPerms.size}/{permissions.length})</Label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedPerms(new Set(permissions.map((p) => p.key)))}>All</Button>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelectedPerms(new Set())}>None</Button>
              </div>
            </div>
            <div className="rounded-lg border divide-y">
              {permissions.map((perm) => {
                const checked = selectedPerms.has(perm.key);
                return (
                  <div key={perm.key} className={`flex items-center justify-between px-4 py-3 ${checked ? "bg-primary/5" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {checked && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                        <p className="text-sm font-medium">{perm.label}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{perm.description}</p>
                    </div>
                    <Switch checked={checked} onCheckedChange={() => togglePerm(perm.key)} />
                  </div>
                );
              })}
            </div>
          </div>
          {dirty && <Button onClick={save} disabled={saving} className="w-full">{saving ? "Saving…" : "Save Changes"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
