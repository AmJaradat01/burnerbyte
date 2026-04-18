# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Rank-Based RBAC Ignores DB Permissions
  - **IMPORTANT**: Write this property-based test BEFORE implementing the fix
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the rank-based checker ignores DB permissions
  - **Scoped PBT Approach**: Scope the property to concrete failing cases that demonstrate the bug
  - Create test file `internal/auth/rbac/rbac_test.go` using `pgregory.net/rapid`
  - Define mock implementations of `OrgMembershipRepo` and `TeamMembershipRepo` that return configurable roles
  - **Test Case 1 — Custom role denied**: Generate random permission keys. Mock a user with org role "auditor" (not in `orgRank` map). Call `RequireOrgRole(r, orgID, "member")`. Assert that the rank-based checker returns `ErrInsufficientOrg` because `orgRank["auditor"]` returns 0 (Go zero-value for missing map key), confirming custom roles are always denied
  - **Test Case 2 — Viewer blocked from reads**: Mock a user with team role "viewer". Call `RequireTeamRole(r, orgID, teamID, "member", "member")`. Assert that the rank-based checker returns `ErrInsufficientTeam` because `teamRank["viewer"]` (0) < `teamRank["member"]` (1), confirming viewers are blocked from all team endpoints requiring TeamMember minimum
  - **Test Case 3 — Peer role change allowed**: Mock two users both with "admin" org role (rank 2). Verify there is no self-protection check — the current `RequireOrgRole(r, orgID, "owner")` only checks the actor's rank, not the target's rank. Confirm that `ChangeRole` allows admin-on-admin modifications
  - **Test Case 4 — Permission edit has no effect**: Verify that `RequireOrgRole` and `RequireTeamRole` never call any permission-resolution method — they only compare hardcoded `orgRank`/`teamRank` integers. This confirms that admin UI permission edits have zero effect on enforcement
  - Run test on UNFIXED code — expect FAILURE (this confirms the bug exists)
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists)
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - System Admin Bypass and Membership Checks
  - **IMPORTANT**: Follow observation-first methodology
  - **IMPORTANT**: Write these tests BEFORE implementing the fix
  - Create preservation tests in `internal/auth/rbac/rbac_preservation_test.go` using `pgregory.net/rapid`
  - Define the same mock repos as task 1 for consistency
  - **Observe on UNFIXED code first**, then write property-based tests capturing observed behavior:
  - **Sub-property 2a — System admin bypass**: For all randomly generated (orgID, minRole) pairs, when `UserContext.IsSystemAdmin = true`, `RequireOrgRole` returns nil. For all randomly generated (orgID, teamID, minOrgFallback, minTeamRole) tuples, when `UserContext.IsSystemAdmin = true`, `RequireTeamRole` returns nil. Observe this on unfixed code, then assert it as a property
  - **Sub-property 2b — Unauthenticated denial**: For all randomly generated org/team IDs and role strings, when the request has no `UserContext` (nil), both `RequireOrgRole` and `RequireTeamRole` return `ErrUnauthorized`. Observe on unfixed code, then assert
  - **Sub-property 2c — Non-member denial**: For all randomly generated (userID, orgID) pairs where `GetMembership` returns an error, `RequireOrgRole` returns `ErrNotOrgMember`. For team checks where both org fallback and team membership fail, `RequireTeamRole` returns `ErrNotTeamMember`. Observe on unfixed code, then assert
  - **Sub-property 2d — Org-level fallback for teams**: For all randomly generated scenarios where the user is NOT a team member but IS an org admin/owner (rank >= minOrgFallback rank), `RequireTeamRole` returns nil (access granted via org fallback). Observe on unfixed code, then assert
  - **Sub-property 2e — Owner full access**: For all randomly generated minRole values from the set {owner, admin, member}, when the user has org role "owner" (rank 3), `RequireOrgRole` returns nil. Observe on unfixed code, then assert
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Database migration for missing permissions and viewer role

  - [x] 3.1 Create migration `migrations/000037_rbac_permission_overhaul.up.sql`
    - Add missing org-scoped permissions: `org.analytics.view`, `org.settings.view`, `org.members.view`, `org.members.add`, `org.teams.create`, `org.teams.delete`, `org.audit.export`, `org.domains.view`, `org.teams.manage`
    - Add missing team-scoped permissions: `team.view`, `team.members.view`, `team.members.role`, `team.domains.view`, `team.webhooks.view`, `team.apikeys.view`, `team.inboxes.view`, `team.inboxes.create`, `team.analytics.view`
    - Add `viewer` team role: `INSERT INTO roles (scope, value, label, description, rank, is_system) VALUES ('team', 'viewer', 'Viewer', 'Read-only access to team resources', 0, TRUE)`
    - Assign all new org permissions to the `owner` role (owner gets everything)
    - Assign appropriate new org permissions to the `admin` role (all except `org.delete`)
    - Assign read-only org permissions to the `member` role: `org.view`, `org.settings.view`, `org.members.view`, `org.domains.view`, `org.analytics.view`
    - Assign all new team view permissions to the `lead` role
    - Assign all new team view permissions to the `member` role plus `team.inboxes.create`
    - Assign read-only team permissions to the `viewer` role: `team.view`, `team.members.view`, `team.domains.view`, `team.webhooks.view`, `team.apikeys.view`, `team.inboxes.view`, `team.emails.view`, `team.analytics.view`
    - Use idempotent `INSERT ... ON CONFLICT DO NOTHING` for safety
    - _Bug_Condition: isBugCondition(request) — missing permission keys and viewer role cause enforcement failures_
    - _Expected_Behavior: All granular permission keys exist in the permissions table; viewer role exists with read-only permissions_
    - _Preservation: Existing role-permission assignments for owner, admin, member, lead, member are unchanged_
    - _Requirements: 2.9, 2.10_

  - [x] 3.2 Create corresponding down migration `migrations/000037_rbac_permission_overhaul.down.sql`
    - Remove the viewer role and its permission assignments
    - Remove newly added permission keys
    - Preserve original migration 000024 state
    - _Requirements: 2.9, 2.10_

