# Requirements Document

## Introduction

The BurnerByte platform currently has a basic audit logging system that tracks 30+ actions across handlers. The existing audit records lack contextual detail (no before/after diffs, no human-readable names, missing user-agent), omit many state-changing actions entirely, and the API provides no export, severity filtering, or category-based querying. This feature enhances the audit logging system to provide comprehensive, human-readable, security-classified audit records with full before/after context, coverage of all state-changing actions, and an enriched API for filtering, searching, and exporting.

## Glossary

- **Audit_System**: The subsystem responsible for recording, storing, querying, and exporting audit log entries across the BurnerByte platform.
- **Audit_Recorder**: The component (`internal/audit/recorder.go`) that accepts audit parameters from handlers and persists them via the Audit_Service.
- **Audit_Service**: The service layer (`internal/service/audit_service.go`) that validates and delegates audit entry persistence to the Audit_Repository.
- **Audit_Repository**: The PostgreSQL repository (`internal/repository/postgres/audit_repo.go`) that executes SQL queries against the `audit_logs` table.
- **Audit_Handler**: The HTTP handler (`internal/handler/audit.go`) that exposes the audit log API endpoints.
- **Audit_Entry**: A single audit log record containing actor, action, resource, metadata, severity, category, and contextual fields.
- **Severity_Level**: A classification of audit events: `info` (routine operations), `warning` (notable changes), `critical` (security-sensitive actions).
- **Category**: A grouping label for audit actions: `auth`, `org`, `team`, `domain`, `inbox`, `email`, `webhook`, `apikey`, `admin`, `member`.
- **Before_After_Diff**: A metadata structure containing `before` and `after` snapshots of changed fields for update operations.
- **Resource_Name**: A human-readable label stored alongside the resource UUID to make audit entries readable without cross-referencing other tables.
- **Actor_Display_Name**: The display name of the user who performed the audited action, stored at write time for historical accuracy.

## Requirements

### Requirement 1: Schema Enhancement — New Columns

**User Story:** As a platform administrator, I want audit log entries to include user-agent, human-readable resource names, actor display names, severity levels, and categories, so that I can understand audit entries without cross-referencing other tables and can filter by importance.

#### Acceptance Criteria

1. THE Audit_System SHALL store a `user_agent` text column on each Audit_Entry to record the HTTP User-Agent header of the request that triggered the action.
2. THE Audit_System SHALL store a `resource_name` text column on each Audit_Entry to hold a human-readable name for the referenced resource (e.g., domain name, team name, inbox address, user email).
3. THE Audit_System SHALL store an `actor_display_name` text column on each Audit_Entry to record the display name of the actor at the time of the action.
4. THE Audit_System SHALL store a `severity` varchar(20) column on each Audit_Entry with allowed values `info`, `warning`, and `critical`.
5. THE Audit_System SHALL store a `category` varchar(30) column on each Audit_Entry with allowed values `auth`, `org`, `team`, `domain`, `inbox`, `email`, `webhook`, `apikey`, `admin`, and `member`.
6. THE Audit_System SHALL default `severity` to `info` and `category` to an empty string when values are not explicitly provided.
7. THE Audit_System SHALL create database indexes on the `severity` and `category` columns to support efficient filtered queries.
8. THE Audit_System SHALL apply the schema changes via a new numbered migration file following the existing migration naming convention (e.g., `000031_audit_logs_enhanced.up.sql`).

### Requirement 2: Domain Model Enhancement

**User Story:** As a developer, I want the AuditEntry and AuditFilter structs to reflect the new schema columns, so that the application layer can read and write the enhanced fields.

#### Acceptance Criteria

1. THE Audit_System SHALL include `UserAgent`, `ResourceName`, `ActorDisplayName`, `Severity`, and `Category` fields on the AuditEntry struct in `internal/domain/audit.go`.
2. THE Audit_System SHALL include `Severity`, `Category`, and `ResourceName` filter fields on the AuditFilter struct in `internal/domain/audit.go`.
3. THE Audit_System SHALL serialize the new AuditEntry fields as `user_agent`, `resource_name`, `actor_display_name`, `severity`, and `category` in JSON responses.

### Requirement 3: Recorder Enhancement

**User Story:** As a developer, I want the audit recorder to accept and persist user-agent, resource name, actor display name, severity, and category, so that all handler call sites can provide enriched audit data.

#### Acceptance Criteria

