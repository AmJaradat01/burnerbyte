# Implementation Plan: Enhanced Audit Logging

## Overview

This plan implements comprehensive audit logging enhancements across the BurnerByte platform. It adds 5 new schema columns (user_agent, resource_name, actor_display_name, severity, category), before/after diffs on all update operations, ~15 new audit events, severity/category classification maps, enhanced filtering, and CSV/JSON export. Each task builds incrementally on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Database migration and domain model updates
  - [x] 1.1 Create migration files for enhanced audit_logs columns
    - Create `migrations/000031_audit_logs_enhanced.up.sql` adding 5 new columns (`user_agent TEXT DEFAULT ''`, `resource_name TEXT DEFAULT ''`, `actor_display_name TEXT DEFAULT ''`, `severity VARCHAR(20) DEFAULT 'info'`, `category VARCHAR(30) DEFAULT ''`) and indexes on `severity`, `category`, `resource_name`
    - Create `migrations/000031_audit_logs_enhanced.down.sql` dropping the indexes and columns with `IF EXISTS` guards
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 1.2 Update AuditEntry and AuditFilter domain structs
    - Add `ActorDisplayName string`, `ResourceName string`, `UserAgent string`, `Severity string`, `Category string` fields to `AuditEntry` in `internal/domain/audit.go` with correct JSON tags (`actor_display_name`, `resource_name`, `user_agent`, `severity`, `category`)
    - Add `Severity *string`, `Category *string`, `ResourceName *string` fields to `AuditFilter` with correct JSON tags
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. UserContext enhancement and auth middleware update
  - [x] 2.1 Add DisplayName field to UserContext and populate in middleware
    - Add `DisplayName string` field to `auth.UserContext` in `internal/auth/middleware.go`
    - In the JWT auth path of `Middleware`, set `DisplayName: user.DisplayName` from the already-fetched user object
    - In the API key auth path, set `DisplayName: user.DisplayName` from the already-fetched user object
    - _Requirements: 3.2_

- [x] 3. Audit recorder enhancement with classification maps
  - [x] 3.1 Add severity and category classification maps to recorder
    - Add `SeverityMap` and `CategoryMap` as package-level `map[string]string` variables in `internal/audit/recorder.go` with all action→severity and action→category mappings from the design document
    - Add helper functions `GetSeverity(action string) string` (defaults to `"info"`) and `GetCategory(action string) string` (defaults to `""`)
    - _Requirements: 12.1, 12.2, 12.3, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10_

  - [x] 3.2 Implement RecordEnhanced method on Recorder
    - Add `RecordEnhanced(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID, resourceName string, metadata map[string]any)` method
    - Extract `User-Agent` header from request, extract `DisplayName` from `auth.GetUser(r.Context())`, look up severity via `GetSeverity(action)`, look up category via `GetCategory(action)`, build full `AuditEntry` with all new fields populated, call `svc.Record(ctx, entry)`
    - Keep existing `Record` and `RecordFromRequest` methods unchanged for backward compatibility
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 3.3 Write property tests for severity classification (Property 1)
    - **Property 1: Severity classification is complete and correct**
    - Generate random action strings from the known set plus unknown strings; verify `GetSeverity` always returns one of `info`, `warning`, `critical`; verify critical/warning actions return their expected values; verify unknown actions return `info`
    - Use `pgregory.net/rapid` with minimum 100 iterations
    - **Validates: Requirements 1.4, 12.1, 12.2, 12.3**

  - [ ]* 3.4 Write property tests for category classification (Property 2)
    - **Property 2: Category classification is complete and correct**
    - Generate random action strings from the known set plus unknown strings; verify `GetCategory` always returns a value from the defined set or empty string; verify each known action maps to its expected category
    - Use `pgregory.net/rapid` with minimum 100 iterations
    - **Validates: Requirements 1.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10**

  - [ ]* 3.5 Write property test for AuditEntry JSON round-trip (Property 3)
    - **Property 3: AuditEntry JSON serialization round-trip**
    - Generate random AuditEntry structs with all fields populated (including new fields), marshal to JSON, unmarshal back, verify all field values are preserved
    - Use `pgregory.net/rapid` with minimum 100 iterations
    - **Validates: Requirements 2.3**

