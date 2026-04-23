"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { useOrgStore } from "@/stores/org-store";
import { useAuthStore } from "@/stores/auth-store";
import { useRoles, type PermissionInfo } from "@/hooks/use-roles";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Pagination } from "@/components/pagination";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { KeyIllustration } from "@/components/illustrations";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  Globe,
  Key,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  X,
  Activity,
  Ban,
} from "lucide-react";
import type { APIKey, PaginatedResponse } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXPIRY_OPTIONS = [
  { label: "No expiration", value: "" },
  { label: "7 days", value: "168h" },
  { label: "30 days", value: "720h" },
  { label: "90 days", value: "2160h" },
  { label: "1 year", value: "8760h" },
];

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

interface PermissionGroup {
  key: string;
  name: string;
  permissions: PermissionInfo[];
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
    .map(([key, perms]) => ({ key, name: groupLabel(key), permissions: perms }));
}

/** Build a map from permission key to its label for display. */
function buildScopeLabelMap(permissions: PermissionInfo[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of permissions) m.set(p.key, p.label);
  return m;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ApiKeysPage() {
  const { currentOrg, currentTeam, hasPermission } = useOrgStore();
  const { user } = useAuthStore();
  const { teamPermissions } = useRoles();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [detailKey, setDetailKey] = useState<APIKey | null>(null);

  const scopeLabelMap = useMemo(() => buildScopeLabelMap(teamPermissions), [teamPermissions]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["api-keys", currentTeam?.id, page],
    queryFn: () =>
      api.get<PaginatedResponse<APIKey>>(
        `/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/api-keys`,
        { page: String(page), per_page: "20" },
      ),
    enabled: !!currentOrg && !!currentTeam,
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      api.del(`/orgs/${currentOrg!.id}/teams/${currentTeam!.id}/api-keys/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["api-keys"] });
      const key = ["api-keys", currentTeam?.id, page];
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: PaginatedResponse<APIKey> | undefined) =>
        old ? { ...old, data: old.data.filter((k) => k.id !== id) } : old,
      );
      return { prev, key };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err instanceof Error ? err.message : "Failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
    onSuccess: () => toast.success("API key revoked"),
  });

  if (!currentTeam)
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-muted-foreground">Select a team to manage API keys.</p>
        <Link href="/teams">
          <Button variant="outline" size="sm">Go to Teams</Button>
        </Link>
      </div>
    );

  const isAdmin = hasPermission("org.settings.manage") || user?.is_system_admin;
  if (!isAdmin)
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-muted-foreground">You don&apos;t have permission to access this page.</p>
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="overflow-hidden">
        <div className="h-2 bg-gradient-to-r from-violet-500/80 to-violet-500/20" />
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-violet-500/10 flex items-center justify-center">
                <Key className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <h1 className="text-base font-semibold">API Keys</h1>
                <p className="text-sm text-muted-foreground">
                  {data?.data?.length
                    ? `${data.total ?? data.data.length} key${(data.total ?? data.data.length) !== 1 ? "s" : ""} · Manage programmatic access to your team\u2019s resources.`
                    : "Manage programmatic access to your team\u2019s resources."}
                </p>
              </div>
            </div>
            <CreateApiKeyDialog
              orgId={currentOrg!.id}
              teamId={currentTeam.id}
              teamPermissions={teamPermissions}
            />
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {data?.data && data.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              label: "Total",
              value: data.total,
              icon: Key,
              bg: "bg-violet-100 text-violet-600",
            },
            {
              label: "Active",
              value: data.data.filter(
                (k) => k.is_active && (!k.expires_at || new Date(k.expires_at) >= new Date()),
              ).length,
              icon: CheckCircle2,
              bg: "bg-emerald-100 text-emerald-600",
            },
            {
              label: "Expired / Inactive",
              value: data.data.filter(
                (k) => !k.is_active || (k.expires_at && new Date(k.expires_at) < new Date()),
              ).length,
              icon: Clock,
              bg: "bg-red-100 text-red-600",
            },
          ].map((s) => (
            <Card key={s.label} className="transition-all hover:shadow-md hover:-translate-y-0.5">
              <CardContent className="pt-5 pb-4">
                <div className="flex justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
                  <div className={`flex items-center justify-center h-8 w-8 rounded-lg ${s.bg}`}>
                    <s.icon className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Key list */}
      {isError ? (
        <ErrorState message="Failed to load API keys" onRetry={() => refetch()} />
      ) : isLoading ? (
        <ApiKeyListSkeleton />
      ) : (
        <>
          {!data?.data || data.data.length === 0 ? (
            <EmptyState
              illustration={<KeyIllustration />}
              title="No API keys"
              description="Create an API key for programmatic access to inboxes and emails."
            />
          ) : (
            <div className="space-y-4">
              {data.data.map((k) => (
                <ApiKeyCard
                  key={k.id}
                  apiKey={k}
                  scopeLabelMap={scopeLabelMap}
                  onRevoke={() => revoke.mutate(k.id)}
                  onClick={() => setDetailKey(k)}
                />
              ))}
              <Pagination page={page} totalPages={data.total_pages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      {/* Detail dialog */}
      {detailKey && (
        <KeyDetailDialog
          apiKey={detailKey}
          orgId={currentOrg!.id}
          teamId={currentTeam.id}
          teamPermissions={teamPermissions}
          scopeLabelMap={scopeLabelMap}
          open={!!detailKey}
          onOpenChange={(open) => {
            if (!open) setDetailKey(null);
          }}
          onUpdated={() => {
            qc.invalidateQueries({ queryKey: ["api-keys"] });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Key Card
// ---------------------------------------------------------------------------

function ApiKeyCard({
  apiKey: k,
  scopeLabelMap,
  onRevoke,
  onClick,
}: {
  apiKey: APIKey;
  scopeLabelMap: Map<string, string>;
  onRevoke: () => void;
  onClick: () => void;
}) {
  const isExpired = k.expires_at && new Date(k.expires_at) < new Date();
  const isRevoked = !!k.revoked_at;
  const isInactive = !k.is_active;
  const dimmed = isExpired || isRevoked || isInactive;

  const copyPrefix = (e: React.MouseEvent) => {
    e.stopPropagation();
    copyToClipboard(k.key_prefix);
    toast.success("Prefix copied");
  };

  return (
    <Card
      className={`hover:shadow-md transition-all cursor-pointer ${dimmed ? "border-dashed opacity-60" : ""}`}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div
              className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${
                dimmed
                  ? "bg-red-100 text-red-600"
                  : "bg-violet-100 text-violet-600"
              }`}
            >
              <Key className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-sm truncate">{k.name}</CardTitle>
                {isRevoked && (
                  <Badge variant="destructive" className="gap-1 shrink-0">
                    <Ban className="h-3 w-3" /> Revoked
                  </Badge>
                )}
                {!isRevoked && isExpired && (
                  <Badge variant="destructive" className="gap-1 shrink-0">
                    <AlertTriangle className="h-3 w-3" /> Expired
                  </Badge>
                )}
                {!isRevoked && !isExpired && isInactive && (
                  <Badge variant="secondary" className="gap-1 shrink-0">Inactive</Badge>
                )}
                {!isRevoked && !isExpired && k.is_active && (
                  <Badge className="gap-1 shrink-0 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                    <CheckCircle2 className="h-3 w-3" /> Active
                  </Badge>
                )}
              </div>
              <button
                onClick={copyPrefix}
                className="mt-1 flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors group"
              >
                {k.key_prefix}•••
                <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive shrink-0">
                  <Trash2 className="h-4 w-4" />
                </Button>
              }
              title="Revoke API key?"
              description={`"${k.name}" will immediately stop working. This cannot be undone.`}
              onConfirm={onRevoke}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {/* Scopes */}
        <div className="flex flex-wrap gap-1.5">
          {k.scopes?.slice(0, 6).map((s) => (
            <Badge key={s} variant="outline" className="text-xs">
              {scopeLabelMap.get(s) ?? s}
            </Badge>
          ))}
          {k.scopes && k.scopes.length > 6 && (
            <Badge variant="outline" className="text-xs">+{k.scopes.length - 6} more</Badge>
          )}
        </div>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Created {new Date(k.created_at).toLocaleDateString()}
          </span>
          {k.expires_at ? (
            <span>{isExpired ? "Expired" : "Expires"} {new Date(k.expires_at).toLocaleDateString()}</span>
          ) : (
            <span>No expiration</span>
          )}
          {typeof k.request_count === "number" && (
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              {k.request_count.toLocaleString()} requests
            </span>
          )}
          {k.allowed_ips && k.allowed_ips.length > 0 && (
            <span className="flex items-center gap-1">
              <Globe className="h-3 w-3" />
              {k.allowed_ips.length} IP{k.allowed_ips.length !== 1 ? "s" : ""}
            </span>
          )}
          <span className="ml-auto">
            {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}` : "Never used"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function ApiKeyListSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4 mt-1" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2 mt-2" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope Picker (shared by Create & Edit)
// ---------------------------------------------------------------------------

function ScopePicker({
  teamPermissions,
  selected,
  onToggle,
  onSelectAllGroup,
  onDeselectAllGroup,
}: {
  teamPermissions: PermissionInfo[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSelectAllGroup: (keys: string[]) => void;
  onDeselectAllGroup: (keys: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupPermissions(teamPermissions), [teamPermissions]);

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
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {selected.size} of {teamPermissions.length} scopes selected
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => onSelectAllGroup(teamPermissions.map((p) => p.key))}
          >
            All
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => onDeselectAllGroup(teamPermissions.map((p) => p.key))}
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
          placeholder="Filter scopes…"
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

      <div className="rounded-lg border divide-y max-h-[40vh] overflow-y-auto">
        {filtered.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          const enabledInGroup = group.permissions.filter((p) => selected.has(p.key)).length;
          const groupKeys = group.permissions.map((p) => p.key);

          return (
            <div key={group.key}>
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 sticky top-0 z-10">
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm font-medium hover:text-foreground"
                  onClick={() => toggleCollapse(group.key)}
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
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-[10px] h-6 px-2"
                    onClick={() => onSelectAllGroup(groupKeys)}
                  >
                    All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-[10px] h-6 px-2"
                    onClick={() => onDeselectAllGroup(groupKeys)}
                  >
                    None
                  </Button>
                </div>
              </div>

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
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          )}
                          <span className="text-sm font-medium">{perm.label}</span>
                          <code className="text-[10px] text-muted-foreground font-mono ml-auto hidden sm:inline">
                            {perm.key}
                          </code>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{perm.description}</p>
                      </div>
                      <Switch checked={checked} onCheckedChange={() => onToggle(perm.key)} />
                    </div>
                  );
                })}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No scopes match your search.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Raw Key Display (shared by Create & Rotate)
// ---------------------------------------------------------------------------

function RawKeyDisplay({ rawKey, onDone }: { rawKey: string; onDone: () => void }) {
  const copyKey = () => {
    copyToClipboard(rawKey);
    toast.success("API key copied");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Copy this key now — it won&apos;t be shown again.
      </p>
      <button
        onClick={copyKey}
        className="w-full rounded-md bg-muted p-3 text-left font-mono text-sm break-all hover:bg-muted/80 transition-colors group"
      >
        {rawKey}
        <Copy className="inline-block ml-2 h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
      <Button onClick={onDone} className="w-full">
        Done
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create API Key Dialog
// ---------------------------------------------------------------------------

function CreateApiKeyDialog({
  orgId,
  teamId,
  teamPermissions,
}: {
  orgId: string;
  teamId: string;
  teamPermissions: PermissionInfo[];
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [expiresIn, setExpiresIn] = useState("");
  const [allowedIps, setAllowedIps] = useState("");
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const toggleScope = useCallback((key: string) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAllGroup = useCallback((keys: string[]) => {
    setScopes((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  const deselectAllGroup = useCallback((keys: string[]) => {
    setScopes((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  const create = async () => {
    if (!name.trim() || scopes.size === 0) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), scopes: [...scopes] };
      if (expiresIn && expiresIn !== "none") body.expires_in = expiresIn;
      const ips = allowedIps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ips.length > 0) body.allowed_ips = ips;
      const res = await api.post<APIKey>(`/orgs/${orgId}/teams/${teamId}/api-keys`, body);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setRawKey(res.raw_key ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const close = () => {
    setOpen(false);
    setRawKey(null);
    setName("");
    setScopes(new Set());
    setExpiresIn("");
    setAllowedIps("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
        else setOpen(true);
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Create API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rawKey ? "API Key Created" : "Create an API key"}</DialogTitle>
          {!rawKey && (
            <DialogDescription>
              Keys are hashed with SHA-256 and cannot be recovered. Copy it immediately after creation.
            </DialogDescription>
          )}
        </DialogHeader>
        {rawKey ? (
          <RawKeyDisplay rawKey={rawKey} onDone={close} />
        ) : (
          <div className="space-y-5">
            {/* Name */}
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. CI Pipeline"
                onKeyDown={(e) => e.key === "Enter" && create()}
              />
            </div>

            {/* Scopes */}
            <div className="space-y-2">
              <Label>Scopes</Label>
              {teamPermissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading available scopes…</p>
              ) : (
                <ScopePicker
                  teamPermissions={teamPermissions}
                  selected={scopes}
                  onToggle={toggleScope}
                  onSelectAllGroup={selectAllGroup}
                  onDeselectAllGroup={deselectAllGroup}
                />
              )}
              {scopes.size === 0 && teamPermissions.length > 0 && (
                <p className="text-xs text-destructive">Select at least one scope</p>
              )}
            </div>

            {/* Expiration */}
            <div className="space-y-2">
              <Label>Expiration</Label>
              <Select value={expiresIn} onValueChange={setExpiresIn}>
                <SelectTrigger>
                  <SelectValue placeholder="No expiration" />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => (
                    <SelectItem key={o.value || "none"} value={o.value || "none"}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* IP Allowlist */}
            <div className="space-y-2">
              <Label>IP Allowlist (optional)</Label>
              <Textarea
                value={allowedIps}
                onChange={(e) => setAllowedIps(e.target.value)}
                placeholder="Comma-separated IPs or CIDRs, e.g. 10.0.0.1, 192.168.0.0/24"
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to allow requests from any IP.
              </p>
            </div>

            <Button
              onClick={create}
              className="w-full"
              disabled={!name.trim() || scopes.size === 0 || creating}
            >
              {creating ? "Creating…" : "Create API Key"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Key Detail Dialog
// ---------------------------------------------------------------------------

function KeyDetailDialog({
  apiKey: initialKey,
  orgId,
  teamId,
  teamPermissions,
  scopeLabelMap,
  open,
  onOpenChange,
  onUpdated,
}: {
  apiKey: APIKey;
  orgId: string;
  teamId: string;
  teamPermissions: PermissionInfo[];
  scopeLabelMap: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  // Fetch fresh detail
  const { data: key } = useQuery({
    queryKey: ["api-key-detail", teamId, initialKey.id],
    queryFn: () => api.get<APIKey>(`/orgs/${orgId}/teams/${teamId}/api-keys/${initialKey.id}`),
    enabled: open,
    initialData: initialKey,
  });

  const qc = useQueryClient();

  const isExpired = key.expires_at && new Date(key.expires_at) < new Date();
  const isRevoked = !!key.revoked_at;

  const handleRotate = async () => {
    setRotating(true);
    try {
      const res = await api.post<APIKey>(
        `/orgs/${orgId}/teams/${teamId}/api-keys/${key.id}/rotate`,
      );
      setRotatedKey(res.raw_key ?? null);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      qc.invalidateQueries({ queryKey: ["api-key-detail", teamId, key.id] });
      toast.success("Key rotated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate key");
    } finally {
      setRotating(false);
    }
  };

  const handleRevoke = async () => {
    try {
      await api.del(`/orgs/${orgId}/teams/${teamId}/api-keys/${key.id}`);
      toast.success("API key revoked");
      onUpdated();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  };

  if (editing) {
    return (
      <EditKeyDialog
        apiKey={key}
        orgId={orgId}
        teamId={teamId}
        teamPermissions={teamPermissions}
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setEditing(false);
            onOpenChange(false);
          }
        }}
        onSaved={() => {
          setEditing(false);
          onUpdated();
          qc.invalidateQueries({ queryKey: ["api-key-detail", teamId, key.id] });
        }}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {key.name}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{key.key_prefix}•••</span>
          </DialogDescription>
        </DialogHeader>

        {rotatedKey ? (
          <RawKeyDisplay
            rawKey={rotatedKey}
            onDone={() => {
              setRotatedKey(null);
            }}
          />
        ) : (
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-center gap-2">
              {isRevoked ? (
                <Badge variant="destructive" className="gap-1">
                  <Ban className="h-3 w-3" /> Revoked
                </Badge>
              ) : isExpired ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> Expired
                </Badge>
              ) : key.is_active ? (
                <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  <CheckCircle2 className="h-3 w-3" /> Active
                </Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </div>

            <Separator />

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Created</p>
                <p>{new Date(key.created_at).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Expiration</p>
                <p>
                  {key.expires_at
                    ? `${isExpired ? "Expired" : "Expires"} ${new Date(key.expires_at).toLocaleDateString()}`
                    : "Never"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Last Used</p>
                <p>{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Requests</p>
                <p>{typeof key.request_count === "number" ? key.request_count.toLocaleString() : "—"}</p>
              </div>
              {key.last_used_ip && (
                <div>
                  <p className="text-muted-foreground text-xs">Last Used IP</p>
                  <p className="font-mono text-xs">{key.last_used_ip}</p>
                </div>
              )}
              {key.created_by_email && (
                <div>
                  <p className="text-muted-foreground text-xs">Created By</p>
                  <p className="truncate">{key.created_by_name || key.created_by_email}</p>
                </div>
              )}
            </div>

            {/* IP Allowlist */}
            {key.allowed_ips && key.allowed_ips.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Globe className="h-3 w-3" /> IP Allowlist
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {key.allowed_ips.map((ip) => (
                      <Badge key={ip} variant="outline" className="font-mono text-xs">
                        {ip}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Scopes */}
            <Separator />
            <div>
              <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                <Shield className="h-3 w-3" /> Scopes ({key.scopes?.length ?? 0})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {key.scopes?.map((s) => (
                  <Badge key={s} variant="outline" className="text-xs">
                    {scopeLabelMap.get(s) ?? s}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Actions */}
            {!isRevoked && (
              <>
                <Separator />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
                    <Edit2 className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm" className="gap-1.5" disabled={rotating}>
                        <RefreshCw className={`h-3.5 w-3.5 ${rotating ? "animate-spin" : ""}`} /> Rotate
                      </Button>
                    }
                    title="Rotate API key?"
                    description="The current key will be invalidated and a new one generated. Any systems using the old key will stop working."
                    onConfirm={handleRotate}
                    variant="default"
                  />
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" /> Revoke
                      </Button>
                    }
                    title="Revoke API key?"
                    description={`"${key.name}" will immediately stop working. This cannot be undone.`}
                    onConfirm={handleRevoke}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit Key Dialog
// ---------------------------------------------------------------------------

function EditKeyDialog({
  apiKey: key,
  orgId,
  teamId,
  teamPermissions,
  open,
  onOpenChange,
  onSaved,
}: {
  apiKey: APIKey;
  orgId: string;
  teamId: string;
  teamPermissions: PermissionInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(key.name);
  const [isActive, setIsActive] = useState(key.is_active);
  const [scopes, setScopes] = useState<Set<string>>(new Set(key.scopes ?? []));
  const [allowedIps, setAllowedIps] = useState((key.allowed_ips ?? []).join(", "));
  const [saving, setSaving] = useState(false);

  const toggleScope = useCallback((k: string) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const selectAllGroup = useCallback((keys: string[]) => {
    setScopes((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }, []);

  const deselectAllGroup = useCallback((keys: string[]) => {
    setScopes((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (name !== key.name) body.name = name.trim();
      if (isActive !== key.is_active) body.is_active = isActive;

      const newScopes = [...scopes].sort();
      const oldScopes = [...(key.scopes ?? [])].sort();
      if (JSON.stringify(newScopes) !== JSON.stringify(oldScopes)) body.scopes = newScopes;

      const ips = allowedIps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const oldIps = [...(key.allowed_ips ?? [])].sort();
      if (JSON.stringify([...ips].sort()) !== JSON.stringify(oldIps)) body.allowed_ips = ips;

      if (Object.keys(body).length === 0) {
        onOpenChange(false);
        return;
      }

      await api.patch(`/orgs/${orgId}/teams/${teamId}/api-keys/${key.id}`, body);
      toast.success("API key updated");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update key");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit API Key</DialogTitle>
          <DialogDescription>
            Update the name, scopes, status, or IP allowlist for this key.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Inactive keys reject all requests.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {/* Scopes */}
          <div className="space-y-2">
            <Label>Scopes</Label>
            <ScopePicker
              teamPermissions={teamPermissions}
              selected={scopes}
              onToggle={toggleScope}
              onSelectAllGroup={selectAllGroup}
              onDeselectAllGroup={deselectAllGroup}
            />
          </div>

          {/* IP Allowlist */}
          <div className="space-y-2">
            <Label>IP Allowlist</Label>
            <Textarea
              value={allowedIps}
              onChange={(e) => setAllowedIps(e.target.value)}
              placeholder="Comma-separated IPs or CIDRs"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to allow requests from any IP.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} className="w-full" disabled={!name.trim() || scopes.size === 0 || saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