1. THE Audit_Recorder SHALL extract the `User-Agent` header from the HTTP request and include the value in the Audit_Entry `UserAgent` field.
2. THE Audit_Recorder SHALL extract the actor's display name from the authenticated user context and include the value in the Audit_Entry `ActorDisplayName` field.
3. THE Audit_Recorder SHALL accept `resource_name`, `severity`, and `category` parameters from callers and include the values in the Audit_Entry.
4. THE Audit_Recorder SHALL provide a backward-compatible call signature so that existing `auditRecord` call sites continue to function without modification until individually updated.

### Requirement 4: Repository Enhancement

**User Story:** As a developer, I want the audit repository to persist and query the new columns, so that the enhanced data flows end-to-end from write to read.

#### Acceptance Criteria

1. THE Audit_Repository SHALL insert `user_agent`, `resource_name`, `actor_display_name`, `severity`, and `category` values into the `audit_logs` table on each Create call.
2. THE Audit_Repository SHALL read and return `user_agent`, `resource_name`, `actor_display_name`, `severity`, and `category` columns in List query results.
3. WHEN a `Severity` filter is provided, THE Audit_Repository SHALL include a WHERE clause filtering on the `severity` column.
4. WHEN a `Category` filter is provided, THE Audit_Repository SHALL include a WHERE clause filtering on the `category` column.
5. WHEN a `ResourceName` filter is provided, THE Audit_Repository SHALL include a WHERE clause performing a case-insensitive partial match (ILIKE) on the `resource_name` column.

### Requirement 5: Enriched Metadata on Existing Events — Before/After Diffs

**User Story:** As a platform administrator, I want update-type audit entries to show what changed (old and new values), so that I can understand the impact of each change without guessing.

#### Acceptance Criteria

1. WHEN the `org.updated` action is recorded, THE Audit_System SHALL include `before` and `after` snapshots of the changed organization fields (name, logo_url) in the metadata.
2. WHEN the `org.settings.updated` action is recorded, THE Audit_System SHALL include `before` and `after` snapshots of the changed settings fields in the metadata.
3. WHEN the `team.updated` action is recorded, THE Audit_System SHALL include `before` and `after` snapshots of the changed team fields (name, description) in the metadata.
4. WHEN the `webhook.updated` action is recorded, THE Audit_System SHALL include `before` and `after` snapshots of the changed webhook fields (url, events, active) in the metadata.
5. WHEN the `member.role_changed` action is recorded, THE Audit_System SHALL include `old_role`, `new_role`, `target_user_id`, and `target_user_email` in the metadata.
6. WHEN the `member.removed` action is recorded, THE Audit_System SHALL include `target_user_email` and `target_user_display_name` in the metadata in addition to the user ID.
7. WHEN the `admin.user_updated` action is recorded, THE Audit_System SHALL include `before` and `after` snapshots of the changed user fields in the metadata.
8. WHEN the `domain_assignment.updated` action is recorded, THE Audit_System SHALL include `before` and `after` snapshots of the changed assignment fields in the metadata.

### Requirement 6: Enriched Metadata on Existing Events — Human-Readable Names

**User Story:** As a platform administrator, I want audit entries to include human-readable names for all referenced entities, so that I can read the audit log without looking up UUIDs.

#### Acceptance Criteria

1. WHEN the `domain.assigned` action is recorded, THE Audit_System SHALL include the domain name and team name in the metadata alongside the UUIDs.
2. WHEN the `domain.unassigned` action is recorded, THE Audit_System SHALL include the domain name and team name in the metadata alongside the UUIDs.
3. WHEN the `domain.deleted` action is recorded, THE Audit_System SHALL include the domain name in the metadata.
4. WHEN the `team.deleted` action is recorded, THE Audit_System SHALL include the team name in the metadata.
5. WHEN the `org.deleted` action is recorded, THE Audit_System SHALL include the organization name in the metadata.
6. WHEN the `user.login` action is recorded, THE Audit_System SHALL include the `user_agent` string in the metadata.
7. WHEN the `user.password_reset` action is recorded, THE Audit_System SHALL include the user email and user ID as the resource_id (instead of uuid.Nil) in the Audit_Entry.
8. WHEN the `admin.user_deleted` action is recorded, THE Audit_System SHALL include the target user email and display name in the metadata.

### Requirement 7: New Audit Events — User Actions

**User Story:** As a platform administrator, I want all user-initiated state changes to be tracked in the audit log, so that there are no gaps in the audit trail.

#### Acceptance Criteria