- [ ] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add auditRecordEnhanced helper in rbac.go
  - [x] 5.1 Add auditRecordEnhanced helper function
    - Add `auditRecordEnhanced(r *http.Request, orgID uuid.UUID, action, resourceType string, resourceID uuid.UUID, resourceName string, meta map[string]any)` function in `internal/handler/rbac.go` that calls `Audit.RecordEnhanced(...)` if `Audit != nil`
    - Keep existing `auditRecord` function unchanged for backward compatibility
    - _Requirements: 3.3, 3.4, 16.3_

- [x] 6. Repository enhancement — Create and List with new columns
  - [x] 6.1 Update AuditRepo Create method for new columns
    - Update the INSERT statement in `internal/repository/postgres/audit_repo.go` to include `user_agent`, `resource_name`, `actor_display_name`, `severity`, `category` columns
    - Map the new `AuditEntry` fields to the corresponding SQL parameters
    - _Requirements: 4.1_

  - [x] 6.2 Update AuditRepo List method for new columns and filters
    - Update the SELECT statement to read `user_agent`, `resource_name`, `actor_display_name`, `severity`, `category` columns (use `COALESCE` for backward compatibility with NULL values)
    - Add WHERE clause builders for `severity` (exact match), `category` (exact match), and `resource_name` (ILIKE partial match) filters
    - Update the `Scan` call to include the new fields
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [x] 6.3 Add ListAll method to AuditRepo for export
    - Add `ListAll(ctx context.Context, orgID uuid.UUID, filter domain.AuditFilter) ([]domain.AuditEntry, error)` method
    - Same filter support as `List` but returns up to 10,000 rows without pagination, ordered by `created_at DESC`
    - _Requirements: 15.4_

- [x] 7. Service enhancement — ListAll method
  - [x] 7.1 Add ListAll method to AuditService
    - Add `ListAll(ctx context.Context, orgID uuid.UUID, filter domain.AuditFilter) ([]domain.AuditEntry, error)` method in `internal/service/audit_service.go` that delegates to `repo.ListAll`
    - _Requirements: 15.3, 15.4_

- [x] 8. Audit handler enhancement — new filters and export endpoint
  - [x] 8.1 Add severity, category, and resource_name filter parsing to List handler
    - Parse `severity`, `category`, and `resource_name` query parameters in `internal/handler/audit.go` List method
    - Validate `severity` against `["info", "warning", "critical"]`, return 400 for invalid values
    - Validate `category` against the defined set (`auth`, `org`, `team`, `domain`, `inbox`, `email`, `webhook`, `apikey`, `admin`, `member`), return 400 for invalid values
    - Pass validated filters to `svc.List`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 8.2 Implement Export endpoint on AuditHandler
    - Add `Export(w http.ResponseWriter, r *http.Request)` method supporting `format=csv` and `format=json` query parameter
    - Apply the same filter parameters as List (actor_id, action, resource_type, severity, category, resource_name, date_from, date_to)
    - CSV: set `Content-Disposition: attachment; filename="audit_export_{timestamp}.csv"`, write header row (`id`, `created_at`, `org_id`, `actor_id`, `actor_email`, `actor_display_name`, `action`, `severity`, `category`, `resource_type`, `resource_id`, `resource_name`, `ip_address`, `user_agent`, `metadata`) + data rows using `encoding/csv`, JSON-encode metadata column
    - JSON: set `Content-Disposition: attachment; filename="audit_export_{timestamp}.json"`, write JSON array of AuditEntry objects
    - Set `X-Truncated: true` header if results hit the 10,000 cap
    - Return 400 if `format` is missing or invalid
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ]* 8.3 Write property test for invalid filter rejection (Property 9)
    - **Property 9: Invalid filter values are rejected**
    - Generate random strings that are NOT valid severity/category values; verify the validation logic rejects them
    - Use `pgregory.net/rapid` with minimum 100 iterations
    - **Validates: Requirements 14.4, 14.5**

- [x] 9. Route registration — export route in main.go
  - [x] 9.1 Register audit export route
    - Add `r.Get("/orgs/{orgId}/audit/export", auditHandler.Export)` in the authenticated routes section of `cmd/api/main.go`, adjacent to the existing audit list route
    - _Requirements: 15.1_

