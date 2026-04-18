# RBAC Permission Overhaul Bugfix Design

## Overview

The RBAC enforcement layer (`internal/auth/rbac/rbac.go`) uses hardcoded rank-based integer comparisons to authorize requests, completely ignoring the DB-backed `roles`, `permissions`, and `role_permissions` tables seeded by migration `000024`. This means the admin UI for editing role permissions is non-functional — changes are saved but never enforced. The fix replaces rank-based `RequireOrgRole`/`RequireTeamRole` with permission-based `RequireOrgPermission`/`RequireTeamPermission` that resolve permissions from the database, adds an in-memory permission cache with refresh capability, introduces self-protection rank checks for role mutations, derives API key scopes from the DB permissions table, seeds missing permissions and the viewer team role via a new migration, updates every handler to use specific permission keys, and wires the frontend to load and use actual permissions for UI gating.

## Glossary

- **Bug_Condition (C)**: Any handler call that uses `RequireOrgRole(r, orgID, minRole)` or `RequireTeamRole(r, orgID, teamID, minOrgFallback, minTeamRole)` — these compare hardcoded integer ranks instead of checking permission keys from the `role_permissions` table
- **Property (P)**: Access is granted if and only if the user's role (resolved from DB) has the required permission key in the `role_permissions` join table
- **Preservation**: System admin bypass, non-member denial, org-level fallback for team access, API key authentication flow, unauthenticated request denial, and public `/roles` endpoint behavior must remain unchanged
- **`Checker`**: The struct in `internal/auth/rbac/rbac.go` that performs RBAC enforcement; currently uses `orgRank`/`teamRank` maps
- **`PermissionCache`**: New in-memory map of `roleValue → []permissionKey` loaded from DB on startup, refreshable via `Refresh()` method
- **`RequireOrgPermission`**: New method on `Checker` that checks whether the user's org role has a specific permission key
- **`RequireTeamPermission`**: New method on `Checker` that checks whether the user's team role (or org-level fallback role) has a specific permission key
- **Self-protection**: Rank-based check that prevents users from modifying (promote/demote/remove) peers at the same or higher rank level
- **Scope-to-permission mapping**: API key scopes (e.g., `inbox:create`) map to team permission keys (e.g., `team.inboxes.create`) via the `permissions` table

## Bug Details

### Bug Condition

The bug manifests whenever any handler calls `checkOrgRole` or `checkTeamRole` (which delegate to `Checker.RequireOrgRole` / `Checker.RequireTeamRole`). These methods compare hardcoded integer ranks from `orgRank` and `teamRank` maps instead of resolving the user's actual permissions from the `role_permissions` table. This means:
- Permission edits via the admin UI have zero effect on enforcement
- Custom roles get rank 0 (map miss) and are always denied
- The viewer team role is defined in code but never seeded in the DB
- Several permission keys needed for granular access control don't exist

**Formal Specification:**
```
FUNCTION isBugCondition(request)
  INPUT: request of type HTTPRequest with (userID, orgID, teamID?, action)
  OUTPUT: boolean

  handler := resolveHandler(request)
  RETURN handler.usesRankBasedCheck()
         AND NOT request.user.isSystemAdmin
         AND (
           handler.callsRequireOrgRole(minRole)
           OR handler.callsRequireTeamRole(minOrgFallback, minTeamRole)
         )
END FUNCTION
```

### Examples