- [x] 4. Implement permission cache and permission-based checker in `internal/auth/rbac/rbac.go`

  - [x] 4.1 Add `PermissionCache` struct with `sync.RWMutex`
    - Add `PermissionCache` struct holding `map[string][]string` (roleValue → permission keys) and `map[string]int` (roleValue → rank)
    - Add `RolePermissionRepo` interface with `ListRoles(ctx, scope) ([]Role, error)` method
    - Implement `NewPermissionCache(repo RolePermissionRepo) (*PermissionCache, error)` that loads all org and team roles+permissions from DB on startup
    - Implement `Refresh(ctx context.Context) error` method to reload cache (called after admin UI updates)
    - Implement `HasPermission(roleValue, permissionKey string) bool` that checks the cache
    - Implement `GetRank(roleValue string) int` that returns the role's rank from cache
    - Thread-safe reads with `RLock`/`RUnlock`, writes with `Lock`/`Unlock`
    - _Bug_Condition: No permission resolution layer exists — Checker has no access to RoleRepo or permission data_
    - _Expected_Behavior: Permission cache resolves role permissions from DB, supports refresh_
    - _Preservation: Does not modify existing RequireOrgRole/RequireTeamRole methods_
    - _Requirements: 2.1, 2.2, 2.3, 2.8_

  - [x] 4.2 Add `RequireOrgPermission` method to `Checker`
    - Update `Checker` struct to accept `*PermissionCache` as a new field
    - Update `NewChecker` constructor to accept the cache parameter
    - Implement `RequireOrgPermission(r *http.Request, orgID uuid.UUID, permissionKey string) error`
    - System admin bypass: if `uc.IsSystemAdmin` return nil
    - Resolve user's org membership via `c.org.GetMembership`; return `ErrNotOrgMember` if not found
    - Check `c.cache.HasPermission(membership.Role, permissionKey)`; return `ErrInsufficientOrg` if false
    - _Bug_Condition: RequireOrgRole compares hardcoded ranks instead of checking permission keys_
    - _Expected_Behavior: Access granted iff user's role has the required permission key in cache_
    - _Preservation: System admin bypass, non-member denial unchanged_
    - _Requirements: 2.1, 2.3, 2.8_

  - [x] 4.3 Add `RequireTeamPermission` method to `Checker`
    - Implement `RequireTeamPermission(r *http.Request, orgID, teamID uuid.UUID, permissionKey string) error`
    - System admin bypass: if `uc.IsSystemAdmin` return nil
    - Org-level fallback: resolve org membership, check if org role has the team permission key (org admins/owners have implicit team access) OR if org role rank >= admin rank (rank 2), grant access
    - Team-level check: resolve team membership, check `c.cache.HasPermission(teamRole, permissionKey)`
    - Return `ErrNotTeamMember` if neither org fallback nor team membership succeeds
    - Return `ErrInsufficientTeam` if team member but lacks permission
    - _Bug_Condition: RequireTeamRole compares hardcoded ranks instead of checking permission keys_
    - _Expected_Behavior: Access granted iff user's team role (or org fallback role) has the required permission key_
    - _Preservation: Org-level fallback mechanism unchanged; system admin bypass unchanged_
    - _Requirements: 2.2, 2.3, 2.4, 2.8_

  - [x] 4.4 Add `RequireRankAbove` and `RequireTeamRankAbove` methods for self-protection
    - Implement `RequireRankAbove(r *http.Request, orgID, targetUserID uuid.UUID) error`
    - Resolve actor's org role rank and target's org role rank from cache
    - Return `ErrInsufficientOrg` with "cannot modify users at the same or higher rank" if actor rank <= target rank
    - Implement `RequireTeamRankAbove(r *http.Request, teamID, targetUserID uuid.UUID) error`
    - Same logic for team roles
    - System admin bypass on both methods
    - _Bug_Condition: No self-protection check exists — users can modify peers at same/higher rank_
    - _Expected_Behavior: Role changes denied when actor rank <= target rank_
    - _Preservation: System admin bypass unchanged_
    - _Requirements: 2.5_

