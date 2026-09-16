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
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock, Copy, KeyRound, Lock, LogOut, Mail, Minus, Plus, RefreshCw, Shield, Trash2, Upload, UserPlus, Users, XCircle } from "lucide-react";
import type { User, Membership, Invite, PaginatedResponse } from "@/types";
import { ProviderIcon } from "@/components/provider-icon";

interface SSOStatusProvider { name: string; provider_type: string; label: string; enabled: boolean; }
interface SSOStatus { enabled: boolean; allow_registration: boolean; enforce_sso?: boolean; providers?: SSOStatusProvider[]; }
interface TeamAssignmentRow { team_id: string; team_role: string; }
interface BulkInviteResult { created: number; skipped: { email: string; reason: string }[]; failed: { email: string; reason: string }[]; }

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-secondary text-secondary-foreground border-border",
  admin: "bg-info/10 text-info border-info/20",
  member: "bg-muted text-foreground border-border",
};

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type MergedUser = User & { org_role?: string; membership_id?: string; member_created_at?: string; last_login_at?: string; max_sessions?: number | null };

export function UnifiedUsersTab({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { hasPermission } = useOrgStore();
  const isAdmin = currentUser?.is_system_admin ?? false;
  const canManageMembers = hasPermission("org.members.role") || isAdmin;
  const canInvite = hasPermission("org.members.invite") || isAdmin;
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
        return { ...u, org_role: m?.role, membership_id: m?.id, member_created_at: m?.created_at, last_login_at: u.last_login_at || m?.last_login_at };
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

  const deactivateUser = useMutation({
    mutationFn: async (userId: string) => {
      await api.post(`/orgs/${orgId}/members/${userId}/deactivate`);
      // Also revoke all sessions so they're logged out immediately
      try { await api.del(`/admin/users/${userId}/sessions`); } catch {}
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["org-members"] }); qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("User deactivated"); },
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
      {/* Header */}
      <Card className="">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-muted flex items-center justify-center" aria-hidden="true">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">Users &amp; Members</CardTitle>
                <p className="text-sm text-muted-foreground">Manage platform users, org members, and invitations.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canInvite && <InviteDialog orgId={orgId} />}
              {canInvite && <BulkInviteDialog orgId={orgId} />}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Summary */}
      <p className="text-sm text-muted-foreground tabular-nums">
        <button className={`hover:text-foreground transition-colors duration-150 ${filter === "all" ? "font-semibold text-foreground" : ""}`} onClick={() => setFilter("all")}>{isAdmin ? (usersData?.total ?? 0) : members.length} user{(isAdmin ? (usersData?.total ?? 0) : members.length) !== 1 ? "s" : ""}</button>
        {" · "}
        <button className={`hover:text-foreground transition-colors duration-150 ${filter === "members" ? "font-semibold text-foreground" : ""}`} onClick={() => setFilter(filter === "members" ? "all" : "members")}>{memberCount} member{memberCount !== 1 ? "s" : ""}</button>
        {isAdmin && <>{" · "}<button className={`hover:text-foreground transition-colors duration-150 ${filter === "non-members" ? "font-semibold text-foreground" : ""}`} onClick={() => setFilter(filter === "non-members" ? "all" : "non-members")}>{nonMemberCount} no org</button></>}
        {" · "}{pendingInvites.length} pending
        {isAdmin && <>{" · "}<button className={`hover:text-foreground transition-colors duration-150 ${filter === "unverified" ? "font-semibold text-foreground" : ""}`} onClick={() => setFilter(filter === "unverified" ? "all" : "unverified")}>{unverifiedCount} unverified</button></>}
      </p>

      {/* Search + Invite */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Input placeholder="Search by name, email, or ID…" value={search} onChange={(e) => { setSearch(e.target.value); }} className="pl-9" />
          <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          {(search || filter !== "all") && (
            <Button variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 text-xs" onClick={() => { setSearch(""); setFilter("all"); }}>Clear</Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {filter !== "all" && (
            <Badge variant="secondary" className="gap-1 text-xs capitalize">{filter.replace("-", " ")} <button onClick={() => setFilter("all")} className="ml-1 hover:text-foreground">×</button></Badge>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded" />)}</div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-striped">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left font-medium text-xs text-muted-foreground px-4 py-3">User</th>
                  <th className="text-left font-medium text-xs text-muted-foreground px-4 py-3">Org Role</th>
                  {isAdmin && <th className="text-left font-medium text-xs text-muted-foreground px-4 py-3 hidden md:table-cell">Auth</th>}
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
                      <tr className="border-b last:border-0 hover:bg-primary/[0.03] cursor-pointer transition-all duration-150 group">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-bold text-muted-foreground">
                              {(u.display_name || u.email).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-semibold truncate text-sm">{u.display_name || "—"}</p>
                                {isYou && <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-info/5 border-info/20 text-info">you</Badge>}
                                {u.is_system_admin && <Badge variant="default" className="text-[10px] px-1.5 py-0"><Shield className="h-2.5 w-2.5 mr-0.5" />Admin</Badge>}
                              </div>
                              <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{u.email}</p>
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
                            <Badge variant={u.sso_provider ? "outline" : "default"} className="text-[10px]">
                              {u.sso_provider ?? "Password"}
                            </Badge>
                          </td>
                        )}
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
                                trigger={<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Deactivate user" aria-label="Deactivate user"><XCircle className="h-3.5 w-3.5" /></Button>}
                                title="Deactivate user?"
                                description={`${u.display_name || u.email} will be removed from the organization and all teams. Their sessions will be revoked. The account will be preserved for audit purposes.`}
                                onConfirm={() => deactivateUser.mutate(u.id)}
                              />
                            )}
                            {!isYou && isAdmin && (
                              <ConfirmDialog
                                trigger={<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Force logout" aria-label="Force logout"><LogOut className="h-3.5 w-3.5" /></Button>}
                                title="Force logout?"
                                description={`Revoke all active sessions for ${u.display_name || u.email}? They will be signed out everywhere.`}
                                onConfirm={() => forceLogout.mutate(u.id)}
                              />
                            )}
                            {!isYou && isAdmin && (
                              <ConfirmDialog
                                trigger={<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Delete user" aria-label="Delete user"><Trash2 className="h-3.5 w-3.5" /></Button>}
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
                  <tr><td colSpan={7} className="text-center py-12 text-sm font-medium text-muted-foreground">{search || filter !== "all" ? "No matching users" : "No users yet"}</td></tr>
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


function UserDetailDialog({ user: u, orgId, isYou, isAdmin, children }: { user: MergedUser; orgId: string; isYou: boolean; isAdmin: boolean; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(u.display_name);
  const [isAdminFlag, setIsAdminFlag] = useState(u.is_system_admin);
  const [verified, setVerified] = useState(u.email_verified);
  const [timezone, setTimezone] = useState(u.timezone ?? "");
  const [dateFormat, setDateFormat] = useState(u.date_format ?? "");
  const [timeFormat, setTimeFormat] = useState(u.time_format ?? "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [authMethodLock, setAuthMethodLock] = useState<string>(u.auth_method_lock ?? "any");
  const [migratePasswordOpen, setMigratePasswordOpen] = useState(false);
  const [migratePassword, setMigratePassword] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [maxSessions, setMaxSessions] = useState<string>(u.max_sessions != null ? String(u.max_sessions) : "");

  const dirty = displayName !== u.display_name || isAdminFlag !== u.is_system_admin || verified !== u.email_verified || timezone !== (u.timezone ?? "") || dateFormat !== (u.date_format ?? "") || timeFormat !== (u.time_format ?? "") || authMethodLock !== (u.auth_method_lock ?? "any") || maxSessions !== (u.max_sessions != null ? String(u.max_sessions) : "");

  const copyId = () => {
    navigator.clipboard.writeText(u.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (isAdmin) {
        const maxSessionsChanged = maxSessions !== (u.max_sessions != null ? String(u.max_sessions) : "");
        await api.patch(`/admin/users/${u.id}`, {
          display_name: displayName !== u.display_name ? displayName : undefined,
          is_system_admin: isAdminFlag !== u.is_system_admin ? isAdminFlag : undefined,
          email_verified: verified !== u.email_verified ? verified : undefined,
          auth_method_lock: authMethodLock !== (u.auth_method_lock ?? "any") ? (authMethodLock === "any" ? null : authMethodLock) : undefined,
          ...(maxSessionsChanged ? { max_sessions: maxSessions === "" ? null : Number(maxSessions) } : {}),
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

  const deactivateFromOrg = async () => {
    try {
      await api.post(`/orgs/${orgId}/members/${u.id}/deactivate`);
      try { await api.del(`/admin/users/${u.id}/sessions`); } catch {}
      qc.invalidateQueries({ queryKey: ["org-members"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(`${u.display_name || u.email} deactivated`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const forceLogoutUser = async () => {
    try {
      await api.del(`/admin/users/${u.id}/sessions`);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(`All sessions revoked for ${u.display_name || u.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const deleteUser = async () => {
    try {
      await api.del(`/admin/users/${u.id}`);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["org-members"] });
      toast.success(`${u.email} deleted`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const migrateToSSO = async () => {
    setMigrating(true);
    try {
      await api.post(`/admin/users/${u.id}/migrate-auth`, { target: "sso" });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["org-members"] });
      toast.success(`${u.display_name || u.email} migrated to SSO`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrating(false);
    }
  };

  const migrateToPassword = async () => {
    if (!migratePassword) return;
    setMigrating(true);
    try {
      await api.post(`/admin/users/${u.id}/migrate-auth`, { target: "password", new_password: migratePassword });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["org-members"] });
      toast.success(`${u.display_name || u.email} migrated to password auth`);
      setMigratePasswordOpen(false);
      setMigratePassword("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) { setDisplayName(u.display_name); setIsAdminFlag(u.is_system_admin); setVerified(u.email_verified); setTimezone(u.timezone ?? ""); setDateFormat(u.date_format ?? ""); setTimeFormat(u.time_format ?? ""); setCopied(false); setAuthMethodLock(u.auth_method_lock ?? "any"); setMigratePasswordOpen(false); setMigratePassword(""); setMaxSessions(u.max_sessions != null ? String(u.max_sessions) : ""); }
    }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[95vw] max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl">User Details</DialogTitle>
          <DialogDescription>View and manage this user account.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* ── Profile Header ── */}
          <div className="flex items-start gap-5 p-5 rounded-xl bg-muted/40 border">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-muted text-3xl font-bold text-muted-foreground">
              {(u.display_name || u.email).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 space-y-2.5">
              <div>
                <p className="font-semibold text-xl truncate">{u.display_name || "—"}</p>
                <p className="text-sm text-muted-foreground font-mono truncate">{u.email}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {u.org_role && <Badge variant="outline" className={`capitalize text-[10px] ${ROLE_COLORS[u.org_role] ?? ""}`}>{u.org_role}</Badge>}
                {!u.org_role && <Badge variant="secondary" className="text-[10px]">Not a member</Badge>}
                {u.is_system_admin && <Badge variant="default" className="text-[10px]"><Shield className="h-3 w-3 mr-0.5" />System Admin</Badge>}
                <Badge variant={u.email_verified ? "default" : "outline"} className="text-[10px]">
                  {u.email_verified ? <><CheckCircle2 className="h-3 w-3 mr-0.5" />Verified</> : <><XCircle className="h-3 w-3 mr-0.5" />Unverified</>}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  <KeyRound className="h-3 w-3 mr-0.5" />{u.sso_provider ?? "Password"}
                </Badge>
                {u.auth_method_lock && u.auth_method_lock !== "any" && (
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/20">
                    <Lock className="h-3 w-3 mr-0.5" />{u.auth_method_lock === "sso" ? "SSO Locked" : "Password Locked"}
                  </Badge>
                )}
                {isYou && <Badge variant="outline" className="text-[10px] bg-info/5 border-info/20 text-info">You</Badge>}
              </div>
            </div>
          </div>

          {/* ── Two-Column Layout ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              {/* Account Information */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Account Information</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Copy className="h-3 w-3" />User ID</p>
                    <button onClick={copyId} className="font-mono text-xs truncate block w-full text-left hover:text-primary transition-colors duration-150" title="Click to copy">
                      {copied ? "Copied!" : u.id.slice(0, 8) + "…"}
                    </button>
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><KeyRound className="h-3 w-3" />Auth Method</p>
                    <p className="text-xs font-medium">{u.sso_provider ?? "Password"}</p>
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Clock className="h-3 w-3" />Registered</p>
                    <p className="text-xs">{new Date(u.created_at).toLocaleDateString()}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(u.created_at).toLocaleTimeString()}</p>
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Clock className="h-3 w-3" />Last Active</p>
                    <p className="text-xs font-medium">{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</p>
                    {u.last_login_at && <p className="text-[10px] text-muted-foreground">{new Date(u.last_login_at).toLocaleDateString()}</p>}
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Lock className="h-3 w-3" />Auth Lock</p>
                    <p className="text-xs font-medium">{u.auth_method_lock === "sso" ? "SSO Only" : u.auth_method_lock === "password" ? "Password Only" : "Any Method"}</p>
                  </div>
                  <div className="rounded-lg border p-3 space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Mail className="h-3 w-3" />Email Status</p>
                    <p className="text-xs font-medium">{u.email_verified ? "Verified" : "Unverified"}</p>
                  </div>
                </div>
              </div>

              {/* Organization Actions */}
              {(!u.org_role || (u.org_role && !isYou)) && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Organization</h3>
                  <div className="flex gap-2">
                    {!u.org_role && (
                      <Button variant="outline" className="gap-2" onClick={addToOrg}>
                        <UserPlus className="h-4 w-4" /> Add to Organization
                      </Button>
                    )}
                    {u.org_role && !isYou && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="outline" className="gap-2 text-warning hover:text-warning border-warning/20 hover:border-warning/30">
                            <XCircle className="h-4 w-4" /> Deactivate
                          </Button>
                        }
                        title="Deactivate user?"
                        description={`${u.display_name || u.email} will be removed from the organization and all teams. Their sessions will be revoked. The account will be preserved for audit purposes.`}
                        onConfirm={deactivateFromOrg}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {/* Edit Profile */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Edit Profile</h3>
                <div className="space-y-4 bg-muted/40 rounded-lg p-4">
                  <div className="space-y-2">
                    <Label>Display Name</Label>
                    <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input value={u.email} disabled className="bg-muted font-mono text-sm" />
                  </div>
                  {(isAdmin || isYou) && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label className="text-xs">Timezone</Label>
                        <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" className="h-8 text-xs" />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Date Format</Label>
                        <Select value={dateFormat || "YYYY-MM-DD"} onValueChange={setDateFormat}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                            <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                            <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Time Format</Label>
                        <Select value={timeFormat || "24h"} onValueChange={setTimeFormat}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="24h">24-hour</SelectItem>
                            <SelectItem value="12h">12-hour</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Admin Controls (full width below the two columns) ── */}
          {isAdmin && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Admin Controls</h3>
              <div className="space-y-3 bg-muted/40 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <Label className="text-sm">Email Verified</Label>
                      <p className="text-xs text-muted-foreground">Manually verify or unverify this user&apos;s email address.</p>
                    </div>
                  </div>
                  <Switch checked={verified} onCheckedChange={setVerified} />
                </div>
                <div className="border-t" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <Label className="text-sm">System Admin</Label>
                      <p className="text-xs text-muted-foreground">Grant full platform administration privileges.</p>
                    </div>
                  </div>
                  <Switch checked={isAdminFlag} onCheckedChange={setIsAdminFlag} disabled={isYou} />
                </div>
                <div className="border-t" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <Label className="text-sm">Auth Method Lock</Label>
                      <p className="text-xs text-muted-foreground">Restrict this user to a specific authentication method.</p>
                    </div>
                  </div>
                  <Select value={authMethodLock} onValueChange={setAuthMethodLock}>
                    <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any Method</SelectItem>
                      <SelectItem value="sso">SSO Only</SelectItem>
                      <SelectItem value="password">Password Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="border-t" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <Label className="text-sm">Session Limit</Label>
                      <p className="text-xs text-muted-foreground">Override the platform default max concurrent sessions for this user.</p>
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={maxSessions}
                    onChange={(e) => setMaxSessions(e.target.value)}
                    placeholder="Platform default"
                    className="w-36 h-8 text-xs"
                  />
                </div>
                <div className="border-t" />
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <Label className="text-sm">Auth Migration</Label>
                      <p className="text-xs text-muted-foreground">Migrate between authentication methods. All sessions will be revoked.</p>
                    </div>
                  </div>
                  <div className="ml-11 space-y-3">
                    {/* Migrate to SSO */}
                    <div className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-info" />
                          <div>
                            <p className="text-sm font-medium">Migrate to SSO</p>
                            <p className="text-[11px] text-muted-foreground">Clear password, lock to SSO-only. Requires linked SSO identity.</p>
                          </div>
                        </div>
                        <ConfirmDialog
                          trigger={
                            <Button variant="outline" size="sm" className="text-xs gap-1.5 shrink-0" disabled={migrating}>
                              {migrating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                              Migrate
                            </Button>
                          }
                          title="Migrate to SSO?"
                          description={`This will clear ${u.display_name || u.email}'s password, lock them to SSO-only login, and revoke all active sessions. They must have a linked SSO identity.`}
                          onConfirm={migrateToSSO}
                        />
                      </div>
                    </div>

                    {/* Migrate to Password */}
                    <div className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <KeyRound className="h-4 w-4 text-warning" />
                          <div>
                            <p className="text-sm font-medium">Migrate to Password</p>
                            <p className="text-[11px] text-muted-foreground">Set a new password, lock to password-only.</p>
                          </div>
                        </div>
                        {!migratePasswordOpen && (
                          <Button variant="outline" size="sm" className="text-xs gap-1.5 shrink-0" disabled={migrating} onClick={() => setMigratePasswordOpen(true)}>
                            <KeyRound className="h-3.5 w-3.5" /> Migrate
                          </Button>
                        )}
                      </div>
                      {migratePasswordOpen && (
                        <div className="flex items-center gap-2 pt-1">
                          <Input
                            type="password"
                            placeholder="Enter new password"
                            value={migratePassword}
                            onChange={(e) => setMigratePassword(e.target.value)}
                            className="h-9 flex-1 text-sm"
                            autoFocus
                          />
                          <ConfirmDialog
                            trigger={
                              <Button size="sm" className="text-xs shrink-0" disabled={!migratePassword || migrating}>
                                {migrating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Confirm"}
                              </Button>
                            }
                            title="Migrate to Password?"
                            description={`This will set a new password for ${u.display_name || u.email}, lock them to password-only login, and revoke all active sessions.`}
                            onConfirm={migrateToPassword}
                          />
                          <Button variant="ghost" size="sm" aria-label="Cancel" className="h-9 w-9 p-0 shrink-0" onClick={() => { setMigratePasswordOpen(false); setMigratePassword(""); }}>
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Save + Danger Zone ── */}
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex gap-2">
              {isAdmin && !isYou && (
                <>
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm" className="gap-1.5 text-warning hover:text-warning border-warning/20 hover:border-warning/30">
                        <LogOut className="h-3.5 w-3.5" /> Force Logout
                      </Button>
                    }
                    title="Force logout?"
                    description={`Revoke all active sessions for ${u.display_name || u.email}? They will be signed out everywhere.`}
                    onConfirm={forceLogoutUser}
                  />
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/50">
                        <Trash2 className="h-3.5 w-3.5" /> Delete User
                      </Button>
                    }
                    title="Delete user permanently?"
                    description={`This will permanently delete ${u.email} and all their data. This action cannot be undone.`}
                    onConfirm={deleteUser}
                  />
                </>
              )}
            </div>
            {dirty && (
              <Button onClick={save} disabled={saving} className="gap-2">
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            )}
          </div>
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
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  // Auth method state
  const [authAny, setAuthAny] = useState(true);
  const [authPassword, setAuthPassword] = useState(false);
  const [authSSO, setAuthSSO] = useState<Record<string, boolean>>({});

  // Multi-team assignments
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignmentRow[]>([]);

  // Fetch SSO providers
  const { data: ssoStatus } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatus>("/auth/sso-status"),
    staleTime: 60000,
  });
  const ssoProviders = (ssoStatus?.providers ?? []).filter(p => p.enabled);

  const emailValid = /^[^\s@]+@[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(email);

  const buildAllowedAuth = (): string[] => {
    if (authAny) return ["any"];
    const methods: string[] = [];
    if (authPassword) methods.push("password");
    for (const p of ssoProviders) {
      if (authSSO[p.name]) methods.push(`sso:${p.name}`);
    }
    return methods.length > 0 ? methods : ["any"];
  };

  const addTeamAssignment = () => {
    const usedTeamIds = new Set(teamAssignments.map(ta => ta.team_id));
    const available = teams.find(t => !usedTeamIds.has(t.id));
    if (available) {
      setTeamAssignments([...teamAssignments, { team_id: available.id, team_role: "member" }]);
    }
  };

  const removeTeamAssignment = (index: number) => {
    setTeamAssignments(teamAssignments.filter((_, i) => i !== index));
  };

  const updateTeamAssignment = (index: number, field: keyof TeamAssignmentRow, value: string) => {
    const updated = [...teamAssignments];
    updated[index] = { ...updated[index], [field]: value };
    setTeamAssignments(updated);
  };

  const resetForm = () => {
    setEmail("");
    setRole("member");
    setAuthAny(true);
    setAuthPassword(false);
    setAuthSSO({});
    setTeamAssignments([]);
  };

  const invite = async () => {
    if (!email || !emailValid) return;
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        email,
        org_role: role,
        allowed_auth: buildAllowedAuth(),
      };
      if (teamAssignments.length > 0) {
        payload.team_assignments = teamAssignments.map(ta => ({
          team_id: ta.team_id,
          team_role: ta.team_role,
        }));
      }
      await api.post(`/orgs/${orgId}/invites`, payload);
      toast.success(`Invite sent to ${email}`);
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
      setOpen(false);
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setSending(false);
    }
  };

  const usedTeamIds = new Set(teamAssignments.map(ta => ta.team_id));
  const canAddTeam = teams.length > 0 && teamAssignments.length < teams.length;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Invite User</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Invite a user</DialogTitle>
          <DialogDescription>They&apos;ll receive an email with a link to join your organization.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Email</Label>
              <div className="relative">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" onKeyDown={(e) => e.key === "Enter" && invite()} className="pl-9" />
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              {email && !emailValid && (
                <p className="text-xs text-destructive">Please enter a valid email address</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Organization Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {orgRoles.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label} — {r.description}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Auth Method Selector */}
          <div className="border-t pt-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Shield className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <Label className="text-sm font-medium">Allowed Auth Methods</Label>
                <p className="text-[11px] text-muted-foreground">Choose which methods this user can use to accept.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Any method</span>
                </div>
                <Switch checked={authAny} onCheckedChange={(v) => {
                  setAuthAny(v);
                  if (v) { setAuthPassword(false); setAuthSSO({}); }
                }} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Password</span>
                </div>
                <Switch checked={authAny || authPassword} disabled={authAny} onCheckedChange={setAuthPassword} />
              </div>
              {ssoProviders.map((p) => (
                <div key={p.name} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <ProviderIcon providerType={p.provider_type} className="h-4 w-4" />
                    <span className="text-sm capitalize">{p.label || p.name}</span>
                  </div>
                  <Switch checked={authAny || (authSSO[p.name] ?? false)} disabled={authAny} onCheckedChange={(v) => setAuthSSO({ ...authSSO, [p.name]: v })} />
                </div>
              ))}
            </div>
          </div>

          {/* Multi-Team Selector */}
          {teams.length > 0 && (
            <div className="border-t pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Team Assignments <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <p className="text-[11px] text-muted-foreground">Assign to teams when they accept.</p>
                  </div>
                </div>
                {canAddTeam && (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addTeamAssignment}>
                    <Plus className="h-3 w-3" /> Add Team
                  </Button>
                )}
              </div>
              {teamAssignments.map((ta, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={ta.team_id} onValueChange={(v) => updateTeamAssignment(i, "team_id", v)}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Select team" /></SelectTrigger>
                    <SelectContent>
                      {teams.filter(t => t.id === ta.team_id || !usedTeamIds.has(t.id)).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={ta.team_role} onValueChange={(v) => updateTeamAssignment(i, "team_role", v)}>
                    <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {teamRoles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" aria-label="Remove team assignment" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeTeamAssignment(i)}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button onClick={invite} className="w-full h-11 text-sm font-medium gap-2" disabled={!email || !emailValid || sending}>
            {sending ? <><RefreshCw className="h-4 w-4 animate-spin" /> Sending…</> : <><Mail className="h-4 w-4" /> Send Invite</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkInviteDialog({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { orgRoles, teamRoles } = useRoles();
  const teams = useOrgStore((s) => s.teams);
  const [open, setOpen] = useState(false);
  const [emailsText, setEmailsText] = useState("");
  const [role, setRole] = useState("member");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BulkInviteResult | null>(null);

  // Auth method state
  const [authAny, setAuthAny] = useState(true);
  const [authPassword, setAuthPassword] = useState(false);
  const [authSSO, setAuthSSO] = useState<Record<string, boolean>>({});

  // Multi-team assignments
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignmentRow[]>([]);

  // Fetch SSO providers
  const { data: ssoStatus } = useQuery({
    queryKey: ["sso-status"],
    queryFn: () => api.get<SSOStatus>("/auth/sso-status"),
    staleTime: 60000,
  });
  const ssoProviders = (ssoStatus?.providers ?? []).filter(p => p.enabled);

  const buildAllowedAuth = (): string[] => {
    if (authAny) return ["any"];
    const methods: string[] = [];
    if (authPassword) methods.push("password");
    for (const p of ssoProviders) {
      if (authSSO[p.name]) methods.push(`sso:${p.name}`);
    }
    return methods.length > 0 ? methods : ["any"];
  };

  const parseEmails = (): string[] => {
    return emailsText
      .split(/[\n,;]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);
  };

  const addTeamAssignment = () => {
    const usedTeamIds = new Set(teamAssignments.map(ta => ta.team_id));
    const available = teams.find(t => !usedTeamIds.has(t.id));
    if (available) {
      setTeamAssignments([...teamAssignments, { team_id: available.id, team_role: "member" }]);
    }
  };

  const removeTeamAssignment = (index: number) => {
    setTeamAssignments(teamAssignments.filter((_, i) => i !== index));
  };

  const updateTeamAssignment = (index: number, field: keyof TeamAssignmentRow, value: string) => {
    const updated = [...teamAssignments];
    updated[index] = { ...updated[index], [field]: value };
    setTeamAssignments(updated);
  };

  const resetForm = () => {
    setEmailsText("");
    setRole("member");
    setAuthAny(true);
    setAuthPassword(false);
    setAuthSSO({});
    setTeamAssignments([]);
    setResult(null);
  };

  const sendBulk = async () => {
    const emails = parseEmails();
    if (emails.length === 0) return;
    setSending(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        emails,
        org_role: role,
        allowed_auth: buildAllowedAuth(),
      };
      if (teamAssignments.length > 0) {
        payload.team_assignments = teamAssignments.map(ta => ({
          team_id: ta.team_id,
          team_role: ta.team_role,
        }));
      }
      const res = await api.post<BulkInviteResult>(`/orgs/${orgId}/invites/bulk`, payload);
      setResult(res);
      qc.invalidateQueries({ queryKey: ["org-invites", orgId] });
      if (res.created > 0) {
        toast.success(`${res.created} invite${res.created !== 1 ? "s" : ""} sent`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk invite failed");
    } finally {
      setSending(false);
    }
  };

  const emailCount = parseEmails().length;
  const usedTeamIds = new Set(teamAssignments.map(ta => ta.team_id));
  const canAddTeam = teams.length > 0 && teamAssignments.length < teams.length;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Bulk Invite</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" /> Bulk Invite</DialogTitle>
          <DialogDescription>Invite multiple users at once. All invites share the same role, auth methods, and team assignments.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {/* Email textarea */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Email Addresses</Label>
            <Textarea
              value={emailsText}
              onChange={(e) => setEmailsText(e.target.value)}
              placeholder={"user1@example.com\nuser2@example.com\nuser3@example.com"}
              rows={5}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Enter one email per line, or separate with commas. {emailCount > 0 && <span className="font-medium">{emailCount} email{emailCount !== 1 ? "s" : ""}</span>}
              {emailCount > 100 && <span className="text-destructive ml-1">(max 100)</span>}
            </p>
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

          {/* Auth Method Selector */}
          <div className="border-t pt-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <Shield className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <Label className="text-sm font-medium">Allowed Auth Methods</Label>
                <p className="text-[11px] text-muted-foreground">Applied to all invites in this batch.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Any method</span>
                </div>
                <Switch checked={authAny} onCheckedChange={(v) => {
                  setAuthAny(v);
                  if (v) { setAuthPassword(false); setAuthSSO({}); }
                }} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Password</span>
                </div>
                <Switch checked={authAny || authPassword} disabled={authAny} onCheckedChange={setAuthPassword} />
              </div>
              {ssoProviders.map((p) => (
                <div key={p.name} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <ProviderIcon providerType={p.provider_type} className="h-4 w-4" />
                    <span className="text-sm capitalize">{p.label || p.name}</span>
                  </div>
                  <Switch checked={authAny || (authSSO[p.name] ?? false)} disabled={authAny} onCheckedChange={(v) => setAuthSSO({ ...authSSO, [p.name]: v })} />
                </div>
              ))}
            </div>
          </div>

          {/* Multi-Team Selector */}
          {teams.length > 0 && (
            <div className="border-t pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                    <Users className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Team Assignments <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <p className="text-[11px] text-muted-foreground">Applied to all invites in this batch.</p>
                  </div>
                </div>
                {canAddTeam && (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addTeamAssignment}>
                    <Plus className="h-3 w-3" /> Add Team
                  </Button>
                )}
              </div>
              {teamAssignments.map((ta, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={ta.team_id} onValueChange={(v) => updateTeamAssignment(i, "team_id", v)}>
                    <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Select team" /></SelectTrigger>
                    <SelectContent>
                      {teams.filter(t => t.id === ta.team_id || !usedTeamIds.has(t.id)).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={ta.team_role} onValueChange={(v) => updateTeamAssignment(i, "team_role", v)}>
                    <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {teamRoles.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" aria-label="Remove team assignment" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeTeamAssignment(i)}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button onClick={sendBulk} className="w-full h-11 text-sm font-medium gap-2" disabled={emailCount === 0 || emailCount > 100 || sending}>
            {sending ? <><RefreshCw className="h-4 w-4 animate-spin" /> Sending…</> : <><Upload className="h-4 w-4" /> Send {emailCount} Invite{emailCount !== 1 ? "s" : ""}</>}
          </Button>

          {/* Results summary */}
          {result && (
            <div className="border-t pt-5 space-y-4">
              <p className="text-sm font-semibold">Results</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border p-3 bg-success/5">
                  <p className="text-2xl font-bold text-success tabular-nums">{result.created}</p>
                  <p className="text-xs font-medium text-success">Created</p>
                </div>
                <div className="rounded-xl border p-3 bg-warning/5">
                  <p className="text-2xl font-bold text-warning tabular-nums">{result.skipped?.length ?? 0}</p>
                  <p className="text-xs font-medium text-warning">Skipped</p>
                </div>
                <div className="rounded-xl border p-3 bg-destructive/5">
                  <p className="text-2xl font-bold text-destructive tabular-nums">{result.failed?.length ?? 0}</p>
                  <p className="text-xs font-medium text-destructive">Failed</p>
                </div>
              </div>
              {result.skipped && result.skipped.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-warning">Skipped</p>
                  {result.skipped.map((s, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{s.email} — {s.reason}</p>
                  ))}
                </div>
              )}
              {result.failed && result.failed.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">Failed</p>
                  {result.failed.map((f, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{f.email} — {f.reason}</p>
                  ))}
                </div>
              )}
            </div>
          )}
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
        {inv.team_assignments && inv.team_assignments.length > 0 ? (
          inv.team_assignments.map((ta: { team_id: string; team_name: string; team_role: string }) => (
            <Badge key={ta.team_id} variant="outline" className="text-xs text-primary border-primary/20">
              {ta.team_name} · {ta.team_role}
            </Badge>
          ))
        ) : inv.team_name ? (
          <Badge variant="outline" className="text-xs text-primary border-primary/20">
            {inv.team_name}{inv.team_role ? ` · ${inv.team_role}` : ""}
          </Badge>
        ) : null}
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={resend} disabled={resending}>
          <RefreshCw className={`h-3 w-3 ${resending ? "animate-spin" : ""}`} /> Resend
        </Button>
        <ConfirmDialog
          trigger={<Button variant="ghost" size="sm" aria-label="Revoke invite" className="h-7 w-7 p-0 text-destructive hover:text-destructive"><XCircle className="h-3.5 w-3.5" /></Button>}
          title="Revoke invite?"
          description={`The invite to ${inv.email} will be cancelled.`}
          onConfirm={() => revoke.mutate()}
        />
      </div>
    </div>
  );
}