- **Custom role denied**: Admin creates "auditor" org role with `org.audit.view` permission → user with "auditor" role calls `GET /orgs/{id}/audit` → `orgRank["auditor"]` returns 0 → 0 < 2 (`OrgAdmin`) → 403 Forbidden (should be allowed)
- **Permission edit ignored**: Admin removes `org.domains.manage` from the "admin" role via UI → admin user calls `POST /orgs/{id}/domains` → `orgRank["admin"]` returns 2 → 2 >= 2 → allowed (should be denied)
- **Viewer blocked from reads**: User with team "viewer" role calls `GET /orgs/{id}/teams/{id}/webhooks` → `teamRank["viewer"]` returns 0 → 0 < 1 (`TeamMember`) → 403 Forbidden (should be allowed for read-only)
- **Org member blocked from analytics**: Org member calls `GET /orgs/{id}/analytics` → `orgRank["member"]` returns 1 → 1 < 2 (`OrgAdmin`) → 403 Forbidden (should be allowed if member has `org.analytics.view`)
- **Peer role change allowed**: Admin A calls `PATCH /orgs/{id}/members/{adminB}` to demote Admin B → no rank comparison on the target → allowed (should be denied because same rank)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- System admins bypass all RBAC checks and receive full access to every endpoint
- Users who are not members of an organization receive "not a member of this organization" errors on org-scoped endpoints
- Users who are not members of a team (and lack sufficient org-level role for fallback) receive "not a member of this team" errors on team-scoped endpoints
- Org owners retain full access to all org-level actions (owner role has all org permissions)
- Team leads retain full access to all team-level actions (lead role has all team permissions)
- Org admins and owners can access teams they are not members of via org-level fallback
- Unauthenticated requests to protected endpoints return "unauthorized"
- API key authentication continues to resolve the key creator as user context, enforce IP allowlists, check expiration/revocation, and track usage
- The public `GET /api/v1/roles` endpoint continues to return role definitions and permissions from the database
- Non-system role deletion (`DeleteRole`) continues to only allow deletion of roles where `is_system = FALSE`

**Scope:**
All inputs that do NOT involve RBAC enforcement (public endpoints, system admin requests, unauthenticated request rejection, API key validation mechanics) should be completely unaffected by this fix. This includes:
- Authentication flow (JWT validation, password checks, session management)
- Email/inbox operations that use ownership checks rather than RBAC
- WebSocket connections
- Health/readiness endpoints
- SMTP server operations

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Hardcoded rank maps in `rbac.go`**: `orgRank` and `teamRank` are `map[string]int` literals that only contain the three system org roles and three system team roles. The `RequireOrgRole` and `RequireTeamRole` methods compare `rank[userRole] >= rank[requiredRole]` — this completely bypasses the `role_permissions` table. Custom roles return 0 from the map (Go zero-value for missing keys) and are always denied.

2. **No permission resolution layer**: The `Checker` struct only has `OrgMembershipRepo` and `TeamMembershipRepo` interfaces — it has no access to the `RoleRepo` or any permission data. There is no code path that reads from `role_permissions` during request authorization.

3. **Missing DB seed data**: Migration `000024` seeds org roles (owner, admin, member) and team roles (lead, member) but does not seed the `viewer` team role despite `rbac.go` defining `TeamViewer = "viewer"`. Additionally, many granular permission keys needed for fine-grained access control (e.g., `org.analytics.view`, `team.view`, `team.webhooks.view`) are not present in the `permissions` table.

4. **Hardcoded API key scopes**: `apikey_service.go` defines `validScopes` as a hardcoded `map[string]bool` with 9 entries. These scopes use a `resource:action` format (e.g., `inbox:create`) that doesn't correspond to the `permissions` table's `scope.resource.action` format (e.g., `team.inboxes.create`). The `HasScope` function in `middleware.go` does a direct string match against `APIKeyScopes` without any mapping to permission keys.

5. **No self-protection on role mutations**: `OrgHandler.ChangeRole` requires `OrgOwner` rank but doesn't compare the actor's rank against the target's rank. `TeamHandler.ChangeRole` requires `TeamLead` rank but similarly doesn't prevent leads from demoting other leads. The `rank` column on the `roles` table exists but is never used for this purpose.

6. **Over-restricted analytics endpoints**: `OrgAnalytics`, `OrgEmailsPerDay`, and `OrgInsights` all call `checkOrgRole(w, r, orgID, rbac.OrgAdmin)`, requiring admin rank. This blocks org members from viewing analytics even though it's a read-only operation that should be grantable via permissions.

## Correctness Properties

Property 1: Bug Condition - Permission-Based Access Control

_For any_ authenticated request where the handler requires a specific permission key, the fixed `RequireOrgPermission` / `RequireTeamPermission` SHALL grant access if and only if the user's role (resolved from the `role_permissions` table via the permission cache) contains the required permission key. Custom roles with the correct permissions SHALL be granted access. Roles without the required permission SHALL be denied with 403.

**Validates: Requirements 2.1, 2.2, 2.3, 2.8**

Property 2: Preservation - System Admin and Membership Checks

_For any_ request where the user is a system admin, the fixed RBAC checker SHALL bypass all permission checks and grant access (same as before). _For any_ request where the user is not a member of the target org or team, the fixed RBAC checker SHALL deny access with the same error messages as the original code, preserving membership validation behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

