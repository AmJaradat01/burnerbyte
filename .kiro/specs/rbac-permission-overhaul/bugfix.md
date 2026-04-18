# Bugfix Requirements Document

## Introduction

The RBAC (Role-Based Access Control) enforcement layer in `internal/auth/rbac/rbac.go` uses hardcoded rank-based integer comparisons (`orgRank[m.Role] >= orgRank[minRole]`) instead of checking actual permissions from the database. The project has a fully modeled DB-backed roles and permissions system (tables: `roles`, `permissions`, `role_permissions` from migration `000024`) with a working admin UI for editing role permissions, but the enforcement layer completely ignores it. This means permission changes made through the admin UI have zero effect on actual access control. Additionally, several roles, permissions, and access patterns are broken or missing, including the Team Viewer role not being seeded, org analytics being over-restricted, API key scopes being hardcoded, no self-protection on role changes, and custom roles being unrecognized by the rank-based checker.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a handler calls `RequireOrgRole(r, orgID, "admin")` THEN the system compares hardcoded integer ranks (`orgRank[m.Role] >= orgRank[minRole]`) instead of checking whether the user's role has the required permission key in the `role_permissions` table

1.2 WHEN a handler calls `RequireTeamRole(r, orgID, teamID, "admin", "lead")` THEN the system compares hardcoded integer ranks (`teamRank[tm.Role] >= teamRank[minTeamRole]`) instead of checking whether the user's team role has the required permission key in the `role_permissions` table

1.3 WHEN an admin edits role permissions through the Roles settings page (calling `SetRolePermissions`) THEN the changes are saved to the `role_permissions` table but have zero effect on actual access control because the enforcement layer never reads from that table

1.4 WHEN a user with the Team Viewer role attempts to view team inboxes, domain assignments, webhooks, API keys, or analytics THEN the system returns 403 Forbidden because all these endpoints require minimum `TeamMember` rank (1) and Viewer has rank 0

1.5 WHEN an org admin calls `ChangeRole` to demote another admin, or a team lead calls `ChangeRole` to demote another lead THEN the system allows the operation because there is no self-protection check preventing users from modifying peers at the same or higher rank

1.6 WHEN an org member (non-admin) requests org analytics (`/orgs/{orgId}/analytics`) THEN the system returns 403 Forbidden because `OrgAnalytics`, `OrgEmailsPerDay`, and `OrgInsights` all require `rbac.OrgAdmin` minimum role

1.7 WHEN an API key is created with scopes THEN the valid scopes are checked against a hardcoded `map[string]bool` in `apikey_service.go` (`inbox:create`, `inbox:read`, `inbox:write`, `inbox:delete`, `email:read`, `email:write`, `email:delete`, `webhook:read`, `webhook:write`) instead of being derived from the `permissions` table

1.8 WHEN an admin creates a custom role via the Roles settings page and assigns it to a user THEN the RBAC checker does not recognize the custom role because `orgRank` and `teamRank` maps only contain hardcoded system roles, causing the rank lookup to return 0 and denying access

1.9 WHEN the database is seeded via migration `000024` THEN the `viewer` team role is not created, even though the code in `rbac.go` defines `TeamViewer = "viewer"` with rank 0 and `TeamRoles()` includes it

1.10 WHEN the system checks permissions THEN there are no permission keys for: org analytics viewing (`org.analytics.view`), org settings viewing (`org.settings.view`), org members viewing (`org.members.view`), org members adding (`org.members.add`), org teams creating (`org.teams.create`), org teams deleting (`org.teams.delete`), org audit exporting (`org.audit.export`), org domains viewing (`org.domains.view`), team viewing (`team.view`), team members viewing (`team.members.view`), team members role changing (`team.members.role`), team domains viewing (`team.domains.view`), team webhooks viewing (`team.webhooks.view`), team API keys viewing (`team.apikeys.view`), team inboxes viewing (`team.inboxes.view`), team inboxes creating (`team.inboxes.create`), team analytics viewing (`team.analytics.view`), or team emails viewing as a separate read permission

### Expected Behavior (Correct)

