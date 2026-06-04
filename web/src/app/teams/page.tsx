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
import { ArrowLeft, ArrowRight, AlertTriangle, Globe, Inbox, Loader2, Plus, Search, Settings, Trash2, UserPlus, Users, XCircle } from "lucide-react";
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
  const { currentOrg, currentRole, hasPermission } = useOrgStore();
  const { user } = useAuthStore();
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [search, setSearch] = useState("");

  const { data: teamsData, isLoading, isError, refetch } = useQuery({
    queryKey: ["teams", currentOrg?.id],
    queryFn: () => api.get<{ data: Team[] }>(`/orgs/${currentOrg!.id}/teams`, { per_page: "200" }),
    enabled: !!currentOrg,
  });

  if (!currentOrg) return <p className="text-muted-foreground">Select an organization first.</p>;

  const isOrgMember = !!currentRole;
  const isAdmin = hasPermission("org.teams.create") || user?.is_system_admin;
  if (!isOrgMember) return <div className="flex items-center justify-center min-h-[50vh]"><p className="text-muted-foreground">You don&apos;t have permission to access this page.</p></div>;

  // Team detail view
  if (selectedTeam) {
    return (
      <div className="space-y-6">
        <header className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedTeam(null)} className="gap-1.5" aria-label="Back to teams">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Teams
          </Button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground" aria-hidden="true">
            {selectedTeam.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="text-headline truncate">{selectedTeam.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">{selectedTeam.slug}</p>
          </div>
          <div className="flex items-center gap-2 ml-auto text-xs text-muted-foreground tabular-nums">
            <span className="flex items-center gap-1"><Users className="h-3 w-3" aria-hidden="true" /> {selectedTeam.member_count}</span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1"><Globe className="h-3 w-3" aria-hidden="true" /> {selectedTeam.domain_count}</span>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1"><Inbox className="h-3 w-3" aria-hidden="true" /> {selectedTeam.active_inboxes}</span>
          </div>
        </header>
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members" className="gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden="true" /> Members</TabsTrigger>
            <TabsTrigger value="domains" className="gap-1.5"><Globe className="h-3.5 w-3.5" aria-hidden="true" /> Domains</TabsTrigger>
            {isAdmin && <TabsTrigger value="settings" className="gap-1.5"><Settings className="h-3.5 w-3.5" aria-hidden="true" /> Settings</TabsTrigger>}
          </TabsList>
          <TabsContent value="members"><TeamMembersTab orgId={currentOrg.id} teamId={selectedTeam.id} isAdmin={!!isAdmin} /></TabsContent>
          <TabsContent value="domains"><DomainAssignmentsTab orgId={currentOrg.id} teamId={selectedTeam.id} isAdmin={!!isAdmin} /></TabsContent>
          {isAdmin && <TabsContent value="settings"><TeamSettingsTab orgId={currentOrg.id} team={selectedTeam} onDeleted={() => setSelectedTeam(null)} /></TabsContent>}
        </Tabs>
      </div>
    );
  }

  // Team list view
  const teamList = teamsData?.data ?? [];
  const totalMembers = teamList.reduce((s, t) => s + (t.member_count ?? 0), 0);
  const totalInboxes = teamList.reduce((s, t) => s + (t.active_inboxes ?? 0), 0);
  const filteredTeams = search
    ? teamList.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()) || t.slug.toLowerCase().includes(search.toLowerCase()))
    : teamList;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0" aria-hidden="true">
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-headline">Teams</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {teamList.length > 0
                ? `${teamList.length} ${teamList.length === 1 ? "team" : "teams"} · ${totalMembers} ${totalMembers === 1 ? "member" : "members"} · ${totalInboxes} active ${totalInboxes === 1 ? "inbox" : "inboxes"}`
                : "Organize your domains and inboxes by team."}
            </p>
          </div>
        </div>
        {isAdmin && <CreateTeamDialog orgId={currentOrg.id} existingTeams={teamList.map((t) => t.name)} />}
      </header>

      {isLoading ? <TeamGridSkeleton /> : isError ? (
        <ErrorState message="Failed to load teams" onRetry={() => refetch()} />
      ) : teamList.length === 0 ? (
        <EmptyState title="No teams yet" description="Create a team to organize your domains and inboxes.">
          {isAdmin && (
            <div className="mt-5">
              <CreateTeamDialog orgId={currentOrg.id} existingTeams={[]} />
            </div>
          )}
        </EmptyState>
      ) : (
        <>
          {teamList.length > 6 && (
            <div className="relative max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Filter teams…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Filter teams by name"
              />
            </div>
          )}
          {filteredTeams.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No teams match &quot;{search}&quot;.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTeams.map((t) => (
                <TeamCard key={t.id} team={t} onSelect={() => setSelectedTeam(t)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TeamCard({ team, onSelect }: { team: Team; onSelect: () => void }) {
  const members = team.member_count ?? 0;
  const domains = team.domain_count ?? 0;
  const inboxes = team.active_inboxes ?? 0;
  return (
    <Card
      className="cursor-pointer group hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      aria-label={`Open team ${team.name}`}
    >
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground" aria-hidden="true">
            {team.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{team.name}</p>
            <p className="text-[11px] text-muted-foreground font-mono truncate">{team.slug}</p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-2">
          <span className="tabular-nums">
            {members} {members === 1 ? "member" : "members"} · {domains} {domains === 1 ? "domain" : "domains"} · {inboxes} active
          </span>
          <span>{new Date(team.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
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
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <div className="border-t pt-2"><Skeleton className="h-3 w-full" /></div>
          </CardContent>
        </Card>
      ))}
    </div>
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

  // Domain selection state
  const [selectedDomains, setSelectedDomains] = useState<{ id: string; name: string; accessLevel: string }[]>([]);
  const [domainSearch, setDomainSearch] = useState("");

  // Fetch verified domains
  const { data: domainsData } = useQuery({
    queryKey: ["domains", orgId],
    queryFn: () => api.get<{ data: Domain[] }>(`/orgs/${orgId}/domains`, { per_page: "200" }),
    enabled: open,
  });
  const verifiedDomains = (domainsData?.data ?? []).filter((d) => d.mx_verified && d.txt_verified);
  const availableDomains = verifiedDomains.filter((d) => !selectedDomains.some((s) => s.id === d.id));
  const filteredAvailableDomains = domainSearch
    ? availableDomains.filter((d) => d.domain_name.toLowerCase().includes(domainSearch.toLowerCase()))
    : availableDomains;

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
      if (selectedDomains.length > 0) {
        payload.domains = selectedDomains.map((d) => ({ domain_id: d.id, access_level: d.accessLevel }));
      }
      await api.post(`/orgs/${orgId}/teams`, payload);
      qc.invalidateQueries({ queryKey: ["teams"] });
      fetchTeams(orgId);
      toast.success("Team created");
      setOpen(false);
      setName("");
      setDescription("");
      setInitialMembers([]);
      setSelectedDomains([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setName(""); setDescription(""); setInitialMembers([]); setSelectedDomains([]); setMemberSearch(""); setDomainSearch(""); } }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Create Team</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a team</DialogTitle>
          <DialogDescription>Teams let you group members and assign domains so the right people have access to the right inboxes.</DialogDescription>
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
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
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
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove member" onClick={() => removeMember(m.email)}>
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
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
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

          {/* Domains */}
          <div className="border-t pt-4 space-y-3">
            <div className="space-y-1">
              <Label>Domains <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <p className="text-xs text-muted-foreground">Assign verified domains to this team for inbox creation.</p>
            </div>

            {/* Selected domains */}
            {selectedDomains.length > 0 && (
              <div className="space-y-1.5">
                {selectedDomains.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium font-mono truncate">{d.name}</p>
                    </div>
                    <Select value={d.accessLevel} onValueChange={(v) => setSelectedDomains((prev) => prev.map((s) => s.id === d.id ? { ...s, accessLevel: v } : s))}>
                      <SelectTrigger className="w-[120px] h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full</SelectItem>
                        <SelectItem value="create_inbox">Create Inbox</SelectItem>
                        <SelectItem value="read_only">Read Only</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove domain" onClick={() => setSelectedDomains((prev) => prev.filter((s) => s.id !== d.id))}>
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Domain search / add */}
            {availableDomains.length > 0 ? (
              <div className="relative">
                <Input
                  value={domainSearch}
                  onChange={(e) => setDomainSearch(e.target.value)}
                  placeholder="Search verified domains to assign..."
                  autoComplete="off"
                />
                {(domainSearch || filteredAvailableDomains.length <= 6) && filteredAvailableDomains.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {filteredAvailableDomains.slice(0, 8).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-mono hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => { setSelectedDomains((prev) => [...prev, { id: d.id, name: d.domain_name, accessLevel: "full" }]); setDomainSearch(""); }}
                      >
                        <Globe className="h-3 w-3 text-muted-foreground" />
                        {d.domain_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : verifiedDomains.length > 0 && selectedDomains.length === verifiedDomains.length ? (
              <p className="text-xs text-muted-foreground">All verified domains have been selected.</p>
            ) : (
              <p className="text-xs text-muted-foreground">No verified domains available to assign.</p>
            )}
          </div>

          <Button onClick={create} className="w-full" disabled={!nameValid || isDuplicate || creating}>
            {creating ? "Creating…" : `Create Team${initialMembers.length > 0 || selectedDomains.length > 0 ? " with" : ""}${initialMembers.length > 0 ? ` ${initialMembers.length} member${initialMembers.length !== 1 ? "s" : ""}` : ""}${initialMembers.length > 0 && selectedDomains.length > 0 ? " and" : ""}${selectedDomains.length > 0 ? ` ${selectedDomains.length} domain${selectedDomains.length !== 1 ? "s" : ""}` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TeamMembersTab({ orgId, teamId, isAdmin }: { orgId: string; teamId: string; isAdmin: boolean }) {
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
      {/* Toolbar: counts + search + add */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground tabular-nums">
          {members.length} {members.length === 1 ? "member" : "members"}
          {leadCount > 0 && ` · ${leadCount} ${leadCount === 1 ? "lead" : "leads"}`}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {members.length > 3 && (
            <Input
              placeholder="Search members…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
              aria-label="Search team members"
            />
          )}
        {isAdmin && <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) { setMemberEmail(""); setRole("member"); setSuggestions([]); setShowSuggestions(false); } }}>
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
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
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
        </Dialog>}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : (
          <>
              {filtered.length === 0 && !search && (
                <EmptyState title="No members yet" description="Add members so the team can start receiving and managing inboxes." />
              )}
              {filtered.length === 0 && search && (
                <Table className="table-striped">
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
                <Table className="table-striped">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-medium">Member</TableHead>
                      <TableHead className="font-medium">Role</TableHead>
                      <TableHead className="font-medium hidden sm:table-cell">Joined</TableHead>
                      {isAdmin && <TableHead className="text-right font-medium">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((m) => (
                <TableRow key={m.id} className="hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                        {(m.display_name || m.email || "?").charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{m.display_name || "—"}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">{m.email || "—"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isAdmin ? (
                    <Select value={m.role} onValueChange={(r) => changeRole.mutate({ uid: m.user_id, role: r })}>
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {teamRoles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    ) : (
                      <Badge variant="secondary" className="text-xs">{m.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                    {m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  {isAdmin && (
                  <TableCell className="text-right">
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Remove member"><Trash2 className="h-3.5 w-3.5" /></Button>}
                      title="Remove member?"
                      description={`${m.display_name || m.email} will lose access to this team.`}
                      onConfirm={() => removeMember.mutate(m.user_id)}
                    />
                  </TableCell>
                  )}
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

function accessLabel(level: string): string {
  return level === "full" ? "Full" : level === "create_inbox" ? "Create inbox" : level === "read_only" ? "Read only" : level;
}

function DomainAssignmentsTab({ orgId, teamId, isAdmin }: { orgId: string; teamId: string; isAdmin: boolean }) {
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
      {/* Toolbar: count + search + assign */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground tabular-nums">
          {assignmentList.length} {assignmentList.length === 1 ? "domain" : "domains"} assigned · {available.length} {available.length === 1 ? "domain" : "domains"} available
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {assignmentList.length > 0 && (
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Filter domains…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
                aria-label="Filter assigned domains"
              />
            </div>
          )}
          {isAdmin && available.length > 0 && (
            <Dialog open={assignOpen} onOpenChange={(v) => { setAssignOpen(v); if (!v) setSelectedDomain(""); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Assign Domain</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign domain to team</DialogTitle>
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
              <EmptyState title="No domains assigned" description="Assign verified domains so this team can create inboxes." />
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No domains match &quot;{search}&quot;</div>
            )
          ) : (
          <Table className="table-striped">
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-medium">Domain</TableHead>
                <TableHead className="font-medium">Access</TableHead>
                <TableHead className="font-medium hidden sm:table-cell">Assigned</TableHead>
                {isAdmin && <TableHead className="text-right font-medium">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/30">
                  <TableCell>
                    <Link href={`/domains/${a.domain_id}`} className="flex items-center gap-3 group">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <span className="font-medium font-mono text-sm group-hover:text-primary transition-colors">{a.domain_name || a.domain_id}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{accessLabel(a.access_level)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </TableCell>
                  {isAdmin && (
                  <TableCell className="text-right">
                    <UnassignDomainDialog
                      orgId={orgId}
                      assignment={a}
                      onConfirm={() => unassign.mutate(a.domain_id)}
                    />
                  </TableCell>
                  )}
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

function UnassignDomainDialog({ orgId, assignment, onConfirm }: {
  orgId: string; assignment: DomainAssignment; onConfirm: () => void;
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
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="Unassign domain" onClick={() => setOpen(true)}>
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
                <div className="rounded-lg border border-warning/20 bg-warning/5 p-3 text-sm text-warning flex items-start gap-2">
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
              <div className="rounded-lg border border-success/20 bg-success/5 p-3 text-sm text-success">
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