Property 3: Bug Condition - Self-Protection on Role Changes

_For any_ role change operation where the actor's role rank is less than or equal to the target user's role rank, the fixed code SHALL return 403 Forbidden, preventing users from modifying peers at the same or higher rank level.

**Validates: Requirements 2.5**

Property 4: Bug Condition - API Key Scopes from DB Permissions

_For any_ API key scope validation, the set of valid scopes SHALL be derived from team-scoped permission keys in the `permissions` table, and the `HasScope` check SHALL correctly map API key scopes to permission keys, accepting only scopes that correspond to existing team permissions.

**Validates: Requirements 2.7**

Property 5: Preservation - API Key Authentication Flow

_For any_ API key authentication, the fixed code SHALL continue to resolve the key creator as user context, enforce IP allowlists, check expiration and revocation status, and track usage — producing the same authentication result as the original code for all API key inputs.

**Validates: Requirements 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `internal/auth/rbac/rbac.go`

**Changes**:
1. **Add `PermissionCache`**: New struct that holds a `map[string][]string` (roleValue → permission keys). Loaded from DB on startup via `RoleRepo.ListRoles`. Exposes `Refresh()` method to reload after admin UI changes. Thread-safe with `sync.RWMutex`.
2. **Add `RolePermissionRepo` interface**: Minimal interface with `ListRoles(ctx, scope) ([]Role, error)` and `GetRoleByValue(ctx, scope, value) (*Role, error)` so the checker can resolve permissions.
3. **Add `RequireOrgPermission(r, orgID, permissionKey) error`**: Resolves user's org membership, looks up role's permissions from cache, checks if `permissionKey` is present. System admin bypass preserved.
4. **Add `RequireTeamPermission(r, orgID, teamID, permissionKey) error`**: Resolves user's team membership (with org-level fallback). For org fallback, maps the team permission key to its org equivalent or checks if the org role has sufficient rank. For team role, checks permission from cache.
5. **Add `RequireRankAbove(r, orgID, targetUserID) error`**: For self-protection — resolves both actor's and target's org role ranks, denies if actor rank <= target rank.
6. **Add `RequireTeamRankAbove(r, teamID, targetUserID) error`**: Same for team-level role changes.
7. **Keep `orgRank`/`teamRank` maps**: Still used for self-protection rank comparisons and org-level fallback logic. The `RequireOrgRole`/`RequireTeamRole` methods can remain for backward compatibility but handlers will migrate to the permission-based methods.

**File**: `internal/handler/rbac.go`

**Changes**:
1. **Add `checkOrgPermission(w, r, orgID, permissionKey) bool`**: Wrapper around `RBAC.RequireOrgPermission`, writes 403 on failure.
2. **Add `checkTeamPermission(w, r, orgID, teamID, permissionKey) bool`**: Wrapper around `RBAC.RequireTeamPermission`, writes 403 on failure.
3. **Keep `checkOrgRole`/`checkTeamRole`**: Deprecated but kept for any edge cases during migration.

**File**: `internal/handler/*.go` (all handlers)

**Changes**: Replace every `checkOrgRole(w, r, orgID, rbac.OrgAdmin)` call with `checkOrgPermission(w, r, orgID, "org.domains.manage")` (or the appropriate permission key). Replace every `checkTeamRole(w, r, orgID, teamID, rbac.OrgAdmin, rbac.TeamLead)` call with `checkTeamPermission(w, r, orgID, teamID, "team.webhooks.manage")` (or the appropriate permission key). Specific mappings:

