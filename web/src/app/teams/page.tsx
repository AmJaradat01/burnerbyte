"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import type { Team, Membership, Domain } from "@/types";

interface DomainAssignment {
  id: string;
  domain_id: string;
  team_id: string;
  access_level: string;
  attachments_enabled?: boolean;
  domain_name?: string;
}

export default function TeamsPage() {
  const { currentOrg, currentTeam, setCurrentTeam, fetchTeams } = useOrgStore();
  const qc = useQueryClient();

  const { data: teamsData } = useQuery({
    queryKey: ["teams", currentOrg?.id],
    queryFn: () => api.get<{ data: Team[] }>(`/orgs/${currentOrg!.id}/teams`),
    enabled: !!currentOrg,
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teams</h1>
        <CreateTeamDialog orgId={currentOrg.id} />
      </div>

      {!currentTeam ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {teamsData?.data?.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setCurrentTeam(t)}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">{t.slug}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</TableCell>
                    <TableCell><Button variant="outline" size="sm">Manage</Button></TableCell>
                  </TableRow>
                ))}
                {(!teamsData?.data || teamsData.data.length === 0) && (
                  <TableRow><TableCell colSpan={4} className="p-0">
                    <EmptyState icon="👥" title="No teams yet" description="Create a team to organize your domains and inboxes." />
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Button variant="ghost" onClick={() => setCurrentTeam(null as unknown as Team)}>← Back to teams</Button>
          <h2 className="text-xl font-semibold">{currentTeam.name}</h2>
          <Tabs defaultValue="members">
            <TabsList>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="domains">Domain Assignments</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>
            <TabsContent value="members"><TeamMembersTab orgId={currentOrg.id} teamId={currentTeam.id} /></TabsContent>
            <TabsContent value="domains"><DomainAssignmentsTab orgId={currentOrg.id} teamId={currentTeam.id} /></TabsContent>
            <TabsContent value="settings"><TeamSettingsTab orgId={currentOrg.id} team={currentTeam} /></TabsContent>
            <TabsContent value="analytics"><TeamAnalyticsTab orgId={currentOrg.id} teamId={currentTeam.id} /></TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function CreateTeamDialog({ orgId }: { orgId: string }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const fetchTeams = useOrgStore((s) => s.fetchTeams);

  const create = async () => {
    try {
      await api.post(`/orgs/${orgId}/teams`, { name });
      qc.invalidateQueries({ queryKey: ["teams"] });
      fetchTeams(orgId);
      toast.success("Team created");
      setOpen(false);
      setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Create team</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create a team</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Team name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button onClick={create} className="w-full">Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeamMembersTab({ orgId, teamId }: { orgId: string; teamId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => api.get<{ data: Membership[] }>(`/orgs/${orgId}/teams/${teamId}/members`),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/orgs/${orgId}/teams/${teamId}/members/${userId}`, { role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members", teamId] }); toast.success("Role updated"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/orgs/${orgId}/teams/${teamId}/members/${userId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members", teamId] }); toast.success("Removed"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Team Members</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.display_name}</TableCell>
                <TableCell>
                  <Select value={m.role} onValueChange={(role) => changeRole.mutate({ userId: m.user_id, role })}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["lead", "member", "viewer"].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Button variant="ghost" size="sm" onClick={() => remove.mutate(m.user_id)}>Remove</Button></TableCell>
              </TableRow>
            ))}
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
    mutationFn: (id: string) => api.del(`/orgs/${orgId}/teams/${teamId}/domains/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domain-assignments", teamId] }); toast.success("Unassigned"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const assignedIds = new Set(assignments?.data?.map((a) => a.domain_id));
  const available = domains?.data?.filter((d) => !assignedIds.has(d.id)) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Domain Assignments</CardTitle>
        {available.length > 0 && (
          <Select onValueChange={(id) => assign.mutate(id)}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Assign domain…" /></SelectTrigger>
            <SelectContent>
              {available.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.domain_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Domain</TableHead>
              <TableHead>Access</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments?.data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.domain_name || a.domain_id}</TableCell>
                <TableCell><Badge>{a.access_level}</Badge></TableCell>
                <TableCell><Button variant="ghost" size="sm" onClick={() => unassign.mutate(a.id)}>Unassign</Button></TableCell>
              </TableRow>
            ))}
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
  const fetchTeams = useOrgStore((s) => s.fetchTeams);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/orgs/${orgId}/teams/${team.id}`, { name });
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
    if (!confirm("Delete this team? This cannot be undone.")) return;
    try {
      await api.del(`/orgs/${orgId}/teams/${team.id}`);
      qc.invalidateQueries({ queryKey: ["teams"] });
      fetchTeams(orgId);
      toast.success("Team deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Team Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Team Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex gap-3">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button variant="destructive" onClick={deleteTeam}>Delete Team</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamAnalyticsTab({ orgId, teamId }: { orgId: string; teamId: string }) {
  const { data: stats } = useQuery({
    queryKey: ["team-analytics", teamId],
    queryFn: () => api.get<{ total_inboxes: number; active_inboxes: number; total_emails: number }>(`/orgs/${orgId}/teams/${teamId}/analytics`),
  });

  const { data: chart } = useQuery({
    queryKey: ["team-emails-per-day", teamId],
    queryFn: () => api.get<{ data: { date: string; count: number }[] }>(`/orgs/${orgId}/teams/${teamId}/analytics/emails-per-day`),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total Inboxes", value: stats?.total_inboxes },
          { label: "Active Inboxes", value: stats?.active_inboxes },
          { label: "Total Emails", value: stats?.total_emails },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{s.label}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{s.value ?? 0}</p></CardContent>
          </Card>
        ))}
      </div>
      {chart?.data && chart.data.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Emails per Day</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {chart.data.map((d) => (
                <div key={d.date} className="flex items-center gap-3 text-sm">
                  <span className="w-24 text-muted-foreground">{d.date}</span>
                  <div className="h-4 bg-primary rounded" style={{ width: `${Math.max(d.count * 4, 4)}px` }} />
                  <span>{d.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
