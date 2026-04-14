# Requirements Document

## Introduction

The BurnerByte teams system currently provides basic CRUD operations, member management with two roles (lead, member), team settings (attachments_enabled, max_inbox_ttl), and slug auto-generation. This enhancement adds team branding (description, avatar), search and filtering on both team lists and member lists, enriched detail responses with aggregated counts, archive/soft-delete with restore, delete impact preview, self-leave capability, bulk member operations, team creation with initial members, viewer role activation, extended settings, member search/filter, and team transfer between organizations.

## Glossary

- **Team_Service**: The service layer (`internal/service/team_service.go`) responsible for team business logic including creation, updates, archiving, transfers, and member management.
- **Team_Repository**: The data access layer (`internal/repository/postgres/team_repo.go`) responsible for persisting and querying team records and memberships in PostgreSQL.
- **Team_Handler**: The HTTP handler layer (`internal/handler/team.go`) responsible for routing and processing team REST endpoints.
- **RBAC_Checker**: The role-based access control module (`internal/auth/rbac/rbac.go`) responsible for validating org-level and team-level role permissions.
- **Counter_Repository**: The data access layer (`internal/repository/postgres/counter_repo.go`) responsible for persistent analytics counters including team-level email and inbox counts.
- **Team_Settings**: The JSONB settings object on the teams table containing team-level configuration overrides (attachments_enabled, max_inbox_ttl, default_inbox_ttl, max_inboxes_per_domain).
- **Viewer_Role**: A read-only team role that permits viewing team resources (inboxes, emails, members, webhooks, API keys) but prohibits creation, modification, or deletion.
- **Archive**: Setting `is_archived` to TRUE on a team record, hiding the team from active views while preserving all associated data (members, inboxes, emails, webhooks, API keys).
- **Impact_Summary**: A read-only preview of all resources that would be affected by deleting a team, including counts of members, inboxes, emails, domain assignments, webhooks, and API keys.

## Requirements

### Requirement 1: Team Description and Avatar

**User Story:** As a team lead, I want to add a description and avatar URL to my team, so that team members can identify the team's purpose and branding at a glance.

#### Acceptance Criteria

1. THE Team_Repository SHALL store a `description` TEXT column on the teams table.
2. THE Team_Repository SHALL store an `avatar_url` TEXT column on the teams table.
3. WHEN creating a team, THE Team_Service SHALL accept optional `description` and `avatar_url` fields in the input.
4. WHEN updating a team, THE Team_Service SHALL accept optional `description` and `avatar_url` fields in the input.
5. WHEN retrieving or listing teams, THE Team_Handler SHALL include `description` and `avatar_url` in the response.
6. WHEN an `avatar_url` is provided, THE Team_Service SHALL validate that the value is a well-formed URL with an http or https scheme.
7. IF an `avatar_url` value is not a valid http or https URL, THEN THE Team_Service SHALL return a validation error.

### Requirement 2: Team Search and Filter on List

**User Story:** As an org member, I want to search teams by name and filter by archived status, so that I can quickly find the team I need in organizations with many teams.

#### Acceptance Criteria

1. WHEN a `search` query parameter is provided on the list teams endpoint, THE Team_Repository SHALL filter teams whose name contains the search term (case-insensitive).
2. WHEN an `is_archived` query parameter is set to `true`, THE Team_Repository SHALL return only archived teams.
3. WHEN an `is_archived` query parameter is set to `false` or is omitted, THE Team_Repository SHALL return only non-archived teams.
4. WHEN both `search` and `is_archived` query parameters are provided, THE Team_Repository SHALL apply both filters.
5. THE Team_Repository SHALL continue to support pagination alongside search and filter parameters.

### Requirement 3: Enriched Team Detail Response

**User Story:** As a team lead, I want the team detail endpoint to return comprehensive resource counts, so that I can understand the team's scope without making multiple API calls.

#### Acceptance Criteria

1. WHEN a GET request is made to the team detail endpoint, THE Team_Handler SHALL return `member_count`, `domain_count`, `active_inboxes`, `total_inboxes`, `email_count`, `webhook_count`, and `apikey_count` in the response.
2. THE Team_Repository SHALL compute `total_inboxes` by counting all inboxes (active and expired) associated with the team's domain assignments.
3. THE Team_Repository SHALL compute `email_count` by counting all emails in inboxes associated with the team's domain assignments.
4. THE Team_Repository SHALL compute `webhook_count` by counting webhooks belonging to the team.
5. THE Team_Repository SHALL compute `apikey_count` by counting non-revoked API keys belonging to the team.
6. THE Team_Handler SHALL include `total_emails_received` from the team analytics counters in the response.

### Requirement 4: Team Archive and Soft-Delete