| Handler | Current Check | New Permission Key |
|---------|--------------|-------------------|
| `OrgHandler.GetOrg` | `OrgMember` | `org.view` |
| `OrgHandler.UpdateOrg` | `OrgAdmin` | `org.settings.manage` |
| `OrgHandler.DeleteOrg` | `OrgOwner` | `org.delete` |
| `OrgHandler.GetSettings` | `OrgMember` | `org.settings.view` |
| `OrgHandler.UpdateSettings` | `OrgAdmin` | `org.settings.manage` |
| `OrgHandler.InviteMember` | `OrgAdmin` | `org.members.invite` |
| `OrgHandler.DirectAddMember` | `OrgAdmin` | `org.members.add` |
| `OrgHandler.ListMembers` | `OrgMember` | `org.members.view` |
| `OrgHandler.ChangeRole` | `OrgOwner` | `org.members.role` + self-protection |
| `OrgHandler.DeactivateUser` | `OrgAdmin` | `org.members.remove` |
| `OrgHandler.ListPendingInvites` | `OrgAdmin` | `org.members.invite` |
| `OrgHandler.RevokeInvite` | `OrgAdmin` | `org.members.invite` |
| `OrgHandler.SearchMembers` | `OrgMember` | `org.members.view` |
| `DomainHandler.CreateDomain` | `OrgAdmin` | `org.domains.manage` |
| `DomainHandler.ListDomains` | `OrgMember` | `org.domains.view` |
| `DomainHandler.GetDomain` | `OrgMember` | `org.domains.view` |
| `DomainHandler.UpdateDomain` | `OrgAdmin` | `org.domains.manage` |
| `DomainHandler.DeleteDomain` | `OrgAdmin` | `org.domains.manage` |
| `DomainHandler.VerifyDomain` | `OrgAdmin` | `org.domains.manage` |
| `DomainHandler.GetDomainImpact` | `OrgAdmin` | `org.domains.manage` |
| `DomainHandler.GetVerificationHistory` | `OrgAdmin` | `org.domains.manage` |
| `DomainHandler.BulkVerify` | `OrgAdmin` | `org.domains.manage` |
| `DomainHandler.BulkDelete` | `OrgAdmin` | `org.domains.manage` |
| `TeamHandler.CreateTeam` | `OrgAdmin` | `org.teams.create` |
| `TeamHandler.ListTeams` | `OrgMember` | `org.view` |
| `TeamHandler.GetTeam` | `OrgMember/TeamViewer` | `team.view` |
| `TeamHandler.UpdateTeam` | `OrgAdmin/TeamLead` | `team.settings.manage` |
| `TeamHandler.DeleteTeam` | `OrgAdmin` | `org.teams.delete` |
| `TeamHandler.ArchiveTeam` | `OrgAdmin` | `org.teams.manage` |
| `TeamHandler.RestoreTeam` | `OrgAdmin` | `org.teams.manage` |
| `TeamHandler.GetImpact` | `OrgAdmin` | `org.teams.manage` |
| `TeamHandler.AddMember` | `OrgAdmin/TeamLead` | `team.members.manage` |
| `TeamHandler.ListMembers` | `OrgMember/TeamViewer` | `team.members.view` |
| `TeamHandler.ChangeRole` | `OrgAdmin/TeamLead` | `team.members.role` + self-protection |
| `TeamHandler.RemoveMember` | `OrgAdmin/TeamLead` | `team.members.manage` |
| `TeamHandler.LeaveTeam` | `OrgMember/TeamViewer` | `team.view` |
| `TeamHandler.BulkAddMembers` | `OrgAdmin/TeamLead` | `team.members.manage` |
| `TeamHandler.BulkRemoveMembers` | `OrgAdmin/TeamLead` | `team.members.manage` |
| `DomainAssignmentHandler.AssignDomain` | `OrgAdmin` | `team.domains.manage` |
| `DomainAssignmentHandler.ListAssignments` | `OrgMember/TeamMember` | `team.domains.view` |
| `DomainAssignmentHandler.UpdateAssignment` | `OrgAdmin/TeamLead` | `team.domains.manage` |
| `DomainAssignmentHandler.Unassign` | `OrgAdmin` | `team.domains.manage` |
| `InboxHandler.ListInboxes` | `OrgMember/TeamMember` | `team.inboxes.view` |
| `WebhookHandler.Create` | `OrgAdmin/TeamLead` | `team.webhooks.manage` |
| `WebhookHandler.List` | `OrgMember/TeamMember` | `team.webhooks.view` |
| `WebhookHandler.Update` | `OrgAdmin/TeamLead` | `team.webhooks.manage` |
| `WebhookHandler.Delete` | `OrgAdmin/TeamLead` | `team.webhooks.manage` |
| `WebhookHandler.ListDeliveryLogs` | `OrgMember/TeamMember` | `team.webhooks.view` |
| `APIKeyHandler.Create` | `OrgAdmin/TeamLead` | `team.apikeys.manage` |
| `APIKeyHandler.List` | `OrgMember/TeamMember` | `team.apikeys.view` |
| `APIKeyHandler.Get` | `OrgMember/TeamMember` | `team.apikeys.view` |
| `APIKeyHandler.Update` | `OrgAdmin/TeamLead` | `team.apikeys.manage` |
| `APIKeyHandler.Revoke` | `OrgAdmin/TeamLead` | `team.apikeys.manage` |
| `APIKeyHandler.Rotate` | `OrgAdmin/TeamLead` | `team.apikeys.manage` |
| `APIKeyHandler.BulkRevoke` | `OrgAdmin/TeamLead` | `team.apikeys.manage` |
| `AnalyticsHandler.OrgAnalytics` | `OrgAdmin` | `org.analytics.view` |
| `AnalyticsHandler.OrgEmailsPerDay` | `OrgAdmin` | `org.analytics.view` |
| `AnalyticsHandler.OrgInsights` | `OrgAdmin` | `org.analytics.view` |
| `AnalyticsHandler.TeamAnalytics` | `OrgMember/TeamMember` | `team.analytics.view` |
| `AnalyticsHandler.TeamEmailsPerDay` | `OrgMember/TeamMember` | `team.analytics.view` |
| `AuditHandler.List` | `OrgAdmin` | `org.audit.view` |
| `AuditHandler.Export` | `OrgAdmin` | `org.audit.export` |

