"use client";

import { useState, useMemo, useCallback } from "react";
import {
  useRoles,
  type RoleInfo,
  type PermissionInfo,
} from "@/hooks/use-roles";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit2,
  GitCompareArrows,
  Plus,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PermissionGroup {
  name: string;
  permissions: PermissionInfo[];
}

const GROUP_LABEL_MAP: Record<string, string> = {
  settings: "Settings",
  members: "Members",
  domains: "Domains",
  teams: "Teams",
  audit: "Audit",
  analytics: "Analytics",
  webhooks: "Webhooks",
  apikeys: "API Keys",
  inboxes: "Inboxes",
  emails: "Emails",
};

function extractGroupKey(permKey: string): string {
  const parts = permKey.split(".");
  return parts.length >= 2 ? parts[1] : "other";
}

function groupLabel(key: string): string {
  return GROUP_LABEL_MAP[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function groupPermissions(permissions: PermissionInfo[]): PermissionGroup[] {
  const map = new Map<string, PermissionInfo[]>();
  for (const p of permissions) {
    const key = extractGroupKey(p.key);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, perms]) => ({ name: groupLabel(key), permissions: perms }));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RolesTab() {
  const { orgRoles, teamRoles, orgPermissions, teamPermissions, refetch } =
    useRoles();
  const [editingRole, setEditingRole] = useState<RoleInfo | null>(null);
  const [compareScope, setCompareScope] = useState<"org" | "team" | null>(null);

  const allPermissions =
    editingRole?.scope === "org" ? orgPermissions : teamPermissions;

  const deleteRole = async (role: RoleInfo) => {
    try {
      await api.del(`/admin/roles/${role.id}`);
      toast.success(`Role "${role.label}" deleted`);
      refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete role",
      );
    }
  };

  if (!orgRoles.length && !teamRoles.length) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center">
                <Shield className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">Roles &amp; Permissions</CardTitle>
                <CardDescription>Manage roles and their permissions across your organization and teams.</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CreateRoleDialog
                orgPermissions={orgPermissions}
                teamPermissions={teamPermissions}
                onCreated={refetch}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Summary */}
      <p className="text-sm text-muted-foreground tabular-nums">
        <span className="font-semibold text-foreground">{orgRoles.length}</span> org role{orgRoles.length !== 1 ? "s" : ""}
        {" · "}
        <span className="font-semibold text-foreground">{teamRoles.length}</span> team role{teamRoles.length !== 1 ? "s" : ""}
        {" · "}
        <span className="font-semibold text-foreground">{orgPermissions.length + teamPermissions.length}</span> total permissions
      </p>

      {/* Tabbed interface */}
      <Tabs defaultValue="org">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="org" className="gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Org Roles
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Team Roles
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="org" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Control access to organization-level resources.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setCompareScope("org")}
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              Compare
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {orgRoles.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                totalPermissions={orgPermissions.length}
                onEdit={() => setEditingRole(role)}
                onDelete={() => deleteRole(role)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Control access to team-level resources.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setCompareScope("team")}
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              Compare
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teamRoles.map((role) => (
              <RoleCard
                key={role.id}
                role={role}
                totalPermissions={teamPermissions.length}
                onEdit={() => setEditingRole(role)}
                onDelete={() => deleteRole(role)}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      {editingRole && (
        <EditRoleDialog
          role={editingRole}
          permissions={allPermissions}
          open={!!editingRole}
          onOpenChange={(open) => {
            if (!open) setEditingRole(null);
          }}
          onSaved={() => {
            setEditingRole(null);
            refetch();
          }}
        />
      )}

      {/* Compare dialog */}
      {compareScope && (
        <CompareDialog
          scope={compareScope}
          roles={compareScope === "org" ? orgRoles : teamRoles}
          permissions={
            compareScope === "org" ? orgPermissions : teamPermissions
          }
          open={!!compareScope}
          onOpenChange={(open) => {
            if (!open) setCompareScope(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Role Card
// ---------------------------------------------------------------------------

function RoleCard({
  role,
  totalPermissions,
  onEdit,
  onDelete,
}: {
  role: RoleInfo;
  totalPermissions: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const permCount = role.permissions?.length ?? 0;
  const permPercent = totalPermissions > 0 ? Math.round((permCount / totalPermissions) * 100) : 0;

  return (
    <Card className="flex flex-col transition-colors duration-150 hover:border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm">{role.label}</CardTitle>
              <Badge variant="outline" className="text-[10px] font-mono">
                {role.value}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              {role.is_system && (
                <Badge variant="secondary" className="text-[10px]">
                  System
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                Rank {role.rank}
              </Badge>
            </div>
          </div>
        </div>
        <CardDescription className="mt-1 text-xs line-clamp-2">
          {role.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto pt-0">
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{permCount}/{totalPermissions} permissions</span>
            <span>{permPercent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${permPercent}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8"
              onClick={onEdit}
            >
              <Edit2 className="h-3.5 w-3.5" />
              Edit
            </Button>
            {!role.is_system && (
              <ConfirmDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${role.label} role`}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
                title="Delete role?"
                description={`Delete the "${role.label}" role. This cannot be undone. Users with this role will lose their permissions.`}
                onConfirm={onDelete}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Grouped Permission Editor (shared by Create & Edit)
// ---------------------------------------------------------------------------

function PermissionEditor({
  permissions,
  selected,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  permissions: PermissionInfo[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSelectAll: (keys: string[]) => void;
  onDeselectAll: (keys: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupPermissions(permissions), [permissions]);

  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        permissions: g.permissions.filter(
          (p) =>
            p.label.toLowerCase().includes(q) ||
            p.key.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.permissions.length > 0);
  }, [groups, search]);

  const toggleCollapse = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Summary + search */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {selected.size} of {permissions.length} permissions enabled
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => onSelectAll(permissions.map((p) => p.key))}
          >
            All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => onDeselectAll(permissions.map((p) => p.key))}
          >
            None
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter permissions…"
          className="pl-9 h-8 text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Groups */}
      <div className="rounded-lg border divide-y max-h-[45vh] overflow-y-auto">
        {filtered.map((group) => {
          const isCollapsed = collapsed.has(group.name);
          const enabledInGroup = group.permissions.filter((p) =>
            selected.has(p.key),
          ).length;
          const groupKeys = group.permissions.map((p) => p.key);

          return (
            <div key={group.name}>
              {/* Group header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 sticky top-0 z-10">
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm font-medium hover:text-foreground"
                  onClick={() => toggleCollapse(group.name)}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  {group.name}
                  <Badge variant="secondary" className="text-[10px] ml-1">
                    {enabledInGroup}/{group.permissions.length}
                  </Badge>
                </button>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[10px] h-6 px-2"
                    onClick={() => onSelectAll(groupKeys)}
                  >
                    All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[10px] h-6 px-2"
                    onClick={() => onDeselectAll(groupKeys)}
                  >
                    None
                  </Button>
                </div>
              </div>

              {/* Permission rows */}
              {!isCollapsed &&
                group.permissions.map((perm) => {
                  const checked = selected.has(perm.key);
                  return (
                    <div
                      key={perm.key}
                      className={`flex items-center justify-between px-4 py-3 ${checked ? "bg-primary/5" : ""}`}
                    >
                      <div className="min-w-0 flex-1 pr-4">
                        <div className="flex items-center gap-2">
                          {checked && (
                            <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                          )}
                          <span className="text-sm font-medium">
                            {perm.label}
                          </span>
                          <code className="text-[10px] text-muted-foreground font-mono ml-auto hidden sm:inline">
                            {perm.key}
                          </code>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {perm.description}
                        </p>
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={() => onToggle(perm.key)}
                      />
                    </div>
                  );
                })}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No permissions match your search.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Role Dialog
// ---------------------------------------------------------------------------

function CreateRoleDialog({
  orgPermissions,
  teamPermissions,
  onCreated,
}: {
  orgPermissions: PermissionInfo[];
  teamPermissions: PermissionInfo[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("org");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [rank, setRank] = useState(1);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const permissions = scope === "org" ? orgPermissions : teamPermissions;

  const togglePerm = useCallback((key: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback((keys: string[]) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  const deselectAll = useCallback((keys: string[]) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  const reset = () => {
    setValue("");
    setLabel("");
    setDescription("");
    setRank(1);
    setScope("org");
    setSelectedPerms(new Set());
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/admin/roles", {
        scope,
        value: value.toLowerCase().replace(/\s+/g, "_"),
        label,
        description,
        rank,
        permissions: [...selectedPerms],
      });
      toast.success("Role created");
      setOpen(false);
      reset();
      onCreated();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create role",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Create Role
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Role</DialogTitle>
          <DialogDescription>
            Add a new custom role with specific permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Basic info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v);
                  setSelectedPerms(new Set());
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="org">Organization</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Value (slug)</Label>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="e.g. auditor"
                />
              </div>
              <div className="space-y-2">
                <Label>Rank (higher = more access)</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={rank}
                  onChange={(e) => setRank(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Auditor"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this role can do"
              />
            </div>
          </div>

          {/* Permissions */}
          <PermissionEditor
            permissions={permissions}
            selected={selectedPerms}
            onToggle={togglePerm}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
          />
        </div>

        <DialogFooter>
          <Button
            onClick={save}
            className="w-full"
            disabled={!value || !label || saving}
          >
            {saving ? "Creating…" : "Create Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit Role Dialog
// ---------------------------------------------------------------------------

function EditRoleDialog({
  role,
  permissions,
  open,
  onOpenChange,
  onSaved,
}: {
  role: RoleInfo;
  permissions: PermissionInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description);
  const [selectedPerms, setSelectedPerms] = useState<Set<string>>(
    new Set(role.permissions ?? []),
  );
  const [saving, setSaving] = useState(false);

  const togglePerm = useCallback((key: string) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback((keys: string[]) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  const deselectAll = useCallback((keys: string[]) => {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  const dirty =
    label !== role.label ||
    description !== role.description ||
    JSON.stringify([...selectedPerms].sort()) !==
      JSON.stringify([...(role.permissions ?? [])].sort());

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/admin/roles/${role.id}`, {
        label,
        description,
        permissions: [...selectedPerms],
      });
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit: {role.label}
            <Badge variant="outline" className="text-[10px] font-mono">
              {role.scope}/{role.value}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Update label, description, and permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <PermissionEditor
            permissions={permissions}
            selected={selectedPerms}
            onToggle={togglePerm}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
          />
        </div>

        {dirty && (
          <DialogFooter>
            <Button onClick={save} disabled={saving} className="w-full">
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Compare Dialog
// ---------------------------------------------------------------------------

function CompareDialog({
  scope,
  roles,
  permissions,
  open,
  onOpenChange,
}: {
  scope: "org" | "team";
  roles: RoleInfo[];
  permissions: PermissionInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = useMemo(() => groupPermissions(permissions), [permissions]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Compare {scope === "org" ? "Organization" : "Team"} Roles
          </DialogTitle>
          <DialogDescription>
            Side-by-side permission matrix for all{" "}
            {scope === "org" ? "organization" : "team"} roles.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-auto flex-1 -mx-6 px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px] sticky left-0 bg-background z-10">
                  Permission
                </TableHead>
                {roles.map((role) => (
                  <TableHead
                    key={role.id}
                    className="text-center min-w-[100px]"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs font-medium">{role.label}</span>
                      <Badge
                        variant="secondary"
                        className="text-[9px]"
                      >
                        Rank {role.rank}
                      </Badge>
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <>
                  {/* Group header row */}
                  <TableRow key={`group-${group.name}`}>
                    <TableCell
                      colSpan={roles.length + 1}
                      className="bg-muted/40 font-medium text-xs py-2 sticky left-0"
                    >
                      {group.name}
                    </TableCell>
                  </TableRow>
                  {/* Permission rows */}
                  {group.permissions.map((perm) => (
                    <TableRow key={perm.key}>
                      <TableCell className="sticky left-0 bg-background z-10">
                        <div>
                          <span className="text-sm">{perm.label}</span>
                          <code className="text-[10px] text-muted-foreground font-mono ml-2">
                            {perm.key}
                          </code>
                        </div>
                      </TableCell>
                      {roles.map((role) => {
                        const has = role.permissions?.includes(perm.key);
                        return (
                          <TableCell key={role.id} className="text-center">
                            {has ? (
                              <CheckCircle2 className="h-4 w-4 text-success mx-auto" />
                            ) : (
                              <span className="text-muted-foreground/30">
                                —
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