1. WHEN a user updates their profile (display name, avatar, timezone, date format, time format), THE Audit_System SHALL record a `user.profile_updated` action with before and after values in the metadata.
2. WHEN a user's email is verified, THE Audit_System SHALL record a `user.email_verified` action with the user email in the metadata.
3. WHEN a user logs in via SSO, THE Audit_System SHALL record a `user.sso_login` action with the SSO provider name in the metadata.
4. WHEN a user revokes a single session, THE Audit_System SHALL record a `session.revoked` action with the revoked session ID in the metadata.
5. WHEN a user revokes all sessions, THE Audit_System SHALL record a `session.revoked_all` action.
6. WHEN a user logs out (revokes current session), THE Audit_System SHALL record a `user.logout` action.

### Requirement 8: New Audit Events — Email Actions

**User Story:** As a platform administrator, I want email-related state changes to be tracked, so that I can audit data deletion and bulk operations.

#### Acceptance Criteria

1. WHEN a user deletes an email, THE Audit_System SHALL record an `email.deleted` action with the email subject and inbox address in the metadata.
2. WHEN a user marks all emails as read in an inbox, THE Audit_System SHALL record an `email.all_read` action with the inbox address and count of marked emails in the metadata.

### Requirement 9: New Audit Events — Team Membership Actions

**User Story:** As a platform administrator, I want team membership changes to be tracked, so that I can audit who was added to or removed from teams and when roles changed.

#### Acceptance Criteria

1. WHEN a member is added to a team, THE Audit_System SHALL record a `team.member_added` action with the target user ID, target user email, team name, and assigned role in the metadata.
2. WHEN a member is removed from a team, THE Audit_System SHALL record a `team.member_removed` action with the target user ID, target user email, and team name in the metadata.
3. WHEN a team member's role is changed, THE Audit_System SHALL record a `team.member_role_changed` action with the target user ID, target user email, team name, old role, and new role in the metadata.

### Requirement 10: New Audit Events — Domain and Assignment Actions

**User Story:** As a platform administrator, I want domain setting changes and assignment updates to be tracked, so that I can audit configuration changes to mail routing.

#### Acceptance Criteria

1. WHEN a domain's settings are updated (catch-all, max inboxes, TTL overrides), THE Audit_System SHALL record a `domain.updated` action with before and after values in the metadata.
2. WHEN a domain assignment's settings are updated (access level, TTL overrides), THE Audit_System SHALL record a `domain_assignment.updated` action with before and after values in the metadata.

### Requirement 11: New Audit Events — Admin Role Management

**User Story:** As a platform administrator, I want role management actions to be tracked, so that I can audit changes to the RBAC configuration.

#### Acceptance Criteria

1. WHEN an admin creates a new role, THE Audit_System SHALL record an `admin.role_created` action with the role scope, value, label, and permissions in the metadata.
2. WHEN an admin updates a role, THE Audit_System SHALL record an `admin.role_updated` action with the role ID, before and after label/description, and updated permissions in the metadata.
3. WHEN an admin deletes a role, THE Audit_System SHALL record an `admin.role_deleted` action with the role ID in the metadata.

### Requirement 12: Severity Classification

**User Story:** As a platform administrator, I want each audit event to carry a severity level, so that I can quickly identify security-sensitive actions and prioritize review.

#### Acceptance Criteria

1. THE Audit_System SHALL classify the following actions as `critical` severity: `user.password_changed`, `user.password_reset`, `user.account_deleted`, `admin.user_deleted`, `admin.sessions_revoked`, `admin.sso_config_updated`, `admin.platform_settings_updated`, `member.role_changed`, `admin.role_created`, `admin.role_updated`, `admin.role_deleted`, `org.deleted`.
2. THE Audit_System SHALL classify the following actions as `warning` severity: `member.removed`, `member.invited`, `team.deleted`, `domain.deleted`, `domain.unassigned`, `webhook.deleted`, `apikey.revoked`, `inbox.deleted`, `email.deleted`, `admin.user_updated`, `org.updated`, `org.settings.updated`.
3. THE Audit_System SHALL classify all remaining actions as `info` severity, including: `user.registered`, `user.login`, `user.sso_login`, `user.profile_updated`, `user.email_verified`, `user.logout`, `session.revoked`, `session.revoked_all`, `org.created`, `team.created`, `team.updated`, `team.member_added`, `team.member_removed`, `team.member_role_changed`, `domain.created`, `domain.verified`, `domain.updated`, `domain.assigned`, `domain_assignment.updated`, `inbox.created`, `inbox.extended`, `email.all_read`, `webhook.created`, `webhook.updated`, `apikey.created`, `invite.revoked`, `invite.accepted`.

### Requirement 13: Category Classification