**File**: `internal/service/apikey_service.go`

**Changes**:
1. **Replace `validScopes` map**: Instead of a hardcoded map, load valid scopes from team-scoped permissions in the DB. Add a `PermissionRepo` dependency to `APIKeyService`.
2. **Scope format**: Use the permission key format directly (e.g., `team.inboxes.create`) as the scope values, replacing the old `resource:action` format.
3. **Update `HasScope` in `middleware.go`**: The scope check already does a direct string match — since scopes now ARE permission keys, this continues to work.

**File**: `migrations/000037_rbac_permission_overhaul.up.sql`

**Changes**:
1. **Add missing permissions**: Insert all granular permission keys listed in requirement 2.10 (`org.analytics.view`, `org.settings.view`, `org.members.view`, `org.members.add`, `org.teams.create`, `org.teams.delete`, `org.audit.export`, `org.domains.view`, `team.view`, `team.members.view`, `team.members.role`, `team.domains.view`, `team.webhooks.view`, `team.apikeys.view`, `team.inboxes.view`, `team.inboxes.create`, `team.analytics.view`)
2. **Add viewer team role**: Insert `('team', 'viewer', 'Viewer', 'Read-only access to team resources', 0, TRUE)` into `roles`
3. **Assign viewer permissions**: Assign read-only team permissions to the viewer role (`team.view`, `team.members.view`, `team.domains.view`, `team.webhooks.view`, `team.apikeys.view`, `team.inboxes.view`, `team.emails.view`, `team.analytics.view`)
4. **Update existing role-permission assignments**: Add new permissions to existing roles (e.g., `org.analytics.view` to admin and owner, `org.settings.view` to member, etc.)
5. **Add `org.analytics.view` to member role**: So org members can view analytics by default

**File**: `internal/handler/org.go` — `ChangeRole` method

**Changes**: Add self-protection check before allowing role change. Call `RBAC.RequireRankAbove(r, orgID, targetUserID)` to ensure the actor's rank is strictly higher than the target's rank.

**File**: `internal/handler/team.go` — `ChangeRole` method

**Changes**: Add self-protection check. Call `RBAC.RequireTeamRankAbove(r, teamID, targetUserID)` to ensure the actor's team rank is strictly higher than the target's team rank.

**File**: `cmd/api/main.go`

**Changes**:
1. **Initialize permission cache**: After creating `RoleRepo`, call `rbac.NewChecker(orgRepo, teamRepo, roleRepo)` (updated constructor) which loads the permission cache on startup.
2. **Wire cache refresh**: After the admin role update endpoint (`PATCH /admin/roles/{roleId}`) successfully updates permissions, call `RBAC.RefreshCache()` to reload the permission cache.

**File**: `web/src/stores/org-store.ts`

**Changes**: Add `permissions: string[]` to the store state. When `fetchRole` resolves the user's role, also resolve the role's permissions from the `/roles` endpoint data and store them.

**File**: `web/src/components/settings/unified-users-tab.tsx` (and other frontend components)

