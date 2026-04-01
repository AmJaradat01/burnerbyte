"use client";

import { useRoles } from "@/hooks/use-roles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Users } from "lucide-react";

export function RolesTab() {
  const { orgRoles, teamRoles } = useRoles();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Roles & Permissions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          View the role hierarchy and permissions for your organization and teams.
        </p>
      </div>

      {/* Org Roles */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Organization Roles</CardTitle>
              <CardDescription>Control access to organization-level resources and settings.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-0">
          {orgRoles.map((role, i) => (
            <div key={role.value} className={`flex items-center justify-between py-4 ${i > 0 ? "border-t" : ""}`}>
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                  {role.rank}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{role.label}</p>
                    <Badge variant="outline" className="text-[10px] font-mono">{role.value}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{role.description}</p>
                </div>
              </div>
              <PermissionBadges type="org" role={role.value} />
            </div>
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
              <CardDescription>Control access to team-level resources like inboxes, webhooks, and API keys.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-0">
          {teamRoles.map((role, i) => (
            <div key={role.value} className={`flex items-center justify-between py-4 ${i > 0 ? "border-t" : ""}`}>
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                  {role.rank}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{role.label}</p>
                    <Badge variant="outline" className="text-[10px] font-mono">{role.value}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{role.description}</p>
                </div>
              </div>
              <PermissionBadges type="team" role={role.value} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Permission Matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Permission Matrix</CardTitle>
          <CardDescription>Detailed breakdown of what each role can do.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Permission</th>
                  {orgRoles.map((r) => (
                    <th key={r.value} className="text-center py-2 px-3 font-medium text-muted-foreground">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ORG_PERMISSIONS.map((perm) => (
                  <tr key={perm.key} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 text-sm">{perm.label}</td>
                    {orgRoles.map((r) => (
                      <td key={r.value} className="text-center py-2.5 px-3">
                        {perm.roles.includes(r.value) ? <span className="text-emerald-500">✓</span> : <span className="text-muted-foreground/30">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 pt-4 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-3">Team Permissions</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Permission</th>
                  {teamRoles.map((r) => (
                    <th key={r.value} className="text-center py-2 px-3 font-medium text-muted-foreground">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TEAM_PERMISSIONS.map((perm) => (
                  <tr key={perm.key} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 text-sm">{perm.label}</td>
                    {teamRoles.map((r) => (
                      <td key={r.value} className="text-center py-2.5 px-3">
                        {perm.roles.includes(r.value) ? <span className="text-emerald-500">✓</span> : <span className="text-muted-foreground/30">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const ORG_PERMISSIONS = [
  { key: "org.manage", label: "Manage organization settings", roles: ["owner", "admin"] },
  { key: "org.delete", label: "Delete organization", roles: ["owner"] },
  { key: "org.members.invite", label: "Invite members", roles: ["owner", "admin"] },
  { key: "org.members.remove", label: "Remove members", roles: ["owner", "admin"] },
  { key: "org.members.role", label: "Change member roles", roles: ["owner"] },
  { key: "org.domains", label: "Manage domains", roles: ["owner", "admin"] },
  { key: "org.teams", label: "Create/manage teams", roles: ["owner", "admin"] },
  { key: "org.audit", label: "View audit logs", roles: ["owner", "admin"] },
  { key: "org.view", label: "View organization", roles: ["owner", "admin", "member"] },
];

const TEAM_PERMISSIONS = [
  { key: "team.manage", label: "Manage team settings", roles: ["lead"] },
  { key: "team.members", label: "Add/remove team members", roles: ["lead"] },
  { key: "team.webhooks", label: "Manage webhooks", roles: ["lead"] },
  { key: "team.apikeys", label: "Manage API keys", roles: ["lead"] },
  { key: "team.domains", label: "Manage domain assignments", roles: ["lead"] },
  { key: "team.inboxes", label: "Create/manage inboxes", roles: ["lead", "member"] },
  { key: "team.emails", label: "View emails", roles: ["lead", "member"] },
];

function PermissionBadges({ type, role }: { type: "org" | "team"; role: string }) {
  const perms = type === "org" ? ORG_PERMISSIONS : TEAM_PERMISSIONS;
  const count = perms.filter((p) => p.roles.includes(role)).length;
  return (
    <Badge variant="secondary" className="text-xs">
      {count}/{perms.length} permissions
    </Badge>
  );
}