2.1 WHEN a handler needs to enforce an org-level action THEN the system SHALL call `RequireOrgPermission(r, orgID, "org.members.invite")` (or the appropriate permission key) which loads the user's org role, resolves its permissions from the `role_permissions` table, and checks whether the required permission key is present

2.2 WHEN a handler needs to enforce a team-level action THEN the system SHALL call `RequireTeamPermission(r, orgID, teamID, "team.webhooks.manage")` (or the appropriate permission key) which loads the user's team role (with org-level fallback), resolves its permissions from the `role_permissions` table, and checks whether the required permission key is present

2.3 WHEN an admin edits role permissions through the Roles settings page THEN the changes SHALL take effect on subsequent access control checks because the enforcement layer reads permissions from the `role_permissions` table (with caching that refreshes on role updates)

2.4 WHEN a user with the Team Viewer role attempts to view team inboxes, domain assignments, webhooks, API keys, or analytics THEN the system SHALL allow access because these read-only endpoints require view permissions (`team.inboxes.view`, `team.domains.view`, `team.webhooks.view`, `team.apikeys.view`, `team.analytics.view`) which are assigned to the Viewer role

2.5 WHEN a user attempts to change the role of another user at the same or higher rank THEN the system SHALL return 403 Forbidden with a message indicating that users cannot modify peers at the same or higher rank level

2.6 WHEN an org member with the `org.analytics.view` permission requests org analytics THEN the system SHALL allow access, and the `org.analytics.view` permission SHALL be assigned to the admin and owner roles by default (with the option to grant it to member roles via the admin UI)

2.7 WHEN an API key is created with scopes THEN the valid scopes SHALL be derived from the team-scoped permissions in the `permissions` table, and the `HasScope` check SHALL verify the API key has the required team permission key

2.8 WHEN an admin creates a custom role via the Roles settings page and assigns permissions to it THEN the RBAC checker SHALL recognize the custom role and enforce access based on its assigned permissions from the `role_permissions` table, not from hardcoded rank maps

2.9 WHEN the database is seeded THEN a `viewer` team role SHALL be created with rank 0, `is_system = TRUE`, and assigned read-only permissions (`team.view`, `team.members.view`, `team.domains.view`, `team.webhooks.view`, `team.apikeys.view`, `team.inboxes.view`, `team.emails.view`, `team.analytics.view`)

2.10 WHEN the system checks permissions THEN the `permissions` table SHALL contain all granular permission keys covering: org-level view/manage/delete operations, org member management (view, invite, add, remove, role), org domain management (view, manage), org team management (create, delete), org audit (view, export), org analytics (view), team-level view, team settings management, team member management (view, manage, role), team domain assignments (view, manage), team webhooks (view, manage), team API keys (view, manage), team inboxes (view, create), team emails (view), and team analytics (view)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a system admin makes any request THEN the system SHALL CONTINUE TO bypass all RBAC checks and grant full access

3.2 WHEN a user who is not a member of an organization attempts any org-scoped action THEN the system SHALL CONTINUE TO return a "not a member of this organization" error

3.3 WHEN a user who is not a member of a team attempts any team-scoped action (and does not have sufficient org-level role for fallback) THEN the system SHALL CONTINUE TO return a "not a member of this team" error

3.4 WHEN an org owner performs any org-level action THEN the system SHALL CONTINUE TO allow the action because the owner role has all org permissions

3.5 WHEN a team lead performs team management actions (settings, members, webhooks, API keys, domains) THEN the system SHALL CONTINUE TO allow these actions because the lead role has all team permissions

3.6 WHEN an org admin or owner accesses a team they are not a member of THEN the system SHALL CONTINUE TO allow access via the org-level fallback mechanism

3.7 WHEN an unauthenticated request is made to a protected endpoint THEN the system SHALL CONTINUE TO return an "unauthorized" error

3.8 WHEN an API key is used for authentication THEN the system SHALL CONTINUE TO resolve the key creator as the user context, enforce IP allowlists, check expiration/revocation, and track usage

3.9 WHEN the `/api/v1/roles` public endpoint is called THEN the system SHALL CONTINUE TO return role definitions and permissions from the database

3.10 WHEN a non-system role is deleted via `DeleteRole` THEN the system SHALL CONTINUE TO only allow deletion of roles where `is_system = FALSE`
