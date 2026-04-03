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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CheckCircle2, Edit2, Shield, Users } from "lucide-react";

export function RolesTab() {
  const { orgRoles, teamRoles, orgPermissions, teamPermissions, refetch } = useRoles();
  const [editingRole, setEditingRole] = useState<RoleInfo | null>(null);
  const allPermissions = editingRole?.scope === "org" ? orgPermissions : teamPermissions;

  if (!orgRoles.length && !teamRoles.length) {
    return <div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Roles & Permissions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage role definitions and their permissions. Click a role to edit its permissions.
        </p>
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
            <RoleRow key={role.id} role={role} permissions={orgPermissions} index={i} onEdit={() => setEditingRole(role)} />
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
            <RoleRow key={role.id} role={role} permissions={teamPermissions} index={i} onEdit={() => setEditingRole(role)} />
          ))}
        </CardContent>
      </Card>

      {/* Edit Role Dialog */}
      {editingRole && (
        <EditRoleDialog
          role={editingRole}
          permissions={allPermissions}
          open={!!editingRole}
          onOpenChange={(open) => { if (!open) setEditingRole(null); }}
          onSaved={() => { setEditingRole(null); refetch(); }}
        />
      )}
    </div>
  );
}

function RoleRow({ role, permissions, index, onEdit }: { role: RoleInfo; permissions: PermissionInfo[]; index: number; onEdit: () => void }) {
  const permCount = role.permissions?.length ?? 0;
  const totalPerms = permissions.length;

  return (
    <div className={`flex items-center justify-between py-4 ${index > 0 ? "border-t" : ""}`}>
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
          {role.rank}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{role.label}</p>
            <Badge variant="outline" className="text-[10px] font-mono">{role.value}</Badge>
            {role.is_system && <Badge variant="secondary" className="text-[10px]">System</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{role.description}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {role.permissions?.slice(0, 4).map((p) => (
              <Badge key={p} variant="outline" className="text-[9px] font-mono px-1.5">{p.split(".").pop()}</Badge>
            ))}
            {permCount > 4 && <Badge variant="outline" className="text-[9px]">+{permCount - 4} more</Badge>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="text-xs">{permCount}/{totalPerms}</Badge>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onEdit}>
          <Edit2 className="h-3.5 w-3.5" /> Edit
        </Button>
      </div>
    </div>
  );
}

function EditRoleDialog({ role, permissions, open, onOpenChange, onSaved }: {
  role: RoleInfo;
  permissions: PermissionInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set(role.permissions ?? []));
  const [saving, setSaving] = useState(false);

  const togglePerm = (key: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelectedPerms(new Set(permissions.map((p) => p.key)));
  const deselectAll = () => setSelectedPerms(new Set());

  const dirty = label !== role.label || description !== role.description ||
    JSON.stringify([...selectedPerms].sort()) !== JSON.stringify([...(role.permissions ?? [])].sort());

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/admin/roles/${role.id}`, {
        label,
        description,
        permissions: [...selectedPerms],
      });
      toast.success(`${role.label} role updated`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Role: {role.label}
            <Badge variant="outline" className="text-[10px] font-mono">{role.scope}/{role.value}</Badge>
          </DialogTitle>
          <DialogDescription>Update the role label, description, and permissions.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Label + Description */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          {/* Permissions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Permissions ({selectedPerms.size}/{permissions.length})</Label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={selectAll}>Select all</Button>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={deselectAll}>Clear</Button>
              </div>
            </div>
            <div className="rounded-lg border divide-y">
              {permissions.map((perm) => {
                const checked = selectedPerms.has(perm.key);
                return (
                  <div key={perm.key} className={`flex items-center justify-between px-4 py-3 transition-colors ${checked ? "bg-primary/5" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {checked && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                        <p className="text-sm font-medium">{perm.label}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{perm.description}</p>
                      <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">{perm.key}</p>
                    </div>
                    <Switch checked={checked} onCheckedChange={() => togglePerm(perm.key)} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Save */}
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