**User Story:** As an org admin, I want to archive a team instead of permanently deleting it, so that I can preserve team data while hiding the team from active views and restore it later if needed.

#### Acceptance Criteria

1. THE Team_Repository SHALL store an `is_archived` BOOLEAN column on the teams table, defaulting to FALSE.
2. THE Team_Repository SHALL store an `archived_at` TIMESTAMPTZ column on the teams table.
3. WHEN a POST request is made to `/orgs/{orgId}/teams/{teamId}/archive`, THE Team_Service SHALL set `is_archived` to TRUE and `archived_at` to the current timestamp.
4. WHEN a POST request is made to `/orgs/{orgId}/teams/{teamId}/restore`, THE Team_Service SHALL set `is_archived` to FALSE and `archived_at` to NULL.
5. WHILE a team is archived, THE Team_Service SHALL reject requests to create inboxes, add members, or create webhooks for that team with an error message indicating the team is archived.
6. THE Team_Handler SHALL require the OrgAdmin role or higher to archive or restore a team.
7. WHEN listing teams, THE Team_Repository SHALL exclude archived teams by default (unless `is_archived=true` is specified per Requirement 2).

### Requirement 5: Delete Impact Check

**User Story:** As an org admin, I want to preview what resources will be affected before deleting a team, so that I can make an informed decision about permanent deletion.

#### Acceptance Criteria

1. WHEN a GET request is made to `/orgs/{orgId}/teams/{teamId}/impact`, THE Team_Handler SHALL return an Impact_Summary.
2. THE Impact_Summary SHALL include counts for: `member_count`, `inbox_count` (total inboxes), `active_inbox_count`, `email_count`, `domain_assignment_count`, `webhook_count`, and `apikey_count`.
3. THE Team_Handler SHALL require the OrgAdmin role or higher to access the impact endpoint.
4. WHEN the team does not exist or does not belong to the specified org, THE Team_Handler SHALL return HTTP 404.

### Requirement 6: Self-Leave Capability

**User Story:** As a team member, I want to leave a team on my own, so that I do not need to ask a lead or admin to remove me.

#### Acceptance Criteria

1. WHEN a POST request is made to `/orgs/{orgId}/teams/{teamId}/leave`, THE Team_Service SHALL remove the requesting user's membership from the team.
2. IF the requesting user is the last member with the lead role, THEN THE Team_Service SHALL reject the leave request with an error indicating that the last lead cannot leave the team.
3. THE Team_Handler SHALL require the requesting user to be a member of the team (any role).
4. WHEN a member successfully leaves, THE Team_Handler SHALL record an audit event with action `team.member_left`.

### Requirement 7: Bulk Member Operations

**User Story:** As a team lead, I want to add or remove multiple members in a single request, so that I can efficiently manage team membership during onboarding or offboarding.

#### Acceptance Criteria

1. WHEN a POST request is made to `/orgs/{orgId}/teams/{teamId}/members/bulk-add` with an array of member objects (each containing `email` or `user_id` and `role`), THE Team_Service SHALL add each valid member to the team.
2. THE Team_Service SHALL skip members who are already on the team and include them in a `skipped` array in the response.
3. THE Team_Service SHALL skip members whose email or user_id cannot be resolved and include them in a `failed` array with the reason.
4. WHEN a POST request is made to `/orgs/{orgId}/teams/{teamId}/members/bulk-remove` with an array of user IDs, THE Team_Service SHALL remove each specified member from the team.
5. THE Team_Service SHALL skip user IDs that are not members of the team and include them in a `skipped` array.
6. IF a bulk-remove request would remove the last lead from the team, THEN THE Team_Service SHALL reject the entire request with an error.
7. THE Team_Handler SHALL require the OrgAdmin or TeamLead role for both bulk-add and bulk-remove operations.
8. THE Team_Handler SHALL return the count of successfully added or removed members, plus the `skipped` and `failed` arrays.

### Requirement 8: Team Creation with Initial Members

**User Story:** As an org admin, I want to create a team and add initial members in a single request, so that I can set up a fully staffed team without multiple API calls.

#### Acceptance Criteria

1. WHEN a POST request to create a team includes an optional `members` array (each containing `email` or `user_id` and `role`), THE Team_Service SHALL add each specified member to the team after creating it.
2. THE Team_Service SHALL continue to add the creator as a lead regardless of the members array.
3. IF a member in the initial members array cannot be resolved (invalid email or user_id), THEN THE Team_Service SHALL still create the team and return the unresolved members in a `failed_members` array in the response.
4. IF a member in the initial members array specifies an invalid role, THEN THE Team_Service SHALL skip that member and include the entry in the `failed_members` array with the reason.
5. THE Team_Service SHALL not add duplicate memberships if the creator is also listed in the members array.

### Requirement 9: Viewer Role Activation

