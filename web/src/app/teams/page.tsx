"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRoles } from "@/hooks/use-roles";
import { ArrowLeft, CheckCircle2, Clock, Globe, Inbox, Plus, Settings, Trash2, UserPlus, Users } from "lucide-react";
import type { Team, Membership, Domain } from "@/types";

interface DomainAssignment {
  id: string;
  domain_id: string;
  team_id: string;
  access_level: string;
  domain_name?: string;
  created_at?: string;
}

export default function TeamsPage() {
  const { currentOrg } = useOrgStore();
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  const { data: teamsData, isLoading } = useQuery({
    queryKey: ["teams", currentOrg?.id],
    queryFn: () => api.get<{ data: Team[] }>(`/orgs/${currentOrg!.id}/teams`, { per_page: "200" }),
    enabled: !!currentOrg,
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  // Team detail view
  if (selectedTeam) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedTeam(null)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Teams
          </Button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
            {selectedTeam.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold">{selectedTeam.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">{selectedTeam.slug}</p>
          </div>
          <div className="flex items-center gap-2 ml-auto text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {selectedTeam.member_count}</span>
            <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {selectedTeam.domain_count}</span>
            <span className="flex items-center gap-1"><Inbox className="h-3 w-3" /> {selectedTeam.active_inboxes}</span>
          </div>
        </div>
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Members</TabsTrigger>
            <TabsTrigger value="domains" className="gap-1.5"><Globe className="h-3.5 w-3.5" /> Domains</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="members"><TeamMembersTab orgId={currentOrg.id} teamId={selectedTeam.id} /></TabsContent>
          <TabsContent value="domains"><DomainAssignmentsTab orgId={currentOrg.id} teamId={selectedTeam.id} /></TabsContent>
          <TabsContent value="settings"><TeamSettingsTab orgId={currentOrg.id} team={selectedTeam} onDeleted={() => setSelectedTeam(null)} /></TabsContent>
        </Tabs>
      </div>
    );
  }

  // Team list view
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Teams</h1>
          {teamsData?.data && teamsData.data.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {teamsData.data.length} team{teamsData.data.length !== 1 ? "s" : ""} · {teamsData.data.reduce((s, t) => s + (t.member_count ?? 0), 0)} members
            </p>
          )}
        </div>
        <CreateTeamDialog orgId={currentOrg.id} />
      </div>

      {isLoading ? <TeamGridSkeleton /> : (
        (!teamsData?.data || teamsData.data.length === 0) ? (
          <EmptyState icon="👥" title="No teams yet" description="Create a team to organize your domains and inboxes." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teamsData.data.map((t) => (
              <TeamCard key={t.id} team={t} onSelect={() => setSelectedTeam(t)} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function TeamCard({ team, onSelect }: { team: Team; onSelect: () => void }) {
  const totalActivity = (team.member_count ?? 0) + (team.domain_count ?? 0) + (team.active_inboxes ?? 0);
  return (
    <Card className="cursor-pointer transition-all hover:shadow-md hover:border-primary/20 group" onClick={onSelect}>
      <CardContent className="pt-4 pb-3 space-y-3">
        {/* Team name + avatar */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary group-hover:bg-primary/20 transition-colors">
            {team.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{team.name}</p>
            <p className="text-[11px] text-muted-foreground font-mono">{team.slug}</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-center">
            <p className="text-sm font-semibold tabular-nums">{team.member_count ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Members</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-center">
            <p className="text-sm font-semibold tabular-nums">{team.domain_count ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Domains</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-center">
            <p className="text-sm font-semibold tabular-nums">{team.active_inboxes ?? 0}</p>
            <p className="text-[10px] text-muted-foreground">Inboxes</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 border-t text-xs text-muted-foreground">
          <span>Created {new Date(team.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          <span className="text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3 mt-1" /></CardHeader>
          <CardContent><Skeleton className="h-4 w-full" /></CardContent>
        </Card>
      ))}
    </div>
  );
}

function CreateTeamDialog({ orgId }: { orgId: string }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const fetchTeams = useOrgStore((s) => s.fetchTeams);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.post(`/orgs/${orgId}/teams`, { name: name.trim() });
      qc.invalidateQueries({ queryKey: ["teams"] });
      fetchTeams(orgId);
      toast.success("Team created");
      setOpen(false);
      setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setName(""); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Create Team</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a team</DialogTitle>
          <DialogDescription>Teams organize members and domain assignments. A URL slug will be generated from the name.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Team name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering" onKeyDown={(e) => e.key === "Enter" && create()} />
          </div>
          <Button onClick={create} className="w-full" disabled={!name.trim() || creating}>
            {creating ? "Creating…" : "Create Team"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeamMembersTab({ orgId, teamId }: { orgId: string; teamId: string }) {
  const qc = useQueryClient();
  const { teamRoles } = useRoles();
  const [addOpen, setAddOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [role, setRole] = useState("member");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => api.get<{ data: Membership[] }>(`/orgs/${orgId}/teams/${teamId}/members`, { per_page: "200" }),
  });

  const addMember = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/teams/${teamId}/members`, { email: memberEmail, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-members", teamId] });
      toast.success("Member added");
      setAddOpen(false);
      setMemberEmail("");
      setRole("member");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const changeRole = useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: string }) =>
      api.patch(`/orgs/${orgId}/teams/${teamId}/members/${uid}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members", teamId] }); qc.invalidateQueries({ queryKey: ["teams"] }); toast.success("Role updated"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const removeMember = useMutation({
    mutationFn: (uid: string) => api.del(`/orgs/${orgId}/teams/${teamId}/members/${uid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members", teamId] }); qc.invalidateQueries({ queryKey: ["teams"] }); toast.success("Member removed"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const members = data?.data ?? [];
  const filtered = search
    ? members.filter((m) => (m.display_name || "").toLowerCase().includes(search.toLowerCase()) || (m.email || "").toLowerCase().includes(search.toLowerCase()))
    : members;
  const leadCount = members.filter((m) => m.role === "lead").length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Total</span><div className="h-8 w-8 rounded-lg flex items-center justify-center bg-blue-100 dark:bg-blue-900/30"><Users className="h-4 w-4 text-blue-600 dark:text-blue-400" /></div></div><p className="text-2xl font-bold tabular-nums">{members.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Leads</span><div className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /></div></div><p className="text-2xl font-bold tabular-nums">{leadCount}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Members</span><div className="h-8 w-8 rounded-lg flex items-center justify-center bg-amber-100 dark:bg-amber-900/30"><Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" /></div></div><p className="text-2xl font-bold tabular-nums">{members.length - leadCount}</p></CardContent></Card>
      </div>

      {/* Search + Add */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {members.length > 3 && <Input placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />}
        <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) { setMemberEmail(""); setRole("member"); } }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Add Member</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add team member</DialogTitle>
              <DialogDescription>Add an existing org member to this team.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Email address</Label>
                <Input value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="user@example.com" type="email" onKeyDown={(e) => e.key === "Enter" && memberEmail && addMember.mutate()} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {teamRoles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label} — {r.description}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => addMember.mutate()} className="w-full" disabled={!memberEmail || addMember.isPending}>
                {addMember.isPending ? "Adding…" : "Add Member"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <>
              {filtered.length === 0 && !search && (
                <EmptyState icon="👥" title="No members yet" description="Invite team members to collaborate." />
              )}
              {filtered.length === 0 && search && (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-medium">Member</TableHead>
                      <TableHead className="font-medium">Role</TableHead>
                      <TableHead className="font-medium hidden sm:table-cell">Joined</TableHead>
                      <TableHead className="text-right font-medium">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-12">No matching members</TableCell></TableRow>
                  </TableBody>
                </Table>
              )}
              {filtered.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-medium">Member</TableHead>
                      <TableHead className="font-medium">Role</TableHead>
                      <TableHead className="font-medium hidden sm:table-cell">Joined</TableHead>
                      <TableHead className="text-right font-medium">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((m) => (
                <TableRow key={m.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {(m.display_name || m.email || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{m.display_name || "—"}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">{m.email || "—"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select value={m.role} onValueChange={(r) => changeRole.mutate({ uid: m.user_id, role: r })}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {teamRoles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                    {m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                      title="Remove member?"
                      description={`${m.display_name || m.email} will lose access to this team.`}
                      onConfirm={() => removeMember.mutate(m.user_id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
                  </TableBody>
                </Table>
              )}
          </>
        )}
      </div>
    </div>
  );
}

function DomainAssignmentsTab({ orgId, teamId }: { orgId: string; teamId: string }) {
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState("");

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["domain-assignments", teamId],
    queryFn: () => api.get<{ data: DomainAssignment[] }>(`/orgs/${orgId}/teams/${teamId}/domains`, { per_page: "200" }),
  });

  const { data: domains } = useQuery({
    queryKey: ["domains", orgId],
    queryFn: () => api.get<{ data: Domain[] }>(`/orgs/${orgId}/domains`, { per_page: "200" }),
  });

  const assign = useMutation({
    mutationFn: (domainId: string) =>
      api.post(`/orgs/${orgId}/teams/${teamId}/domains`, { domain_id: domainId, access_level: "full" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["domain-assignments", teamId] });
      toast.success("Domain assigned");
      setAssignOpen(false);
      setSelectedDomain("");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const unassign = useMutation({
    mutationFn: (domainId: string) => api.del(`/orgs/${orgId}/teams/${teamId}/domains/${domainId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domain-assignments", teamId] }); qc.invalidateQueries({ queryKey: ["teams"] }); toast.success("Domain unassigned"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const assignedIds = new Set(assignments?.data?.map((a) => a.domain_id));
  const available = domains?.data?.filter((d) => !assignedIds.has(d.id)) ?? [];
  const assignmentList = assignments?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Assigned</span><div className="h-8 w-8 rounded-lg flex items-center justify-center bg-violet-100 dark:bg-violet-900/30"><Globe className="h-4 w-4 text-violet-600 dark:text-violet-400" /></div></div><p className="text-2xl font-bold tabular-nums">{assignmentList.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Available</span><div className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /></div></div><p className="text-2xl font-bold tabular-nums">{available.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Org Domains</span><div className="h-8 w-8 rounded-lg flex items-center justify-center bg-amber-100 dark:bg-amber-900/30"><Users className="h-4 w-4 text-amber-600 dark:text-amber-400" /></div></div><p className="text-2xl font-bold tabular-nums">{domains?.data?.length ?? 0}</p></CardContent></Card>
      </div>

      {/* Assign button */}
      <div className="flex justify-end">
        {available.length > 0 && (
          <Dialog open={assignOpen} onOpenChange={(v) => { setAssignOpen(v); if (!v) setSelectedDomain(""); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Assign Domain</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign domain to team</DialogTitle>
                <DialogDescription>Select a domain to make available for this team&apos;s inboxes.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Domain</Label>
                  <Select value={selectedDomain} onValueChange={setSelectedDomain}>
                    <SelectTrigger><SelectValue placeholder="Select a domain…" /></SelectTrigger>
                    <SelectContent>
                      {available.map((d) => <SelectItem key={d.id} value={d.id}>{d.domain_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => selectedDomain && assign.mutate(selectedDomain)} className="w-full" disabled={!selectedDomain || assign.isPending}>
                  {assign.isPending ? "Assigning…" : "Assign Domain"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          assignmentList.length === 0 ? (
            <EmptyState icon="🌐" title="No domains assigned" description="Assign domains to this team to start receiving emails." />
          ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-medium">Domain</TableHead>
                <TableHead className="font-medium">Access Level</TableHead>
                <TableHead className="font-medium hidden sm:table-cell">Assigned</TableHead>
                <TableHead className="text-right font-medium">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignmentList.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-xs font-bold text-emerald-600">
                        <Globe className="h-4 w-4" />
                      </div>
                      <p className="font-medium font-mono text-sm">{a.domain_name || a.domain_id}</p>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="capitalize text-xs">{a.access_level}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                      title="Unassign domain?"
                      description={`${a.domain_name || "This domain"} will be removed from this team. Existing inboxes will stop receiving mail.`}
                      onConfirm={() => unassign.mutate(a.domain_id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )
        )}
      </div>
    </div>
  );
}

function TeamSettingsTab({ orgId, team, onDeleted }: { orgId: string; team: Team; onDeleted: () => void }) {
  const [name, setName] = useState(team.name);
  const [attachments, setAttachments] = useState(team.settings?.attachments_enabled ?? "inherit");
  const [maxTTL, setMaxTTL] = useState(team.settings?.max_inbox_ttl ?? "");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { fetchTeams } = useOrgStore();

  const dirty = name !== team.name || attachments !== (team.settings?.attachments_enabled ?? "inherit") || maxTTL !== (team.settings?.max_inbox_ttl ?? "");

  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      await api.patch(`/orgs/${orgId}/teams/${team.id}`, {
        name: name.trim(),
        settings: { attachments_enabled: attachments, max_inbox_ttl: maxTTL || null },
      });
      qc.invalidateQueries({ queryKey: ["teams"] });
      fetchTeams(orgId);
      toast.success("Team updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteTeam = async () => {
    try {
      await api.del(`/orgs/${orgId}/teams/${team.id}`);
      qc.invalidateQueries({ queryKey: ["teams"] });
      fetchTeams(orgId);
      onDeleted();
      toast.success("Team deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>Update team name and settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Team Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={team.slug} disabled className="bg-muted font-mono" />
          </div>
          <div className="space-y-2">
            <Label>Attachments</Label>
            <Select value={attachments} onValueChange={setAttachments}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit from org</SelectItem>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Max Inbox TTL</Label>
            <Input value={maxTTL} onChange={(e) => setMaxTTL(e.target.value)} placeholder="e.g. 24h, 72h (empty = inherit)" />
          </div>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
          <CardDescription>Permanently delete this team and all its data.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConfirmDialog
            trigger={<Button variant="destructive" className="gap-1.5"><Trash2 className="h-4 w-4" /> Delete Team</Button>}
            title={`Delete "${team.name}"?`}
            description="All team members, domain assignments, and inboxes will be permanently removed. This cannot be undone."
            onConfirm={deleteTeam}
          />
        </CardContent>
      </Card>
    </div>
  );
}
