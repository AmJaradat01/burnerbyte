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
import { ArrowLeft, Globe, Inbox, Plus, Settings, Trash2, UserPlus, Users } from "lucide-react";
import type { Team, Membership, Domain } from "@/types";

interface DomainAssignment {
  id: string;
  domain_id: string;
  team_id: string;
  access_level: string;
  domain_name?: string;
}

export default function TeamsPage() {
  const { currentOrg, currentTeam, setCurrentTeam } = useOrgStore();

  const { data: teamsData, isLoading } = useQuery({
    queryKey: ["teams", currentOrg?.id],
    queryFn: () => api.get<{ data: Team[] }>(`/orgs/${currentOrg!.id}/teams`),
    enabled: !!currentOrg,
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  // Team detail view
  if (currentTeam) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setCurrentTeam(null as unknown as Team)} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Teams
          </Button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
            {currentTeam.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold">{currentTeam.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">{currentTeam.slug}</p>
          </div>
          <div className="flex items-center gap-2 ml-auto text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {currentTeam.member_count}</span>
            <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> {currentTeam.domain_count}</span>
            <span className="flex items-center gap-1"><Inbox className="h-3 w-3" /> {currentTeam.active_inboxes}</span>
          </div>
        </div>
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Members</TabsTrigger>
            <TabsTrigger value="domains" className="gap-1.5"><Globe className="h-3.5 w-3.5" /> Domains</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5"><Settings className="h-3.5 w-3.5" /> Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="members"><TeamMembersTab orgId={currentOrg.id} teamId={currentTeam.id} /></TabsContent>
          <TabsContent value="domains"><DomainAssignmentsTab orgId={currentOrg.id} teamId={currentTeam.id} /></TabsContent>
          <TabsContent value="settings"><TeamSettingsTab orgId={currentOrg.id} team={currentTeam} /></TabsContent>
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
              <TeamCard key={t.id} team={t} onSelect={() => setCurrentTeam(t)} />
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
    <Dialog open={open} onOpenChange={setOpen}>
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
  const [addOpen, setAddOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [role, setRole] = useState("member");

  const { data } = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => api.get<{ data: Membership[] }>(`/orgs/${orgId}/teams/${teamId}/members`),
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members", teamId] }); toast.success("Role updated"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const removeMember = useMutation({
    mutationFn: (uid: string) => api.del(`/orgs/${orgId}/teams/${teamId}/members/${uid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members", teamId] }); toast.success("Member removed"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Members</CardTitle>
          {data?.data && <p className="text-xs text-muted-foreground mt-0.5">{data.data.length} member{data.data.length !== 1 ? "s" : ""}</p>}
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Add Member</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add team member</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Email address</Label>
                <Input value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="user@example.com" type="email" />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["lead", "member", "viewer"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => addMember.mutate()} className="w-full" disabled={!memberEmail || addMember.isPending}>
                {addMember.isPending ? "Adding…" : "Add Member"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
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
            {data?.data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {(m.display_name || m.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium">{m.display_name || "—"}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{m.email || "—"}</TableCell>
                <TableCell>
                  <Select value={m.role} onValueChange={(r) => changeRole.mutate({ uid: m.user_id, role: r })}>
                    <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["lead", "member", "viewer"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                    title="Remove member?"
                    description={`${m.display_name || m.email} will lose access to this team.`}
                    onConfirm={() => removeMember.mutate(m.user_id)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {(!data?.data || data.data.length === 0) && (
              <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No members yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DomainAssignmentsTab({ orgId, teamId }: { orgId: string; teamId: string }) {
  const qc = useQueryClient();
  const { data: assignments } = useQuery({
    queryKey: ["domain-assignments", teamId],
    queryFn: () => api.get<{ data: DomainAssignment[] }>(`/orgs/${orgId}/teams/${teamId}/domains`),
  });

  const { data: domains } = useQuery({
    queryKey: ["domains", orgId],
    queryFn: () => api.get<{ data: Domain[] }>(`/orgs/${orgId}/domains`),
  });

  const assign = useMutation({
    mutationFn: (domainId: string) =>
      api.post(`/orgs/${orgId}/teams/${teamId}/domains`, { domain_id: domainId, access_level: "full" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domain-assignments", teamId] }); toast.success("Domain assigned"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const unassign = useMutation({
    mutationFn: (domainId: string) => api.del(`/orgs/${orgId}/teams/${teamId}/domains/${domainId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domain-assignments", teamId] }); toast.success("Domain unassigned"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const assignedIds = new Set(assignments?.data?.map((a) => a.domain_id));
  const available = domains?.data?.filter((d) => !assignedIds.has(d.id)) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Domain Assignments</CardTitle>
          {assignments?.data && <p className="text-xs text-muted-foreground mt-0.5">{assignments.data.length} domain{assignments.data.length !== 1 ? "s" : ""} assigned</p>}
        </div>
        {available.length > 0 && (
          <Select onValueChange={(id) => assign.mutate(id)}>
            <SelectTrigger className="w-48 h-8"><SelectValue placeholder="Assign domain…" /></SelectTrigger>
            <SelectContent>
              {available.map((d) => <SelectItem key={d.id} value={d.id}>{d.domain_name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Access Level</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments?.data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium font-mono text-sm">{a.domain_name || a.domain_id}</TableCell>
                <TableCell><Badge variant="outline">{a.access_level}</Badge></TableCell>
                <TableCell className="text-right">
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                    title="Unassign domain?"
                    description={`${a.domain_name || "This domain"} will be removed from this team.`}
                    onConfirm={() => unassign.mutate(a.domain_id)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {(!assignments?.data || assignments.data.length === 0) && (
              <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-8">No domains assigned</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TeamSettingsTab({ orgId, team }: { orgId: string; team: Team }) {
  const [name, setName] = useState(team.name);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();
  const { fetchTeams, setCurrentTeam } = useOrgStore();

  const dirty = name !== team.name;

  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      await api.patch(`/orgs/${orgId}/teams/${team.id}`, { name: name.trim() });
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
      setCurrentTeam(null as unknown as Team);
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