**User Story:** As a platform administrator, I want each audit event to carry a category label, so that I can filter the audit log by functional area.

#### Acceptance Criteria

1. THE Audit_System SHALL assign category `auth` to actions: `user.registered`, `user.login`, `user.sso_login`, `user.logout`, `user.password_changed`, `user.password_reset`, `user.account_deleted`, `user.profile_updated`, `user.email_verified`, `session.revoked`, `session.revoked_all`.
2. THE Audit_System SHALL assign category `org` to actions: `org.created`, `org.updated`, `org.deleted`, `org.settings.updated`.
3. THE Audit_System SHALL assign category `member` to actions: `member.invited`, `member.role_changed`, `member.removed`, `invite.revoked`, `invite.accepted`.
4. THE Audit_System SHALL assign category `team` to actions: `team.created`, `team.updated`, `team.deleted`, `team.member_added`, `team.member_removed`, `team.member_role_changed`.
5. THE Audit_System SHALL assign category `domain` to actions: `domain.created`, `domain.updated`, `domain.deleted`, `domain.verified`, `domain.assigned`, `domain.unassigned`, `domain_assignment.updated`.
6. THE Audit_System SHALL assign category `inbox` to actions: `inbox.created`, `inbox.deleted`, `inbox.extended`.
7. THE Audit_System SHALL assign category `email` to actions: `email.deleted`, `email.all_read`.
8. THE Audit_System SHALL assign category `webhook` to actions: `webhook.created`, `webhook.updated`, `webhook.deleted`.
9. THE Audit_System SHALL assign category `apikey` to actions: `apikey.created`, `apikey.revoked`.
10. THE Audit_System SHALL assign category `admin` to actions: `admin.user_deleted`, `admin.user_updated`, `admin.sessions_revoked`, `admin.platform_settings_updated`, `admin.sso_config_updated`, `admin.role_created`, `admin.role_updated`, `admin.role_deleted`.

### Requirement 14: API Enhancement — Filtering

**User Story:** As a platform administrator, I want to filter audit log entries by severity, category, and resource name, so that I can narrow down the audit trail to relevant events.

#### Acceptance Criteria

1. WHEN the `severity` query parameter is provided on the audit list endpoint, THE Audit_Handler SHALL filter results to entries matching the specified severity level.
2. WHEN the `category` query parameter is provided on the audit list endpoint, THE Audit_Handler SHALL filter results to entries matching the specified category.
3. WHEN the `resource_name` query parameter is provided on the audit list endpoint, THE Audit_Handler SHALL filter results to entries whose resource_name contains the search term (case-insensitive).
4. THE Audit_Handler SHALL validate that the `severity` parameter, when provided, is one of `info`, `warning`, or `critical`, and return a 400 error for invalid values.
5. THE Audit_Handler SHALL validate that the `category` parameter, when provided, is one of the defined categories, and return a 400 error for invalid values.

### Requirement 15: API Enhancement — CSV/JSON Export

**User Story:** As a compliance officer, I want to export audit log entries as CSV or JSON files, so that I can archive records and share them with auditors.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/orgs/{orgId}/audit/export` with `format=csv`, THE Audit_Handler SHALL return a CSV file containing all audit entries matching the provided filters, with a `Content-Disposition: attachment` header.
2. WHEN a GET request is made to `/api/v1/orgs/{orgId}/audit/export` with `format=json`, THE Audit_Handler SHALL return a JSON array containing all audit entries matching the provided filters, with a `Content-Disposition: attachment` header.
3. THE Audit_Handler SHALL apply the same filter parameters (actor_id, action, resource_type, severity, category, resource_name, date_from, date_to) to the export endpoint as the list endpoint.
4. THE Audit_Handler SHALL limit the export to a maximum of 10,000 entries per request to prevent excessive memory usage.
5. IF the `format` query parameter is missing or invalid, THEN THE Audit_Handler SHALL return a 400 error with a descriptive message.

### Requirement 16: Backward Compatibility

**User Story:** As a developer, I want the enhanced audit system to be backward-compatible with existing audit entries, so that historical data remains queryable and the migration is non-destructive.

#### Acceptance Criteria

1. THE Audit_System SHALL add all new columns with DEFAULT values or as nullable, so that existing rows in the `audit_logs` table remain valid after migration.
2. THE Audit_System SHALL continue to return existing audit entries (with null/empty new fields) in API responses without errors.
3. THE Audit_System SHALL maintain the existing `auditRecord` helper function signature in `internal/handler/rbac.go` while adding an enhanced variant, so that call sites can be migrated incrementally.