**User Story:** As an org admin, I want a viewer role for team members who only need read access, so that I can grant limited visibility without risking accidental modifications.

#### Acceptance Criteria

1. THE database migration SHALL re-add `viewer` to the team_memberships role CHECK constraint, making the allowed values `lead`, `member`, and `viewer`.
2. THE RBAC_Checker SHALL recognize `viewer` as a valid team role with rank 0 (below member at rank 1).
3. WHEN a user with the Viewer_Role accesses a team read endpoint (get team, list members, list inboxes, list webhooks, list API keys, list emails), THE RBAC_Checker SHALL permit the request.
4. WHEN a user with the Viewer_Role attempts a write operation (create inbox, add member, create webhook, create API key, update team, delete resources), THE RBAC_Checker SHALL reject the request with HTTP 403.
5. THE Team_Handler SHALL accept `viewer` as a valid role value when adding members or changing roles.
6. IF a role change would leave the team with zero leads, THEN THE Team_Service SHALL reject the role change with an error.

### Requirement 10: Extended Team Settings

**User Story:** As a team lead, I want additional team-level settings for default inbox TTL and maximum inboxes per domain, so that I can control resource usage within my team.

#### Acceptance Criteria

1. THE Team_Settings SHALL support a `default_inbox_ttl` field (string duration format, e.g., "1h", "24h") that overrides the org-level default when creating inboxes.
2. THE Team_Settings SHALL support a `max_inboxes_per_domain` field (integer) that limits how many active inboxes a team can have per domain assignment.
3. WHEN updating team settings, THE Team_Service SHALL validate that `default_inbox_ttl` is a valid Go duration string.
4. WHEN updating team settings, THE Team_Service SHALL validate that `max_inboxes_per_domain` is a positive integer when provided.
5. IF `default_inbox_ttl` exceeds the resolved `max_inbox_ttl`, THEN THE Team_Service SHALL return a validation error.
6. WHEN `default_inbox_ttl` is not set on the team, THE Settings_Resolver SHALL fall through to the org-level or system default.
7. WHEN `max_inboxes_per_domain` is not set on the team, THE Inbox_Service SHALL use no team-level limit (org-level or system default applies).

### Requirement 11: Team Member Search and Filter

**User Story:** As a team lead, I want to search team members by email or display name and filter by role, so that I can quickly find specific members in large teams.

#### Acceptance Criteria

1. WHEN a `search` query parameter is provided on the list members endpoint, THE Team_Repository SHALL filter members whose email or display_name contains the search term (case-insensitive).
2. WHEN a `role` query parameter is provided, THE Team_Repository SHALL filter members by the specified role.
3. WHEN both `search` and `role` query parameters are provided, THE Team_Repository SHALL apply both filters.
4. THE Team_Repository SHALL continue to support pagination alongside search and filter parameters.

### Requirement 12: Team Transfer Between Organizations

**User Story:** As a system admin, I want to transfer a team from one organization to another, so that I can reorganize teams during corporate restructuring without recreating them.

#### Acceptance Criteria

1. WHEN a POST request is made to `/orgs/{orgId}/teams/{teamId}/transfer` with a `target_org_id`, THE Team_Service SHALL move the team to the target organization.
2. THE Team_Service SHALL validate that the target organization exists and has not reached its team limit.
3. THE Team_Service SHALL remove all domain assignments for the team (domains belong to the source org and cannot transfer).
4. THE Team_Service SHALL preserve all team memberships, but validate that each member is also a member of the target organization; members who are not in the target org SHALL be removed from the team and included in a `removed_members` array in the response.
5. THE Team_Service SHALL update the team's `org_id` to the target organization's ID.
6. THE Team_Handler SHALL require the system admin role to perform a transfer.
7. IF the team is archived, THEN THE Team_Service SHALL reject the transfer with an error indicating archived teams cannot be transferred.
8. WHEN a transfer completes, THE Team_Handler SHALL record audit events in both the source and target organizations.

### Requirement 13: Database Migration for Schema Changes

**User Story:** As a developer, I want a single migration that adds all new columns and indexes to the teams and team_memberships tables, so that the schema supports all enhanced features.

#### Acceptance Criteria

1. THE migration SHALL add the following columns to the teams table: `description TEXT`, `avatar_url TEXT`, `is_archived BOOLEAN NOT NULL DEFAULT FALSE`, `archived_at TIMESTAMPTZ`.
2. THE migration SHALL add an index on `(org_id, is_archived)` for filtered team listing.
3. THE migration SHALL add a GIN trigram index on `name` for case-insensitive search.
4. THE migration SHALL alter the team_memberships role CHECK constraint to allow `lead`, `member`, and `viewer`.
5. THE migration SHALL include a corresponding down migration that removes all added columns, indexes, and reverts the CHECK constraint.