- [ ] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Auth handler updates — enrich existing events and add new events
  - [x] 11.1 Enrich existing auth audit events and add new events
    - `Login`: Switch to `auditRecordEnhanced`, include `user_agent` in metadata, pass user email as `resourceName`
    - `Register`: Switch to `auditRecordEnhanced`, pass user email as `resourceName`
    - `ResetPassword`: Switch to `auditRecordEnhanced`, fix resource_id to use actual user ID (resolve from token) instead of `uuid.Nil`, pass user email as `resourceName`
    - `ChangePassword`: Switch to `auditRecordEnhanced`, pass user email as `resourceName`
    - `DeleteAccount`: Switch to `auditRecordEnhanced`, pass user email as `resourceName`
    - `UpdateProfile`: Add `user.profile_updated` event via `auditRecordEnhanced` with before/after diffs of changed fields (display_name, avatar_url, timezone, date_format, time_format) — fetch user before update to capture before state
    - `VerifyEmail`: Add `user.email_verified` event via `auditRecordEnhanced` with user email in metadata — requires resolving user from token
    - `SSOCallback`: Add `user.sso_login` event via `auditRecordEnhanced` with SSO provider in metadata, pass user email as `resourceName`
    - `RevokeSession`: Add `session.revoked` event via `auditRecordEnhanced` with revoked session ID in metadata
    - `RevokeAllSessions`: Add `session.revoked_all` event via `auditRecordEnhanced`
    - _Requirements: 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 12. Org handler updates — before/after diffs and human-readable names
  - [x] 12.1 Enrich org handler audit events
    - `UpdateOrg`: Fetch org before update, switch to `auditRecordEnhanced` with before/after diffs of name and logo_url, pass org name as `resourceName`
    - `UpdateSettings`: Fetch settings before update, switch to `auditRecordEnhanced` with before/after diffs of changed settings, pass org name as `resourceName`
    - `DeleteOrg`: Fetch org before delete, switch to `auditRecordEnhanced` with org name in metadata, pass org name as `resourceName`
    - `ChangeRole`: Fetch current membership to get old_role and target user info, switch to `auditRecordEnhanced` with `old_role`, `new_role`, `target_user_id`, `target_user_email` in metadata
    - `RemoveMember`: Fetch target user info before removal, switch to `auditRecordEnhanced` with `target_user_email`, `target_user_display_name` in metadata
    - `CreateOrg`: Switch to `auditRecordEnhanced`, pass org name as `resourceName`
    - `InviteMember`: Switch to `auditRecordEnhanced` with email and role in metadata
    - `RevokeInvite`: Switch to `auditRecordEnhanced`
    - `AcceptInvite`: Switch to `auditRecordEnhanced`
    - _Requirements: 5.1, 5.2, 5.5, 5.6, 6.5_

- [x] 13. Team handler updates — before/after diffs, new member events, human-readable names
  - [x] 13.1 Enrich team handler audit events and add new member events
    - `UpdateTeam`: Fetch team before update, switch to `auditRecordEnhanced` with before/after diffs of name and description, pass team name as `resourceName`
    - `DeleteTeam`: Fetch team before delete, switch to `auditRecordEnhanced` with team name in metadata, pass team name as `resourceName`
    - `CreateTeam`: Switch to `auditRecordEnhanced`, pass team name as `resourceName`
    - `AddMember`: Add `team.member_added` event via `auditRecordEnhanced` with target_user_id, target_user_email, team_name, and assigned role in metadata — requires looking up user and team
    - `RemoveMember`: Add `team.member_removed` event via `auditRecordEnhanced` with target_user_id, target_user_email, team_name in metadata — requires looking up user and team
    - `ChangeRole`: Add `team.member_role_changed` event via `auditRecordEnhanced` with target_user_id, target_user_email, team_name, old_role, new_role in metadata — requires looking up current membership, user, and team
    - _Requirements: 5.3, 6.4, 9.1, 9.2, 9.3_

- [x] 14. Domain handler updates — before/after diffs, new domain.updated event, human-readable names
  - [x] 14.1 Enrich domain handler audit events
    - `UpdateDomain`: Fetch domain before update, add `domain.updated` event via `auditRecordEnhanced` with before/after diffs, pass domain name as `resourceName`
    - `DeleteDomain`: Fetch domain before delete, switch to `auditRecordEnhanced` with domain name in metadata, pass domain name as `resourceName`
    - `CreateDomain`: Switch to `auditRecordEnhanced`, pass domain name as `resourceName`
    - `VerifyDomain`: Switch to `auditRecordEnhanced`, pass domain name as `resourceName`
    - _Requirements: 6.3, 10.1_