- [x] 5. Update handler wrappers in `internal/handler/rbac.go`

  - [x] 5.1 Add `checkOrgPermission` and `checkTeamPermission` wrapper functions
    - Add `checkOrgPermission(w http.ResponseWriter, r *http.Request, orgID uuid.UUID, permissionKey string) bool` — calls `RBAC.RequireOrgPermission`, writes 403 on failure, returns true if check failed
    - Add `checkTeamPermission(w http.ResponseWriter, r *http.Request, orgID, teamID uuid.UUID, permissionKey string) bool` — calls `RBAC.RequireTeamPermission`, writes 403 on failure, returns true if check failed
    - Add `checkOrgRankAbove(w http.ResponseWriter, r *http.Request, orgID, targetUserID uuid.UUID) bool` — calls `RBAC.RequireRankAbove`, writes 403 on failure
    - Add `checkTeamRankAbove(w http.ResponseWriter, r *http.Request, teamID, targetUserID uuid.UUID) bool` — calls `RBAC.RequireTeamRankAbove`, writes 403 on failure
    - Keep existing `checkOrgRole` and `checkTeamRole` for backward compatibility during migration
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 6. Migrate all handlers to permission-based checks

  - [x] 6.1 Update `internal/handler/org.go` — replace all `checkOrgRole` calls with `checkOrgPermission`
    - `GetOrg`: `checkOrgPermission(w, r, orgID, "org.view")`
    - `UpdateOrg`: `checkOrgPermission(w, r, orgID, "org.settings.manage")`
    - `DeleteOrg`: `checkOrgPermission(w, r, orgID, "org.delete")`
    - `GetSettings`: `checkOrgPermission(w, r, orgID, "org.settings.view")`
    - `UpdateSettings`: `checkOrgPermission(w, r, orgID, "org.settings.manage")`
    - `InviteMember`: `checkOrgPermission(w, r, orgID, "org.members.invite")`
    - `DirectAddMember`: `checkOrgPermission(w, r, orgID, "org.members.add")`
    - `ListMembers`: `checkOrgPermission(w, r, orgID, "org.members.view")`
    - `ChangeRole`: `checkOrgPermission(w, r, orgID, "org.members.role")` + add `checkOrgRankAbove(w, r, orgID, targetUserID)` for self-protection
    - `DeactivateUser`: `checkOrgPermission(w, r, orgID, "org.members.remove")`
    - `ListPendingInvites`: `checkOrgPermission(w, r, orgID, "org.members.invite")`
    - `RevokeInvite`: `checkOrgPermission(w, r, orgID, "org.members.invite")`
    - `SearchMembers`: `checkOrgPermission(w, r, orgID, "org.members.view")`
    - _Bug_Condition: All these handlers use rank-based RequireOrgRole_
    - _Expected_Behavior: Each handler checks the specific permission key from the role_permissions table_
    - _Preservation: System admin bypass, non-member denial, owner full access unchanged_
    - _Requirements: 2.1, 2.5, 2.6_

  - [x] 6.2 Update `internal/handler/team.go` — replace all `checkOrgRole`/`checkTeamRole` calls with permission-based checks
    - `CreateTeam`: `checkOrgPermission(w, r, orgID, "org.teams.create")`
    - `ListTeams`: `checkOrgPermission(w, r, orgID, "org.view")` (keep admin/member filtering logic)
    - `GetTeam`: `checkTeamPermission(w, r, orgID, teamID, "team.view")`
    - `UpdateTeam`: `checkTeamPermission(w, r, orgID, teamID, "team.settings.manage")`
    - `DeleteTeam`: `checkOrgPermission(w, r, orgID, "org.teams.delete")`
    - `ArchiveTeam`: `checkOrgPermission(w, r, orgID, "org.teams.manage")`
    - `RestoreTeam`: `checkOrgPermission(w, r, orgID, "org.teams.manage")`
    - `GetImpact`: `checkOrgPermission(w, r, orgID, "org.teams.manage")`
    - `AddMember`: `checkTeamPermission(w, r, orgID, teamID, "team.members.manage")`
    - `ListMembers`: `checkTeamPermission(w, r, orgID, teamID, "team.members.view")`
    - `ChangeRole`: `checkTeamPermission(w, r, orgID, teamID, "team.members.role")` + add `checkTeamRankAbove(w, r, teamID, targetUserID)` for self-protection
    - `RemoveMember`: `checkTeamPermission(w, r, orgID, teamID, "team.members.manage")`
    - `LeaveTeam`: `checkTeamPermission(w, r, orgID, teamID, "team.view")`
    - `BulkAddMembers`: `checkTeamPermission(w, r, orgID, teamID, "team.members.manage")`
    - `BulkRemoveMembers`: `checkTeamPermission(w, r, orgID, teamID, "team.members.manage")`
    - Also update `ListTeams` admin detection logic to use permission cache rank instead of hardcoded role string comparison
    - _Bug_Condition: All these handlers use rank-based RequireOrgRole/RequireTeamRole_
    - _Expected_Behavior: Each handler checks the specific permission key_
    - _Preservation: Org-level fallback for team access unchanged_
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [x] 6.3 Update `internal/handler/domain.go` and `internal/handler/domain_assignment.go`
    - Domain handlers: replace `checkOrgRole(w, r, orgID, rbac.OrgAdmin)` with `checkOrgPermission(w, r, orgID, "org.domains.manage")` for write operations
    - Domain handlers: replace `checkOrgRole(w, r, orgID, rbac.OrgMember)` with `checkOrgPermission(w, r, orgID, "org.domains.view")` for read operations
    - Domain assignment handlers: replace `checkTeamRole` calls with `checkTeamPermission` using `team.domains.manage` for writes and `team.domains.view` for reads
    - _Requirements: 2.1, 2.2_

  - [x] 6.4 Update `internal/handler/webhook.go`
    - Replace `checkTeamRole` calls with `checkTeamPermission` using `team.webhooks.manage` for create/update/delete and `team.webhooks.view` for list/delivery-logs
    - _Requirements: 2.2, 2.4_

  - [x] 6.5 Update `internal/handler/apikey.go`
    - Replace `checkTeamRole` calls with `checkTeamPermission` using `team.apikeys.manage` for create/update/revoke/rotate/bulk-revoke and `team.apikeys.view` for list/get
    - _Requirements: 2.2, 2.4_

  - [x] 6.6 Update `internal/handler/analytics.go`
    - `OrgAnalytics`: `checkOrgPermission(w, r, orgID, "org.analytics.view")` (was `rbac.OrgAdmin`)
    - `OrgEmailsPerDay`: `checkOrgPermission(w, r, orgID, "org.analytics.view")`
    - `OrgInsights`: `checkOrgPermission(w, r, orgID, "org.analytics.view")`
    - `TeamAnalytics`: `checkTeamPermission(w, r, orgID, teamID, "team.analytics.view")`
    - `TeamEmailsPerDay`: `checkTeamPermission(w, r, orgID, teamID, "team.analytics.view")`
    - _Bug_Condition: Org analytics requires OrgAdmin rank, blocking members with org.analytics.view permission_
    - _Expected_Behavior: Org members with org.analytics.view permission can access analytics_
    - _Requirements: 2.6_

  - [x] 6.7 Update `internal/handler/audit.go`
    - `List`: `checkOrgPermission(w, r, orgID, "org.audit.view")`
    - `Export`: `checkOrgPermission(w, r, orgID, "org.audit.export")`
    - _Requirements: 2.1_

  - [x] 6.8 Update `internal/handler/inbox.go`
    - Replace `checkTeamRole` calls with `checkTeamPermission` using `team.inboxes.view` for list and `team.inboxes.create`/`team.inboxes.manage` for create/manage operations
    - _Requirements: 2.2, 2.4_

