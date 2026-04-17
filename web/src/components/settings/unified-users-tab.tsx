"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorState } from "@/components/error-state";
import { Pagination } from "@/components/pagination";
import { useRoles } from "@/hooks/use-roles";
import { AlertTriangle, CheckCircle2, Clock, LogOut, RefreshCw, Trash2, UserPlus, Users, XCircle } from "lucide-react";
import type { User, Membership, Invite, PaginatedResponse } from "@/types";

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  admin: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  member: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700",
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type MergedUser = User & { org_role?: string; membership_id?: string; member_created_at?: string; last_login_at?: string };

export function UnifiedUsersTab({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { currentRole } = useOrgStore();
  const isAdmin = currentUser?.is_system_admin ?? false;
  const canManageMembers = currentRole === "owner" || isAdmin;
  const canInvite = currentRole === "owner" || currentRole === "admin" || isAdmin;
  const { orgRoles } = useRoles();
  const [page, setPage] = useState(1);
  const [membersPage, setMembersPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "members" | "non-members" | "unverified" | "admin">("all");

  // All platform users (admin) or just org members (non-admin)
  const { data: usersData, isLoading: usersLoading, isError: usersError, refetch: refetchUsers } = useQuery({
    queryKey: ["admin-users", page],
    queryFn: () => api.get<PaginatedResponse<User>>("/admin/users", { page: String(page), per_page: "50" }),
    enabled: isAdmin,
  });

  const { data: membersData, isLoading: membersLoading, isError: membersError, refetch: refetchMembers } = useQuery({
    queryKey: ["org-members", orgId, membersPage],
    queryFn: () => api.get<{ data: Membership[]; total: number; total_pages?: number }>(`/orgs/${orgId}/members`, { page: String(membersPage), per_page: "100" }),
  });

  const { data: invitesData } = useQuery({
    queryKey: ["org-invites", orgId],
    queryFn: () => api.get<{ data: Invite[] }>(`/orgs/${orgId}/invites`),
  });

  const isLoading = (isAdmin ? usersLoading : membersLoading) || membersLoading;
  const isError = isAdmin ? usersError : membersError;
  const refetch = () => { refetchUsers(); refetchMembers(); };

  // Merge users + membership data
  const members = membersData?.data ?? [];
  const memberMap = new Map(members.map((m) => [m.user_id, m]));
  const pendingInvites = invitesData?.data ?? [];

  const allUsers: MergedUser[] = isAdmin
    ? (usersData?.data ?? []).map((u) => {
        const m = memberMap.get(u.id);
        return { ...u, org_role: m?.role, membership_id: m?.id, member_created_at: m?.created_at, last_login_at: m?.last_login_at };
      })
    : members.map((m) => ({
        id: m.user_id, email: m.email ?? "", display_name: m.display_name ?? "", is_system_admin: false,
        email_verified: true, created_at: m.created_at, updated_at: m.created_at,
        org_role: m.role, membership_id: m.id, member_created_at: m.created_at, last_login_at: m.last_login_at,
      }));

  const filtered = allUsers.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || u.email.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q);
    const matchesFilter =
      filter === "all" ||
      (filter === "members" && !!u.org_role) ||
      (filter === "non-members" && !u.org_role) ||
      (filter === "unverified" && !u.email_verified) ||
      (filter === "admin" && u.is_system_admin);
    return matchesSearch && matchesFilter;
  });

  const memberCount = allUsers.filter((u) => u.org_role).length;
  const nonMemberCount = allUsers.filter((u) => !u.org_role).length;
  const unverifiedCount = allUsers.filter((u) => !u.email_verified).length;

  // Mutations
  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => api.patch(`/orgs/${orgId}/members/${userId}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-members"] }); toast.success("Role updated"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.del(`/orgs/${orgId}/members/${userId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-members"] }); qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("Removed from organization"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const deleteUser = useMutation({
    mutationFn: (userId: string) => api.del(`/admin/users/${userId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["org-members"] }); toast.success("User deleted"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const forceLogout = useMutation({
    mutationFn: (userId: string) => api.del(`/admin/users/${userId}/sessions`),
    onSuccess: () => toast.success("All sessions revoked"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to revoke sessions"),
  });

  if (isError) return <ErrorState message="Failed to load users" onRetry={refetch} />;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className={`grid gap-4 ${isAdmin ? "grid-cols-2 md:grid-cols-4" : "grid-cols-3"}`}>
        <StatCard label="Total" value={isAdmin ? (usersData?.total ?? 0) : members.length} icon={<Users className="h-4 w-4 text-muted-foreground" />} active={filter === "all"} onClick={() => setFilter("all")} />
        <StatCard label="Members" value={memberCount} icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} active={filter === "members"} onClick={() => setFilter(filter === "members" ? "all" : "members")} />
        {isAdmin && <StatCard label="No Org" value={nonMemberCount} icon={<AlertTriangle className="h-4 w-4 text-orange-500" />} active={filter === "non-members"} onClick={() => setFilter(filter === "non-members" ? "all" : "non-members")} />}
        <StatCard label="Pending Invites" value={pendingInvites.length} icon={<Clock className="h-4 w-4 text-blue-500" />} active={false} onClick={() => {}} />
        {isAdmin && <StatCard label="Unverified" value={unverifiedCount} icon={<XCircle className="h-4 w-4 text-red-500" />} active={filter === "unverified"} onClick={() => setFilter(filter === "unverified" ? "all" : "unverified")} />}
      </div>

      {/* Search + Invite */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-1 max-w-lg">
          <Input placeholder="Search by name, email, or ID…" value={search} onChange={(e) => { setSearch(e.target.value); }} />
          {(search || filter !== "all") && (
            <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => { setSearch(""); setFilter("all"); }}>Clear</Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {filter !== "all" && (
            <Badge variant="secondary" className="gap-1 text-xs">{filter} <button onClick={() => setFilter("all")} className="ml-1 hover:text-foreground">×</button></Badge>
          )}
          <span className="text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
          {canInvite && <InviteDialog orgId={orgId} />}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded" />)}</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left font-medium text-xs text-muted-foreground px-4 py-3">User</th>
                  <th className="text-left font-medium text-xs text-muted-foreground px-4 py-3">Org Role</th>
                  {isAdmin && <th className="text-left font-medium text-xs text-muted-foreground px-4 py-3 hidden md:table-cell">Status</th>}
                  <th className="text-left font-medium text-xs text-muted-foreground px-4 py-3 hidden lg:table-cell">Last Active</th>
                  <th className="text-left font-medium text-xs text-muted-foreground px-4 py-3 hidden lg:table-cell">Joined</th>
                  <th className="text-right font-medium text-xs text-muted-foreground px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isYou = u.id === currentUser?.id;
                  return (
                    <UserDetailDialog key={u.id} user={u} orgId={orgId} isYou={isYou} isAdmin={isAdmin}>
                      <tr className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                              {(u.display_name || u.email).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-medium truncate text-sm">{u.display_name || "—"}</p>
                                {isYou && <Badge variant="outline" className="text-[10px] px-1 py-0">you</Badge>}
                                {u.is_system_admin && <Badge variant="default" className="text-[10px] px-1 py-0">Admin</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground font-mono truncate">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {u.org_role ? (
                            canManageMembers ? (
                              <Select value={u.org_role} onValueChange={(role) => changeRole.mutate({ userId: u.id, role })}>
                                <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {orgRoles.map((r) => <SelectItem key={r.value} value={r.value} className="capitalize">{r.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="outline" className={`capitalize text-xs ${ROLE_COLORS[u.org_role] ?? ""}`}>{u.org_role}</Badge>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Not a member</span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 hidden md:table-cell">
                            <Badge variant={u.email_verified ? "default" : "outline"} className="text-[10px]">
                              {u.email_verified ? <><CheckCircle2 className="h-3 w-3 mr-0.5" /> Verified</> : <><XCircle className="h-3 w-3 mr-0.5" /> Unverified</>}
                            </Badge>
                          </td>
                        )}
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground">{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</span>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {!isYou && u.org_role && canInvite && (
                              <ConfirmDialog
                                trigger={<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-orange-500" title="Remove from org"><XCircle className="h-3.5 w-3.5" /></Button>}
                                title="Remove from organization?"
                                description={`${u.display_name || u.email} will lose access to this organization.`}
                                onConfirm={() => removeMember.mutate(u.id)}
                              />
                            )}
                            {!isYou && isAdmin && (
                              <ConfirmDialog
                                trigger={<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-orange-500" title="Force logout"><LogOut className="h-3.5 w-3.5" /></Button>}
                                title="Force logout?"
                                description={`Revoke all active sessions for ${u.display_name || u.email}? They will be signed out everywhere.`}
                                onConfirm={() => forceLogout.mutate(u.id)}
                              />
                            )}
                            {!isYou && isAdmin && (
                              <ConfirmDialog
                                trigger={<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Delete user"><Trash2 className="h-3.5 w-3.5" /></Button>}
                                title="Delete user?"
                                description={`Permanently delete ${u.email}? This removes all their data. This cannot be undone.`}
                                onConfirm={() => deleteUser.mutate(u.id)}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    </UserDetailDialog>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-12 text-sm font-medium text-muted-foreground">{search || filter !== "all" ? "No matching users" : "No users yet"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isAdmin && usersData && usersData.total_pages > 1 && <Pagination page={page} totalPages={usersData.total_pages} onPageChange={setPage} />}
      {!isAdmin && membersData && (membersData.total_pages ?? Math.ceil((membersData.total ?? 0) / 100)) > 1 && <Pagination page={membersPage} totalPages={membersData.total_pages ?? Math.ceil((membersData.total ?? 0) / 100)} onPageChange={setMembersPage} />}

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" /> Pending Invites
              <Badge variant="secondary" className="ml-1 text-xs">{pendingInvites.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {pendingInvites.map((inv) => <PendingInviteRow key={inv.id} invite={inv} orgId={orgId} />)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, active, onClick }: { label: string; value: number; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <Card className={`cursor-pointer transition-shadow hover:shadow-md ${active ? "ring-2 ring-primary" : ""}`} onClick={onClick}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          {icon}
        </div>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function UserDetailDialog({ user: u, orgId, isYou, isAdmin, children }: { user: MergedUser; orgId: string; isYou: boolean; isAdmin: boolean; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(u.display_name);
  const [isAdminFlag, setIsAdminFlag] = useState(u.is_system_admin);
  const [verified, setVerified] = useState(u.email_verified);
  const [avatarURL, setAvatarURL] = useState(u.avatar_url ?? "");
  const [timezone, setTimezone] = useState(u.timezone ?? "");
  const [dateFormat, setDateFormat] = useState(u.date_format ?? "");
  const [timeFormat, setTimeFormat] = useState(u.time_format ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = displayName !== u.display_name || isAdminFlag !== u.is_system_admin || verified !== u.email_verified || avatarURL !== (u.avatar_url ?? "") || timezone !== (u.timezone ?? "") || dateFormat !== (u.date_format ?? "") || timeFormat !== (u.time_format ?? "");

  const save = async () => {
    setSaving(true);
    try {
      if (isAdmin) {
        await api.patch(`/admin/users/${u.id}`, {
          display_name: displayName !== u.display_name ? displayName : undefined,
          avatar_url: avatarURL !== (u.avatar_url ?? "") ? avatarURL : undefined,
          is_system_admin: isAdminFlag !== u.is_system_admin ? isAdminFlag : undefined,
          email_verified: verified !== u.email_verified ? verified : undefined,
        });
      } else {
        await api.patch("/auth/me", {
          display_name: displayName !== u.display_name ? displayName : undefined,
          timezone: timezone !== (u.timezone ?? "") ? timezone : undefined,
          date_format: dateFormat !== (u.date_format ?? "") ? dateFormat : undefined,
          time_format: timeFormat !== (u.time_format ?? "") ? timeFormat : undefined,
        });
      }
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["org-members"] });
      toast.success("User updated");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const addToOrg = async () => {
    try {
      await api.post(`/orgs/${orgId}/members/add`, { user_id: u.id, role: "member" });
      qc.invalidateQueries({ queryKey: ["org-members"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(`${u.display_name || u.email} added to organization`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) { setDisplayName(u.display_name); setIsAdminFlag(u.is_system_admin); setVerified(u.email_verified); setAvatarURL(u.avatar_url ?? ""); setTimezone(u.timezone ?? ""); setDateFormat(u.date_format ?? ""); setTimeFormat(u.time_format ?? ""); }
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
          <DialogDescription>View and manage this user account.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
              {(u.display_name || u.email).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-lg truncate">{u.display_name || "—"}</p>
              <p className="text-sm text-muted-foreground font-mono truncate">{u.email}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {u.org_role && <Badge variant="outline" className={`capitalize text-[10px] ${ROLE_COLORS[u.org_role] ?? ""}`}>{u.org_role}</Badge>}
                {!u.org_role && <Badge variant="outline" className="text-[10px] text-orange-600">Not a member</Badge>}
                {u.is_system_admin && <Badge variant="default" className="text-[10px]">System Admin</Badge>}
                <Badge variant={u.email_verified ? "default" : "outline"} className="text-[10px]">
                  {u.email_verified ? "Verified" : "Unverified"}
                </Badge>
                {u.sso_provider && <Badge variant="outline" className="text-[10px]">{u.sso_provider}</Badge>}
                {isYou && <Badge variant="outline" className="text-[10px]">You</Badge>}
              </div>
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">User ID</p>
              <p className="font-mono text-xs truncate">{u.id}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Auth Method</p>
              <p className="text-xs">{u.sso_provider ?? "Password"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Registered</p>
              <p className="text-xs">{new Date(u.created_at).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Last Active</p>
              <p className="text-xs">{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</p>
            </div>
          </div>

          {/* Add to org button for non-members */}
          {!u.org_role && (
            <Button variant="outline" className="w-full gap-2" onClick={addToOrg}>
              <UserPlus className="h-4 w-4" /> Add to Organization
            </Button>
          )}

          {/* Editable fields */}
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={u.email} disabled className="bg-muted font-mono text-sm" />
            </div>
            {isAdmin && (
              <div className="space-y-2">
                <Label>Avatar URL</Label>
                <Input value={avatarURL} onChange={(e) => setAvatarURL(e.target.value)} placeholder="https://..." />
              </div>
            )}
            {(isAdmin || isYou) && (
              <>
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. America/New_York, UTC" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Date Format</Label>
                    <Select value={dateFormat || "YYYY-MM-DD"} onValueChange={setDateFormat}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Time Format</Label>
                    <Select value={timeFormat || "24h"} onValueChange={setTimeFormat}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24h">24-hour</SelectItem>
                        <SelectItem value="12h">12-hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
            {isAdmin && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Email Verified</Label>
                    <p className="text-xs text-muted-foreground">Manually verify or unverify this user&apos;s email.</p>
                  </div>
                  <Switch checked={verified} onCheckedChange={setVerified} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>System Admin</Label>
                    <p className="text-xs text-muted-foreground">Grant full platform administration privileges.</p>
                  </div>
                  <Switch checked={isAdminFlag} onCheckedChange={setIsAdminFlag} disabled={isYou} />
                </div>
              </>
            )}
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
  const { orgRoles, teamRoles } = useRoles();
  const teams = useOrgStore((s) => s.teams);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [teamId, setTeamId] = useState("none");
  const [teamRole, setTeamRole] = useState("member");
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const emailValid = /^[^\s@]+@[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(email);

  const invite = async () => {
    if (!email || !emailValid) return;
    setSending(true);
    try {
      const payload: Record<string, string> = { email, org_role: role };
      if (teamId && teamId !== "none") {
        payload.team_id = teamId;
        payload.team_role = teamRole;
      }
      await api.post(`/orgs/${orgId}/invites`, payload);
      toast.success(`Invite sent to ${email}`);
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
      setOpen(false);
      setEmail("");
      setRole("member");
      setTeamId("none");
      setTeamRole("member");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEmail(""); setRole("member"); setTeamId("none"); setTeamRole("member"); } }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Invite User</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>They&apos;ll receive an email with a link to join your organization{teamId && teamId !== "none" ? " and be added to the selected team" : ""}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" onKeyDown={(e) => e.key === "Enter" && invite()} />
            {email && !emailValid && (
              <p className="text-xs text-destructive">Please enter a valid email address</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Organization Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {orgRoles.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label} — {r.description}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {teams.length > 0 && (
            <div className="border-t pt-4 space-y-3">
              <div className="space-y-1">
                <Label>Assign to Team <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground">The user will be automatically added to this team when they accept the invite.</p>
              </div>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger><SelectValue placeholder="No team — org only" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team — org only</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {teamId && teamId !== "none" && (
                <div className="space-y-2">
                  <Label>Team Role</Label>
                  <Select value={teamRole} onValueChange={setTeamRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {teamRoles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}{r.description ? ` — ${r.description}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <Button onClick={invite} className="w-full" disabled={!email || !emailValid || sending}>
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
        {inv.team_name && (
          <Badge variant="outline" className="text-xs text-violet-600 border-violet-200 dark:text-violet-400 dark:border-violet-800">
            {inv.team_name}{inv.team_role ? ` · ${inv.team_role}` : ""}
          </Badge>
        )}
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
