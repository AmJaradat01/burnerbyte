"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
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
import { ErrorState } from "@/components/error-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRoles } from "@/hooks/use-roles";
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Globe, Inbox, Loader2, Plus, Search, Settings, Trash2, UserPlus, Users, XCircle } from "lucide-react";
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
  const { currentOrg, currentRole } = useOrgStore();
  const { user } = useAuthStore();
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  const { data: teamsData, isLoading, isError, refetch } = useQuery({
    queryKey: ["teams", currentOrg?.id],
    queryFn: () => api.get<{ data: Team[] }>(`/orgs/${currentOrg!.id}/teams`, { per_page: "200" }),
    enabled: !!currentOrg,
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const isOrgMember = !!currentRole;
  const isAdmin = currentRole === "owner" || currentRole === "admin" || user?.is_system_admin;
  if (!isOrgMember) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access this page.</p></div>;

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
            <h1 className="text-3xl font-bold tracking-tight">{selectedTeam.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">{selectedTeam.slug}</p>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="secondary" className="gap-1 text-xs"><Users className="h-3 w-3" /> {selectedTeam.member_count}</Badge>
            <Badge variant="secondary" className="gap-1 text-xs"><Globe className="h-3 w-3" /> {selectedTeam.domain_count}</Badge>
            <Badge variant="secondary" className="gap-1 text-xs"><Inbox className="h-3 w-3" /> {selectedTeam.active_inboxes}</Badge>
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
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          {teamsData?.data && teamsData.data.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {teamsData.data.length} team{teamsData.data.length !== 1 ? "s" : ""} · {teamsData.data.reduce((s, t) => s + (t.member_count ?? 0), 0)} members
            </p>
          )}
        </div>
        {isAdmin && <CreateTeamDialog orgId={currentOrg.id} existingTeams={(teamsData?.data ?? []).map((t) => t.name)} />}
      </div>

      {teamsData?.data && teamsData.data.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <MiniStat icon={Users} label="Total Teams" value={teamsData.data.length} accent="text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400" />
          <MiniStat icon={Users} label="Total Members" value={teamsData.data.reduce((s, t) => s + (t.member_count ?? 0), 0)} accent="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400" />
          <MiniStat icon={Inbox} label="Total Inboxes" value={teamsData.data.reduce((s, t) => s + (t.active_inboxes ?? 0), 0)} accent="text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400" />
        </div>
      )}

      {isLoading ? <TeamGridSkeleton /> : isError ? (
        <ErrorState message="Failed to load teams" onRetry={() => refetch()} />
      ) : (
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
          <span>Created {new Date(team.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
          <span className="text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">View team →</span>
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

function MiniStat({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: number; accent: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shadow-sm shrink-0 ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function CreateTeamDialog({ orgId, existingTeams }: { orgId: string; existingTeams: string[] }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [initialMembers, setInitialMembers] = useState<{ email: string; display_name: string; role: string }[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [suggestions, setSuggestions] = useState<{ user_id: string; email: string; display_name: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const memberInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qc = useQueryClient();
  const fetchTeams = useOrgStore((s) => s.fetchTeams);
  const { teamRoles } = useRoles();

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
  const nameValid = name.trim().length >= 2;
  const isDuplicate = existingTeams.some((t) => t.toLowerCase() === name.trim().toLowerCase());

  // Debounced member search
  const searchMembers = useCallback(async (query: string) => {
    if (!query || query.length < 1) { setSuggestions([]); setShowSuggestions(false); return; }
    setSuggestionsLoading(true);
    try {
      const results = await api.get<{ user_id: string; email: string; display_name: string }[]>(
        `/orgs/${orgId}/members/search`, { q: query }
      );
      const addedEmails = new Set(initialMembers.map((m) => m.email));
      setSuggestions((results ?? []).filter((r) => !addedEmails.has(r.email)));
      setShowSuggestions(true);
    } catch { setSuggestions([]); }
    finally { setSuggestionsLoading(false); }
  }, [orgId, initialMembers]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchMembers(memberSearch), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [memberSearch, searchMembers]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          memberInputRef.current && !memberInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const addMember = (s: { email: string; display_name: string }) => {
    setInitialMembers((prev) => [...prev, { email: s.email, display_name: s.display_name, role: "member" }]);
    setMemberSearch("");
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const removeMember = (email: string) => {
    setInitialMembers((prev) => prev.filter((m) => m.email !== email));
  };

  const changeMemberRole = (email: string, role: string) => {
    setInitialMembers((prev) => prev.map((m) => m.email === email ? { ...m, role } : m));
  };

  const create = async () => {
    if (!nameValid) return;
    setCreating(true);
    try {
      const payload: Record<string, unknown> = { name: name.trim() };
      if (description.trim()) payload.description = description.trim();
      if (initialMembers.length > 0) {
        payload.members = initialMembers.map((m) => ({ email: m.email, role: m.role }));
      }
      await api.post(`/orgs/${orgId}/teams`, payload);
      qc.invalidateQueries({ queryKey: ["teams"] });
      fetchTeams(orgId);
      toast.success("Team created");
      setOpen(false);
      setName("");
      setDescription("");
      setInitialMembers([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(""); setDescription(""); setInitialMembers([]); setMemberSearch(""); } }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Create Team</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Create a team</DialogTitle>
              <DialogDescription>Teams let you group members and assign domains so the right people have access to the right inboxes.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Team name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering, Marketing, Support" onKeyDown={(e) => e.key === "Enter" && !isDuplicate && nameValid && create()} />
            {name.trim() && !nameValid && (
              <p className="text-xs text-destructive">Name must be at least 2 characters</p>
            )}
            {isDuplicate && (
              <p className="text-xs text-destructive">A team with this name already exists</p>
            )}
            {slug && nameValid && !isDuplicate && (
              <p className="text-xs text-muted-foreground">Slug: <span className="font-mono">{slug}</span></p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this team do?" />
          </div>

          {/* Initial Members */}
          <div className="border-t pt-4 space-y-3">
            <div className="space-y-1">
              <Label>Initial Members <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <p className="text-xs text-muted-foreground">You&apos;ll be added as team lead automatically. Add other members here.</p>
            </div>

            {/* Added members list */}
            {initialMembers.length > 0 && (
              <div className="space-y-1.5">
                {initialMembers.map((m) => (
                  <div key={m.email} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {(m.display_name || m.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{m.display_name || m.email}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                    </div>
                    <Select value={m.role} onValueChange={(r) => changeMemberRole(m.email, r)}>
                      <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {teamRoles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeMember(m.email)}>
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Member search */}
            <div className="relative">
              <Input
                ref={memberInputRef}
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                placeholder="Search org members to add..."
                autoComplete="off"
              />
              {showSuggestions && (
                <div ref={suggestionsRef} className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-40 overflow-auto">
                  {suggestionsLoading ? (
                    <div className="flex items-center justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : suggestions.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-muted-foreground text-center">No matching members</div>
                  ) : (
                    suggestions.map((s) => (
                      <button key={s.user_id} type="button" className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-accent transition-colors cursor-pointer"
                        onMouseDown={(e) => { e.preventDefault(); addMember(s); }}>
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {(s.display_name || s.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{s.display_name || "—"}</p>
                          <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <Button onClick={create} className="w-full" disabled={!nameValid || isDuplicate || creating}>
            {creating ? "Creating…" : `Create Team${initialMembers.length > 0 ? ` with ${initialMembers.length} member${initialMembers.length !== 1 ? "s" : ""}` : ""}`}
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
  const [suggestions, setSuggestions] = useState<{ user_id: string; email: string; display_name: string; avatar_url?: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search for member suggestions
  const searchMembers = useCallback(async (query: string) => {
    if (!query || query.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const results = await api.get<{ user_id: string; email: string; display_name: string; avatar_url?: string }[]>(
        `/orgs/${orgId}/members/search`,
        { q: query, exclude_team: teamId }
      );
      setSuggestions(results ?? []);
      setShowSuggestions(true);
    } catch {
      setSuggestions([]);
      toast.error("Failed to search members");
    } finally {
      setSuggestionsLoading(false);
    }
  }, [orgId, teamId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchMembers(memberEmail);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [memberEmail, searchMembers]);

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectSuggestion = (s: { email: string; display_name: string }) => {
    setMemberEmail(s.email);
    setShowSuggestions(false);
    setSuggestions([]);
  };

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
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Total</span><div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-blue-100 dark:bg-blue-900/30"><Users className="h-4 w-4 text-blue-600 dark:text-blue-400" /></div></div><p className="text-2xl font-bold tabular-nums">{members.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Leads</span><div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /></div></div><p className="text-2xl font-bold tabular-nums">{leadCount}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm text-muted-foreground">Members</span><div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-amber-100 dark:bg-amber-900/30"><Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" /></div></div><p className="text-2xl font-bold tabular-nums">{members.length - leadCount}</p></CardContent></Card>
      </div>

      {/* Search + Add */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {members.length > 3 && <Input placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />}
        <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) { setMemberEmail(""); setRole("member"); setSuggestions([]); setShowSuggestions(false); } }}>
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
                <div className="relative">
                  <Input
                    ref={inputRef}
                    value={memberEmail}
                    onChange={(e) => setMemberEmail(e.target.value)}
                    onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                    placeholder="Type to search org members..."
                    type="text"
                    autoComplete="off"
                    onKeyDown={(e) => e.key === "Enter" && memberEmail && addMember.mutate()}
                  />
                  {showSuggestions && (
                    <div
                      ref={suggestionsRef}
                      className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-56 overflow-auto"
                    >
                      {suggestionsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : suggestions.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                          No matching members
                        </div>
                      ) : (
                        suggestions.map((s) => (
                          <button
                            key={s.user_id}
                            type="button"
                            className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-accent transition-colors cursor-pointer"
                            onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                              {(s.display_name || s.email || "?").charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{s.display_name || "—"}</p>
                              <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
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
  const [search, setSearch] = useState("");

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
      qc.invalidateQueries({ queryKey: ["teams"] });
      toast.success("Domain assigned");
      setAssignOpen(false);
      setSelectedDomain("");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const unassign = useMutation({
    mutationFn: (domainId: string) => api.del(`/orgs/${orgId}/teams/${teamId}/domains/${domainId}?force=true`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["domain-assignments", teamId] }); qc.invalidateQueries({ queryKey: ["teams"] }); toast.success("Domain unassigned"); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const assignedIds = new Set(assignments?.data?.map((a) => a.domain_id));
  const available = domains?.data?.filter((d) => !assignedIds.has(d.id) && d.mx_verified && d.txt_verified) ?? [];
  const assignmentList = assignments?.data ?? [];
  const filtered = search ? assignmentList.filter((a) => (a.domain_name || "").toLowerCase().includes(search.toLowerCase())) : assignmentList;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm font-medium text-muted-foreground">Assigned</span><div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-violet-100 dark:bg-violet-900/30"><Globe className="h-4 w-4 text-violet-600 dark:text-violet-400" /></div></div><p className="text-2xl font-bold tabular-nums">{assignmentList.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm font-medium text-muted-foreground">Available</span><div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-emerald-100 dark:bg-emerald-900/30"><CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /></div></div><p className="text-2xl font-bold tabular-nums">{available.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center justify-between mb-3"><span className="text-sm font-medium text-muted-foreground">Total Domains</span><div className="h-8 w-8 rounded-lg flex items-center justify-center shadow-sm bg-blue-100 dark:bg-blue-900/30"><Globe className="h-4 w-4 text-blue-600 dark:text-blue-400" /></div></div><p className="text-2xl font-bold tabular-nums">{domains?.data?.length ?? 0}</p></CardContent></Card>
      </div>

      {/* Search + Assign */}
      <div className="flex items-center justify-between gap-3">
        {assignmentList.length > 0 && (
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Filter domains…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
        )}
        <div className="ml-auto">
          {available.length > 0 && (
            <Dialog open={assignOpen} onOpenChange={(v) => { setAssignOpen(v); if (!v) setSelectedDomain(""); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Assign Domain</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-violet-100 dark:bg-violet-900/30"><Globe className="h-4 w-4 text-violet-600 dark:text-violet-400" /></div>
                    Assign domain to team
                  </DialogTitle>
                  <DialogDescription>Only verified domains are shown. Select one to make it available for this team&apos;s inboxes.</DialogDescription>
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
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          filtered.length === 0 ? (
            assignmentList.length === 0 ? (
              <EmptyState icon="🌐" title="No domains assigned" description="Assign verified domains to this team to start creating inboxes." />
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No domains match &quot;{search}&quot;</div>
            )
          ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-medium">Domain</TableHead>
                <TableHead className="font-medium hidden sm:table-cell">Assigned</TableHead>
                <TableHead className="text-right font-medium">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/30">
                  <TableCell>
                    <Link href={`/domains/${a.domain_id}`} className="flex items-center gap-3 group">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                        <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <span className="font-medium font-mono text-sm group-hover:text-primary transition-colors">{a.domain_name || a.domain_id}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <UnassignDomainDialog
                      orgId={orgId}
                      teamId={teamId}
                      assignment={a}
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

function TeamSettingsDeleteSection({ orgId, team, onDeleted }: { orgId: string; team: Team; onDeleted: () => void }) {
  const qc = useQueryClient();
  const { fetchTeams } = useOrgStore();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: impact, isLoading: impactLoading } = useQuery({
    queryKey: ["team-impact", team.id],
    queryFn: () => api.get<{ member_count: number; domain_assignment_count: number; active_inbox_count: number; email_count: number }>(`/orgs/${orgId}/teams/${team.id}/impact`),
    enabled: deleteOpen,
  });

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
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
        <CardDescription>Permanently delete this team and all its data.</CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" className="gap-1.5"><Trash2 className="h-4 w-4" /> Delete Team</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Delete &quot;{team.name}&quot;?
              </DialogTitle>
              <DialogDescription>
                {impactLoading ? (
                  "Loading impact..."
                ) : impact ? (
                  `This will remove ${impact.member_count} member${impact.member_count !== 1 ? "s" : ""}, ${impact.domain_assignment_count} domain assignment${impact.domain_assignment_count !== 1 ? "s" : ""}, ${impact.active_inbox_count} active inbox${impact.active_inbox_count !== 1 ? "es" : ""}, and ${impact.email_count} email${impact.email_count !== 1 ? "s" : ""}. This cannot be undone.`
                ) : (
                  "All team members, domain assignments, and inboxes will be permanently removed. This cannot be undone."
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { deleteTeam(); setDeleteOpen(false); }} className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Delete Team
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
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
  const ttlValid = !maxTTL || /^\d+[smh]$/.test(maxTTL);

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
            {maxTTL && !ttlValid && <p className="text-xs text-destructive">Use format like 1h, 24h, 30m</p>}
          </div>
          <Button onClick={save} disabled={saving || !dirty || (!!maxTTL && !ttlValid)}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      <TeamSettingsDeleteSection orgId={orgId} team={team} onDeleted={onDeleted} />
    </div>
  );
}

function UnassignDomainDialog({ orgId, teamId, assignment, onConfirm }: {
  orgId: string; teamId: string; assignment: DomainAssignment; onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const domainName = assignment.domain_name || assignment.domain_id;

  const { data: impact, isLoading: loading } = useQuery({
    queryKey: ["domain-impact", assignment.domain_id],
    queryFn: () => api.get<{ active_inboxes: number; total_emails: number; inboxes: { address: string; full_address: string; created_by_email: string; email_count: number; expires_at: string }[] }>(`/orgs/${orgId}/domains/${assignment.domain_id}/impact`),
    enabled: open,
  });

  const activeInboxes = impact?.active_inboxes ?? -1;
  const inboxList = impact?.inboxes ?? [];

  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
    setConfirmText("");
  };

  return (
    <>
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirmText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Unassign {domainName}
            </DialogTitle>
            <DialogDescription>
              This will remove the domain from this team.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : activeInboxes > 0 ? (
              <>
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span><strong>{activeInboxes}</strong> active inbox{activeInboxes !== 1 ? "es" : ""} will be permanently deleted.</span>
                </div>
                {inboxList.length > 0 && (
                  <div className="rounded-lg border text-xs divide-y max-h-40 overflow-auto">
                    <div className="grid grid-cols-3 gap-2 px-3 py-1.5 bg-muted/50 font-medium text-muted-foreground">
                      <span>Address</span><span>Created By</span><span>Emails</span>
                    </div>
                    {inboxList.map((inbox) => (
                      <div key={inbox.full_address} className="grid grid-cols-3 gap-2 px-3 py-1.5">
                        <span className="font-mono truncate">{inbox.address || inbox.full_address}</span>
                        <span className="truncate">{inbox.created_by_email}</span>
                        <span>{inbox.email_count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : activeInboxes === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20 p-3 text-sm text-emerald-800 dark:text-emerald-300">
                No active inboxes on this assignment. Safe to unassign.
              </div>
            ) : null}
            {!loading && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm">Type <span className="font-mono font-semibold">{domainName}</span> to confirm</Label>
                  <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={domainName} />
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button variant="destructive" disabled={confirmText !== domainName} onClick={handleConfirm} className="gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Unassign Domain
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}