- [x] 7. Update API key scope validation to use DB permissions

  - [x] 7.1 Update `internal/service/apikey_service.go`
    - Add `PermissionRepo` interface dependency (or accept a `ValidScopesFunc func() []string`)
    - Replace hardcoded `validScopes` map with a function that loads team-scoped permission keys from the DB
    - Change scope format from `resource:action` (e.g., `inbox:create`) to permission key format (e.g., `team.inboxes.create`)
    - Update `Generate` and `Update` methods to validate scopes against DB-derived set
    - _Bug_Condition: validScopes is a hardcoded map with 9 entries using resource:action format_
    - _Expected_Behavior: Valid scopes derived from team-scoped permissions in the permissions table_
    - _Preservation: Scope validation still rejects unknown scopes; key generation flow unchanged_
    - _Requirements: 2.7_

  - [x] 7.2 Update `internal/auth/middleware.go` `HasScope` function
    - The `HasScope` function does direct string matching on `APIKeyScopes` — since scopes now ARE permission keys (e.g., `team.inboxes.create`), the matching logic continues to work without changes
    - Verify that all handler `HasScope` calls use the new permission key format
    - Update any handler `HasScope` calls from old format (e.g., `inbox:read`) to new format (e.g., `team.inboxes.view`)
    - _Requirements: 2.7_