- [ ] 15. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Domain assignment handler updates — new domain_assignment.updated event, human-readable names
  - [x] 16.1 Enrich domain assignment handler audit events
    - `UpdateAssignment`: Fetch assignment before update, add `domain_assignment.updated` event via `auditRecordEnhanced` with before/after diffs, pass domain name as `resourceName` — requires looking up domain and team names
    - `AssignDomain`: Switch to `auditRecordEnhanced` with domain_name and team_name in metadata, pass domain name as `resourceName`
    - `Unassign`: Switch to `auditRecordEnhanced` with domain_name and team_name in metadata, pass domain name as `resourceName`
    - _Requirements: 5.8, 6.1, 6.2, 10.2_

- [x] 17. Inbox handler updates — enrich with resource_name
  - [x] 17.1 Enrich inbox handler audit events
    - `CreateInboxFlat`: Switch to `auditRecordEnhanced`, pass inbox full address as `resourceName`
    - `ExtendTTL`: Switch to `auditRecordEnhanced`, pass inbox full address as `resourceName`
    - `DeleteInbox`: Switch to `auditRecordEnhanced`, pass inbox full address as `resourceName`
    - _Requirements: 3.3_

- [x] 18. Email handler updates — new email.deleted and email.all_read events
  - [x] 18.1 Add email audit events
    - `DeleteEmail`: Add `email.deleted` event via `auditRecordEnhanced` with email subject and inbox address in metadata — requires fetching email and inbox before delete, determine orgID from inbox chain
    - `MarkAllRead`: Add `email.all_read` event via `auditRecordEnhanced` with inbox address and count of marked emails in metadata — requires fetching inbox to get address and orgID
    - _Requirements: 8.1, 8.2_

- [x] 19. Webhook handler updates — before/after diffs
  - [x] 19.1 Enrich webhook handler audit events
    - `Update`: Fetch webhook before update, switch to `auditRecordEnhanced` with before/after diffs of url, events, and active fields, pass webhook URL as `resourceName`
    - `Create`: Switch to `auditRecordEnhanced`, pass webhook URL as `resourceName`
    - `Delete`: Switch to `auditRecordEnhanced`, pass webhook URL or ID as `resourceName`
    - _Requirements: 5.4_

- [x] 20. API key handler updates — enrich with resource_name
  - [x] 20.1 Enrich API key handler audit events
    - `Create`: Switch to `auditRecordEnhanced`, pass API key name as `resourceName`
    - `Revoke`: Switch to `auditRecordEnhanced`, pass API key ID as `resourceName`
    - _Requirements: 3.3_

- [x] 21. Admin handler updates — before/after diffs, new role events, human-readable names
  - [x] 21.1 Enrich admin handler audit events
    - `DeleteUser`: Fetch target user before delete, switch to `auditRecordEnhanced` with target user email and display name in metadata, pass target user email as `resourceName`
    - `UpdateUser`: Fetch user before update, switch to `auditRecordEnhanced` with before/after diffs of changed fields, pass user email as `resourceName`
    - `UpdatePlatformSettings`: Switch to `auditRecordEnhanced`, pass `"platform"` as `resourceName`
    - `UpdateSSOConfig`: Switch to `auditRecordEnhanced`, pass `"sso"` as `resourceName`
    - _Requirements: 5.7, 6.8_

- [x] 22. Main.go inline handler updates — role CRUD audit events, session revoke audit
  - [x] 22.1 Add audit events to inline handlers in main.go
    - Admin sessions revoke handler (`DELETE /admin/users/{userId}/sessions`): Switch to `auditRecordEnhanced` (or use `Audit.RecordEnhanced`), include target user email and display name in metadata, pass target user email as `resourceName`
    - Role create handler (`POST /admin/roles`): Add `admin.role_created` event via `auditRecordEnhanced` with role scope, value, label, and permissions in metadata, pass role label as `resourceName`
    - Role update handler (`PATCH /admin/roles/{roleId}`): Add `admin.role_updated` event via `auditRecordEnhanced` with role ID, before/after label/description, and updated permissions in metadata — fetch role before update, pass role label as `resourceName`
    - Role delete handler (`DELETE /admin/roles/{roleId}`): Add `admin.role_deleted` event via `auditRecordEnhanced` with role ID in metadata, pass role ID as `resourceName`
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 23. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The existing `auditRecord` helper remains unchanged — all existing call sites continue to work until individually migrated to `auditRecordEnhanced`
- Before/after diffs are computed in handlers by fetching current state before applying mutations
- All human-readable names are captured at write time for historical accuracy