**Changes**: Replace `currentRole === "owner" || currentRole === "admin"` checks with permission-based checks like `permissions.includes("org.members.manage")`. Use the permissions array from the org store to gate UI elements.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write unit tests that construct a `Checker` with mock repos returning specific role memberships, then call `RequireOrgRole`/`RequireTeamRole` with scenarios where the rank-based check gives the wrong answer. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Custom role denied**: Create a mock where user has org role "auditor" (not in `orgRank` map) → call `RequireOrgRole(r, orgID, "member")` → expect success but get failure because `orgRank["auditor"]` returns 0 (will fail on unfixed code)
2. **Permission edit ignored**: Mock user with "admin" role, but admin role has had `org.domains.manage` removed → call the equivalent permission check → expect failure but rank check passes because rank 2 >= 2 (will fail on unfixed code — no permission check exists)
3. **Viewer blocked from reads**: Mock user with team role "viewer" → call `RequireTeamRole(r, orgID, teamID, "member", "member")` → expect success for read-only but get failure because `teamRank["viewer"]` (0) < `teamRank["member"]` (1) (will fail on unfixed code)
4. **Peer role change allowed**: Mock two users both with "admin" org role → attempt role change → expect denial but no self-protection check exists (will fail on unfixed code)

**Expected Counterexamples**:
- Custom roles always get rank 0 and are denied for any non-trivial permission
- Permission table changes have no effect on authorization decisions
- Viewer role is denied from all team endpoints requiring TeamMember minimum

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := RequireOrgPermission_fixed(input) OR RequireTeamPermission_fixed(input)
  ASSERT expectedBehavior(result)
    -- granted iff user's role has the required permission key in cache
    -- denied iff user's role lacks the required permission key
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
    -- system admin bypass: both return nil
    -- non-member: both return ErrNotOrgMember / ErrNotTeamMember
    -- unauthenticated: both return ErrUnauthorized
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many random (user, role, membership, permission) combinations automatically
- It catches edge cases like empty permission sets, nil user contexts, and unusual role combinations
- It provides strong guarantees that system admin bypass and membership checks are unchanged

**Test Plan**: Observe behavior on UNFIXED code first for system admin requests, non-member requests, and unauthenticated requests, then write property-based tests capturing that behavior.

**Test Cases**:
1. **System admin preservation**: Generate random org/team IDs and permission keys → verify system admin always gets access on both old and new code
2. **Non-member preservation**: Generate random user IDs not in any org → verify both old and new code return ErrNotOrgMember
3. **Unauthenticated preservation**: Generate requests with nil user context → verify both old and new code return ErrUnauthorized
4. **Owner full access preservation**: Generate random permission keys → verify owner role always has access on both old and new code

### Unit Tests

- Test `PermissionCache` loading from mock role data and `Refresh()` behavior
- Test `RequireOrgPermission` with various role/permission combinations
- Test `RequireTeamPermission` with team role, org fallback, and mixed scenarios
- Test `RequireRankAbove` / `RequireTeamRankAbove` for self-protection
- Test API key scope validation against DB-derived scopes
- Test that custom roles with correct permissions are granted access
- Test that viewer role with read permissions can access read-only endpoints
- Test edge cases: empty permission set, role with no permissions, nil cache

### Property-Based Tests

- Generate random `(userRole, requiredPermission, rolePermissions)` tuples → verify access granted iff `requiredPermission ∈ rolePermissions`
- Generate random `(actorRank, targetRank)` pairs → verify self-protection denies when `actorRank <= targetRank`
- Generate random system admin requests → verify always granted regardless of permission key
- Generate random non-member requests → verify always denied with correct error
- Generate random API key scopes → verify only DB-derived scopes are accepted

### Integration Tests

- Test full request flow: create custom role → assign permissions → authenticate as user with that role → verify access to permitted endpoints and denial for non-permitted endpoints
- Test cache refresh: update role permissions via admin API → verify subsequent requests reflect the change
- Test migration: run migration 000037 → verify viewer role exists with correct permissions, all new permission keys exist, existing role assignments are updated
- Test API key flow: create API key with DB-derived scopes → use key to access endpoints → verify scope enforcement matches permission keys
- Test frontend: load user permissions → verify UI elements are shown/hidden based on actual permissions rather than role name