- [x] 8. Wire permission cache in application startup

  - [x] 8.1 Update `cmd/api/main.go`
    - After creating `RoleRepo`, create `PermissionCache` by calling `rbac.NewPermissionCache(roleRepo)`
    - Update `rbac.NewChecker(orgRepo, teamRepo, cache)` call to pass the cache
    - Wire cache refresh: after the admin role update endpoint (`SetRolePermissions`) succeeds, call `cache.Refresh(ctx)` to reload permissions
    - Add the cache refresh call in the admin handler's `UpdateRolePermissions` endpoint
    - _Requirements: 2.3_

  - [x] 8.2 Update `internal/handler/admin.go` to refresh cache after role permission updates
    - After `SetRolePermissions` succeeds, call `RBAC.RefreshCache()` (add a `RefreshCache` convenience method on `Checker` that delegates to `cache.Refresh`)
    - _Requirements: 2.3_

- [x] 9. Frontend permission-based UI gating

  - [x] 9.1 Update `web/src/stores/org-store.ts` to include permissions
    - Add `permissions: string[]` to the store state
    - Update `fetchRole` to also resolve the role's permissions from the `/roles` endpoint data
    - After fetching the user's role, fetch roles list from `/api/v1/roles?scope=org`, find the matching role, and store its permissions array
    - Add `hasPermission(key: string): boolean` helper method
    - _Requirements: 2.1, 2.3_

  - [x] 9.2 Update frontend components to use permission-based checks
    - Replace `currentRole === "owner" || currentRole === "admin"` checks with `permissions.includes("org.members.manage")` (or the appropriate permission key)
    - Update `web/src/components/settings/unified-users-tab.tsx` and other settings components
    - Update navigation/sidebar components that conditionally show admin-only items
    - Update team management components to check team permissions
    - _Requirements: 2.1, 2.3, 2.8_

- [x] 10. Verify bug condition exploration test now passes

  - [x] 10.1 Re-run bug condition exploration test
    - **Property 1: Expected Behavior** - Permission-Based Access Control Works
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior for permission-based access control
    - Update the exploration test assertions if needed to test the NEW `RequireOrgPermission`/`RequireTeamPermission` methods alongside the old rank-based methods
    - Add new test cases to the existing test file that verify:
      - Custom role "auditor" with `org.audit.view` permission → `RequireOrgPermission` returns nil (access granted)
      - Viewer role with `team.webhooks.view` permission → `RequireTeamPermission` returns nil (access granted)
      - Self-protection: admin cannot modify another admin via `RequireRankAbove`
      - Permission edit takes effect: role with permission removed → `RequireOrgPermission` returns `ErrInsufficientOrg`
    - Run bug condition exploration test
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_

  - [x] 10.2 Re-run preservation tests
    - **Property 2: Preservation** - System Admin Bypass and Membership Checks Still Work
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation properties still hold after the fix:
      - System admin bypass works on new permission-based methods
      - Non-member denial unchanged
      - Unauthenticated denial unchanged
      - Org-level fallback for team access unchanged
      - Owner full access unchanged
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 11. Build verification and final validation

  - [x] 11.1 Run Go backend tests and build
    - Run `go build ./...` to verify compilation
    - Run `go test ./internal/auth/rbac/...` to verify RBAC tests pass
    - Run `go test ./internal/auth/...` to verify middleware tests still pass
    - Run `go test ./internal/service/...` to verify service tests still pass
    - Run `go test ./internal/handler/...` to verify handler tests still pass
    - Run `go test ./...` for full test suite
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [x] 11.2 Run frontend build
    - Run `npm run build` (or equivalent) in the `web/` directory to verify frontend compiles
    - Verify no TypeScript errors from store/component changes
    - _Requirements: 2.1, 2.3_

- [x] 12. Checkpoint — Ensure all tests pass
  - Ensure all Go tests pass (`go test ./...`)
  - Ensure frontend builds successfully
  - Ensure exploration test (Property 1) passes — confirms bug is fixed
  - Ensure preservation tests (Property 2) pass — confirms no regressions
  - Ensure migration 000037 is syntactically valid
  - Verify that the permission cache loads correctly and `Refresh()` works
  - Ask the user if questions arise
