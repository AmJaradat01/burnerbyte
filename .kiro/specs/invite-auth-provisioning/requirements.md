# Requirements Document

## Introduction

This document specifies the requirements for extending the BurnerByte invite and authentication system with seven interconnected capabilities: invite-only registration with configurable auth methods, enhanced invite flows with multi-team selection, SSO auto-provisioning with domain-based team routing, multi-team domain mappings, bulk invites, domain mapping dry-run/preview, and invite revocation cascade on team archive/delete. Currently, the platform has a simple `allow_registration` toggle and a basic invite flow that supports a single team assignment. SSO auto-provisioning exists but only assigns users to the first org with a flat role — it lacks domain-to-team routing rules. These enhancements enable organizations to control exactly how users register, which auth methods they may use, and where they land in the team structure. The additional capabilities support batch operations for invites, allow a single email domain to map to multiple teams simultaneously, provide admin tooling to preview domain mapping outcomes before they take effect, and automatically clean up pending invites when teams are archived or deleted.

## Glossary

- **Auth_Service**: The backend service (`internal/service/auth_service.go`) responsible for user registration, login, SSO login orchestration, and invite-only mode enforcement.
- **Org_Service**: The backend service (`internal/service/org_service.go`) responsible for invite creation, acceptance, preview, and org/team membership management.
- **Org_Handler**: The HTTP handler (`internal/handler/org.go`) that exposes invite-related REST endpoints including create, preview, accept, and list.
- **Admin_Handler**: The HTTP handler (`internal/handler/admin.go`) that exposes admin-only SSO domain mapping CRUD endpoints.
- **SSO_Domain_Mapping_Repo**: The data access layer (`internal/repository/postgres/sso_domain_mapping_repo.go`) responsible for persisting and querying domain-to-team mapping rules per SSO provider.
- **Org_Repo**: The data access layer (`internal/repository/postgres/org_repo.go`) responsible for persisting and querying invite records, including the new `allowed_auth` column and `invite_team_assignments` join table.
- **Invite_Page**: The frontend page (`web/src/app/invite/page.tsx`) where invited users preview their invite, authenticate, and accept membership.
- **Invite_Dialog**: The frontend dialog within the settings page where admins create invites with auth method and multi-team configuration.
- **SSO_Provider_Dialog**: The frontend dialog within the settings page where admins manage SSO provider settings including domain mapping rules.
- **Allowed_Auth**: A JSONB array on the invites table specifying which authentication methods are permitted for the invite. Valid values are `"any"`, `"password"`, or `"sso:<provider_name>"`.
- **Invite_Team_Assignment**: A record in the `invite_team_assignments` join table linking an invite to a team with a specified role.
- **SSO_Domain_Mapping**: A record in the `sso_domain_mappings` table mapping an email domain to a team with org and team role assignments, scoped to a specific SSO provider.
- **Invite_Only_Mode**: The system state when `allow_registration` is set to false, requiring all new users to have a pending invite or matching domain mapping rule to register.
- **Bulk_Invite**: A batch operation that creates multiple invites in a single request, sharing the same `allowed_auth` and `team_assignments` configuration across all emails in the batch.
- **Bulk_Invite_Result**: The response from a bulk invite operation containing counts of created, skipped, and failed invites with per-email details.
- **Domain_Mapping_Preview**: A read-only operation that simulates what would happen if a user with a given email authenticated via a given SSO provider, returning matching rules and predicted provisioning outcome without any side effects.
- **Team_Service**: The backend service (`internal/service/team_service.go`) responsible for team lifecycle management including archive and delete operations that trigger invite revocation cascades.
- **Invite_Revocation_Cascade**: The automatic process triggered when a team is archived or deleted that revokes or updates pending invites referencing that team.

## Requirements

### Requirement 1: Invite-Only Registration Enforcement

**User Story:** As an org admin, I want to restrict registration to invited users only, so that I can control who joins the organization.

#### Acceptance Criteria

1. WHILE Invite_Only_Mode is active, WHEN a user attempts to register via password, THE Auth_Service SHALL verify that a pending invite exists for the user's email address before allowing registration.
2. WHILE Invite_Only_Mode is active, WHEN no pending invite exists for the registering user's email, THE Auth_Service SHALL reject the registration with a descriptive error message indicating an invite is required.
3. WHILE Invite_Only_Mode is not active, THE Auth_Service SHALL allow password registration without requiring a pending invite (existing behavior preserved).
4. WHILE Invite_Only_Mode is active, WHEN a new user attempts SSO login and no pending invite exists and no domain mapping rule matches, THE Auth_Service SHALL reject the login with a descriptive error message indicating an invite is required.
5. WHILE Invite_Only_Mode is active, WHEN an existing user attempts SSO login, THE Auth_Service SHALL allow the login without checking for a pending invite.

### Requirement 2: Per-Invite Auth Method Constraints

**User Story:** As an org admin, I want to specify which authentication methods are allowed per invite, so that I can enforce security policies on a per-user basis.

#### Acceptance Criteria

1. THE Org_Repo SHALL store an `allowed_auth` JSONB column on the invites table, defaulting to `["any"]`.
2. WHEN creating an invite, THE Org_Service SHALL accept an optional `allowed_auth` array in the input specifying permitted auth methods.
3. WHEN creating an invite with `allowed_auth` values, THE Org_Service SHALL validate that each value is one of: `"any"`, `"password"`, or `"sso:<provider_name>"` where `<provider_name>` references an existing enabled SSO provider.
4. IF `"any"` is included in the `allowed_auth` array, THEN THE Org_Service SHALL require it to be the only element in the array.
5. IF an `allowed_auth` value references a nonexistent or disabled SSO provider, THEN THE Org_Service SHALL reject the invite creation with a validation error listing the invalid values.
6. WHEN `allowed_auth` is not provided or is empty, THE Org_Service SHALL default the value to `["any"]` for backward compatibility.
7. WHILE Invite_Only_Mode is active, WHEN a user attempts password registration with a pending invite, THE Auth_Service SHALL verify that the invite's `allowed_auth` includes `"password"` or `"any"` before allowing registration.
8. WHILE Invite_Only_Mode is active, WHEN a user attempts password registration with a pending invite that does not allow password auth, THE Auth_Service SHALL reject the registration with a descriptive error indicating which auth methods are allowed.
9. WHILE Invite_Only_Mode is active, WHEN a new user attempts SSO login with a pending invite, THE Auth_Service SHALL verify that the invite's `allowed_auth` includes `"sso:<provider_name>"` or `"any"` before allowing login.
10. WHILE Invite_Only_Mode is active, WHEN a new user attempts SSO login with a pending invite that does not allow the SSO provider, THE Auth_Service SHALL reject the login with a descriptive error indicating which auth methods are allowed.

### Requirement 3: Multi-Team Invite Assignments

**User Story:** As an org admin, I want to assign an invited user to multiple teams in a single invite, so that new members are fully set up across all relevant teams upon joining.

#### Acceptance Criteria

1. THE database migration SHALL create an `invite_team_assignments` table with columns: `id` (UUID, primary key), `invite_id` (UUID, foreign key to invites with CASCADE delete), `team_id` (UUID, foreign key to teams with CASCADE delete), `team_role` (VARCHAR(50), default 'member'), `created_at` (TIMESTAMPTZ), with a UNIQUE constraint on `(invite_id, team_id)`.
2. WHEN creating an invite, THE Org_Service SHALL accept an optional `team_assignments` array, where each entry contains a `team_id` and `team_role`.
3. WHEN creating an invite with `team_assignments`, THE Org_Service SHALL validate that each `team_id` belongs to the invite's organization.
4. WHEN creating an invite with `team_assignments`, THE Org_Service SHALL validate that each referenced team is not archived.
5. WHEN creating an invite with `team_assignments`, THE Org_Service SHALL validate that each `team_role` is a valid team role recognized by the RBAC system.
6. WHEN creating an invite with `team_assignments`, THE Org_Service SHALL reject duplicate `team_id` entries within the same invite.
7. WHEN creating an invite with `team_assignments`, THE Org_Service SHALL persist all team assignments in the `invite_team_assignments` table within the same transaction as the invite creation.
8. WHEN an invite with `team_assignments` is accepted, THE Org_Service SHALL create team memberships for all assigned teams that are not archived at the time of acceptance.
9. WHEN an invite with `team_assignments` is accepted and a referenced team has been archived since the invite was created, THE Org_Service SHALL skip that team assignment and log a warning.
10. WHEN an invite with `team_assignments` is accepted and the user is already a member of an assigned team, THE Org_Service SHALL skip that team membership creation silently without error.
11. WHEN an invite has no `team_assignments` but has the legacy `team_id` field set, THE Org_Service SHALL create a single team membership using the legacy fields for backward compatibility.
12. WHEN an invite has both `team_assignments` and the legacy `team_id` field, THE Org_Service SHALL use the `team_assignments` and ignore the legacy fields.

### Requirement 4: SSO Domain-Based Auto-Provisioning

**User Story:** As an org admin, I want to configure domain-to-team routing rules on SSO providers, so that users from trusted email domains are automatically provisioned into the correct teams without requiring individual invites.

#### Acceptance Criteria

1. THE database migration SHALL create an `sso_domain_mappings` table with columns: `id` (UUID, primary key), `provider_id` (UUID, foreign key to sso_providers with CASCADE delete), `domain` (VARCHAR(255)), `org_role` (VARCHAR(50), default 'member'), `team_id` (UUID, foreign key to teams with CASCADE delete), `team_role` (VARCHAR(50), default 'member'), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ), with a UNIQUE constraint on `(provider_id, domain, team_id)` to allow multiple teams per domain per provider.
2. WHILE Invite_Only_Mode is active, WHEN a new user authenticates via SSO and the user's email domain matches a domain mapping rule for the SSO provider, THE Auth_Service SHALL bypass the invite requirement and auto-provision the user.
3. WHEN a domain mapping rule matches during SSO login, THE Auth_Service SHALL create the user account with email verified set to true and SSO provider set.
4. WHEN a domain mapping rule matches during SSO login, THE Auth_Service SHALL create an org membership with the org_role specified in the mapping rule.
5. WHEN a domain mapping rule matches during SSO login, THE Auth_Service SHALL create team memberships for ALL matching rules' team_id and team_role values, provisioning the user into multiple teams simultaneously.
6. WHEN a domain mapping rule matches during SSO login but the referenced team is archived, THE Auth_Service SHALL create the org membership but skip that team membership and log a warning.
7. THE SSO_Domain_Mapping_Repo SHALL perform exact domain matching only, with no wildcard or regex pattern support.
8. WHEN no domain mapping rule matches and Invite_Only_Mode is active, THE Auth_Service SHALL fall back to checking for a pending invite for the user's email.

### Requirement 5: SSO Domain Mapping Administration

**User Story:** As a system admin, I want to manage domain-to-team mapping rules through the admin API, so that I can configure auto-provisioning for trusted email domains.

#### Acceptance Criteria

1. WHEN a GET request is made to `/admin/sso/providers/{providerId}/domain-mappings`, THE Admin_Handler SHALL return all domain mapping rules for the specified provider, enriched with team names.
2. WHEN a POST request is made to `/admin/sso/providers/{providerId}/domain-mappings` with a valid mapping payload, THE Admin_Handler SHALL create a new domain mapping rule.
3. WHEN creating a domain mapping, THE Admin_Handler SHALL validate that the domain is a valid domain format.
4. WHEN creating a domain mapping, THE Admin_Handler SHALL validate that the `team_id` references an existing, non-archived team.
5. WHEN creating a domain mapping, THE Admin_Handler SHALL validate that `org_role` is a valid organization role.
6. WHEN creating a domain mapping, THE Admin_Handler SHALL validate that `team_role` is a valid team role.
7. IF a domain mapping with the same `(provider_id, domain, team_id)` triple already exists, THEN THE Admin_Handler SHALL return HTTP 409 Conflict. Two mappings with the same `(provider_id, domain)` but different `team_id` values are permitted.
8. WHEN a PUT request is made to `/admin/sso/providers/{providerId}/domain-mappings/{mappingId}`, THE Admin_Handler SHALL update the specified domain mapping rule.
9. WHEN a DELETE request is made to `/admin/sso/providers/{providerId}/domain-mappings/{mappingId}`, THE Admin_Handler SHALL delete the specified domain mapping rule.
10. THE Admin_Handler SHALL require the system admin role for all domain mapping CRUD operations.

### Requirement 6: Invite Preview with Auth Constraints

**User Story:** As an invited user, I want the invite preview to show me which authentication methods are available, so that I know how to register or sign in.

#### Acceptance Criteria

1. WHEN a GET request is made to `/invites/{token}/preview`, THE Org_Service SHALL return the invite's `allowed_auth` field in the preview response.
2. WHEN a GET request is made to `/invites/{token}/preview` for an invite with `team_assignments`, THE Org_Service SHALL return the team assignment details including team names and roles.
3. WHEN the Invite_Page receives a preview with `allowed_auth` containing `"any"` or an empty array, THE Invite_Page SHALL display all available auth options (password form and all enabled SSO buttons).
4. WHEN the Invite_Page receives a preview with `allowed_auth` containing `"password"`, THE Invite_Page SHALL display the password registration form.
5. WHEN the Invite_Page receives a preview with `allowed_auth` containing `"sso:<provider_name>"` values, THE Invite_Page SHALL display SSO buttons only for the specified providers.
6. WHEN the Invite_Page receives a preview with `allowed_auth` that does not include `"password"`, THE Invite_Page SHALL hide the password registration form.
7. THE Invite_Page SHALL display the team assignment information from the preview so the user knows which teams they will join.

### Requirement 7: Invite Dialog Multi-Team and Auth Configuration

**User Story:** As an org admin, I want the invite creation dialog to support auth method selection and multi-team assignment, so that I can configure invites with the appropriate constraints.

#### Acceptance Criteria

1. THE Invite_Dialog SHALL display an auth method selector with options for "Any", "Password", and each configured enabled SSO provider.
2. WHEN "Any" is selected in the auth method selector, THE Invite_Dialog SHALL set `allowed_auth` to `["any"]` and disable other auth method checkboxes.
3. WHEN specific auth methods are selected, THE Invite_Dialog SHALL set `allowed_auth` to the corresponding values (e.g., `["password", "sso:google"]`).
4. THE Invite_Dialog SHALL replace the single team dropdown with a multi-team selector that allows adding multiple team-role pairs.
5. WHEN the admin adds a team assignment, THE Invite_Dialog SHALL provide a team dropdown and a role dropdown for each assignment.
6. THE Invite_Dialog SHALL prevent adding the same team more than once.
7. THE Invite_Dialog SHALL fetch available SSO providers from the API to populate the auth method options.

### Requirement 8: SSO Provider Domain Mapping UI

**User Story:** As a system admin, I want to manage domain mapping rules within the SSO provider settings UI, so that I can configure auto-provisioning visually.

#### Acceptance Criteria

1. THE SSO_Provider_Dialog SHALL display a "Domain Mappings" section listing all existing domain mapping rules for the provider.
2. THE SSO_Provider_Dialog SHALL provide an "Add Mapping" button that displays a form with fields for domain, target team (dropdown), team role, and org role.
3. WHEN a domain mapping is added, THE SSO_Provider_Dialog SHALL validate the domain format on the client side before submitting.
4. THE SSO_Provider_Dialog SHALL provide edit and delete actions for each existing domain mapping rule.
5. WHEN a domain mapping is deleted, THE SSO_Provider_Dialog SHALL confirm the deletion before proceeding.
6. THE SSO_Provider_Dialog SHALL allow multiple domain mapping rules to share the same domain with different target teams.
7. THE SSO_Provider_Dialog SHALL provide a "Test Email" input field in the domain mappings section for previewing domain mapping outcomes.
8. WHEN an admin enters a test email and triggers the preview, THE SSO_Provider_Dialog SHALL display the matching rules and predicted team assignments returned by the preview endpoint.

### Requirement 9: Database Migration

**User Story:** As a developer, I want a database migration that adds all schema changes for invite auth provisioning, so that the new features have the required storage.

#### Acceptance Criteria

1. THE migration SHALL add an `allowed_auth` JSONB column to the invites table with a default value of `'["any"]'::jsonb`.
2. THE migration SHALL create the `invite_team_assignments` table with the schema specified in Requirement 3.1.
3. THE migration SHALL create an index on `invite_team_assignments(invite_id)` for efficient lookup of team assignments by invite.
4. THE migration SHALL create the `sso_domain_mappings` table with the schema specified in Requirement 4.1, using a UNIQUE constraint on `(provider_id, domain, team_id)` to support multi-team domain mappings.
5. THE migration SHALL create an index on `sso_domain_mappings(provider_id)` for efficient lookup of mappings by provider.
6. THE migration SHALL create an index on `sso_domain_mappings(domain)` for efficient lookup of mappings by domain during SSO login.
7. THE migration SHALL include a corresponding down migration that drops the `sso_domain_mappings` table, drops the `invite_team_assignments` table, and removes the `allowed_auth` column from the invites table.

### Requirement 10: Existing User SSO Passthrough

**User Story:** As an existing user, I want to continue logging in via SSO without being blocked by invite-only mode, so that my access is not disrupted when the admin enables invite-only registration.

#### Acceptance Criteria

1. WHILE Invite_Only_Mode is active, WHEN an existing user authenticates via SSO, THE Auth_Service SHALL skip the invite and domain mapping checks and proceed with normal login.
2. THE Auth_Service SHALL determine that a user is "existing" by finding a matching SSO identity record or a matching user email in the database before applying invite-only checks.

### Requirement 11: Audit Logging for Invite Auth Provisioning

**User Story:** As a system admin, I want audit logs for domain mapping changes and invite-only enforcement events, so that I can monitor and troubleshoot access control.

#### Acceptance Criteria

1. WHEN a domain mapping rule is created, updated, or deleted, THE Admin_Handler SHALL record an audit event with the action, provider ID, domain, and mapping details.
2. WHEN a registration is rejected due to invite-only mode, THE Auth_Service SHALL log the rejection with the user's email and the reason.
3. WHEN a registration is rejected due to auth method constraints, THE Auth_Service SHALL log the rejection with the user's email, the attempted auth method, and the allowed methods.
4. WHEN a user is auto-provisioned via domain mapping, THE Auth_Service SHALL log the provisioning with the user's email, matched domain, assigned team, and roles.
5. WHEN a bulk invite operation is performed, THE Org_Handler SHALL record an audit event with the inviter, org ID, email count, and summary of created/skipped/failed counts.
6. WHEN an invite is auto-revoked due to team archive or delete, THE Org_Service SHALL record an audit event with action `invite.auto_revoked`, the invite ID, email, team ID, and reason.
7. WHEN a team assignment is removed from a multi-team invite due to team archive or delete, THE Org_Service SHALL record an audit event with action `invite.team_assignment_removed`, the invite ID, email, team ID, and remaining assignment count.

### Requirement 12: Multi-Team Domain Mappings

**User Story:** As an org admin, I want a single email domain to map to multiple teams under the same SSO provider, so that users from trusted domains are automatically provisioned into all relevant teams upon first login.

#### Acceptance Criteria

1. THE `sso_domain_mappings` table SHALL use a UNIQUE constraint on `(provider_id, domain, team_id)` instead of `(provider_id, domain)`, allowing multiple rows with the same provider and domain but different team IDs.
2. WHEN creating a domain mapping, THE Admin_Handler SHALL allow a second mapping with the same `(provider_id, domain)` pair as long as the `team_id` is different from existing mappings.
3. WHEN a new user authenticates via SSO and the email domain matches domain mapping rules, THE SSO_Domain_Mapping_Repo SHALL return ALL matching rules for that provider and domain combination.
4. WHEN multiple domain mapping rules match during SSO auto-provisioning, THE Auth_Service SHALL create team memberships for ALL matching rules, provisioning the user into every mapped team simultaneously.
5. WHEN multiple domain mapping rules match during SSO auto-provisioning, THE Auth_Service SHALL use the `org_role` from the first matching rule for the org membership.
6. WHEN listing domain mappings for a provider, THE Admin_Handler SHALL return all mappings including multiple entries for the same domain with different teams.

### Requirement 13: Bulk Invites

**User Story:** As an org admin, I want to invite multiple users at once with shared configuration, so that I can efficiently onboard batches of new team members.

#### Acceptance Criteria

1. WHEN a POST request is made to `/orgs/{orgId}/invites/bulk`, THE Org_Handler SHALL accept a JSON payload containing an array of emails, a shared `org_role`, optional `allowed_auth`, and optional `team_assignments`.
2. WHEN processing a bulk invite request, THE Org_Service SHALL validate all emails in the batch before creating any invites.
3. WHEN processing a bulk invite request, THE Org_Service SHALL validate each email using the same rules as single invites: RFC format compliance, valid domain format, and MX or A record existence.
4. WHEN a bulk invite request contains an email that belongs to an existing org member, THE Org_Service SHALL skip that email and include it in the result with reason `"already_member"`.
5. WHEN a bulk invite request contains an email that already has a pending invite for the same org, THE Org_Service SHALL skip that email and include it in the result with reason `"already_invited"`.
6. WHEN processing valid emails in a bulk invite request, THE Org_Service SHALL create all invites within a single database transaction.
7. WHEN a bulk invite operation completes, THE Org_Service SHALL return a Bulk_Invite_Result containing the count of created invites, an array of skipped emails with reasons, and an array of failed emails with reasons.
8. THE Org_Service SHALL enforce that the sum of created, skipped, and failed counts equals the total number of non-blank emails in the request.
9. IF a bulk invite request contains more than 100 emails, THEN THE Org_Service SHALL reject the entire request with a validation error before processing any emails.
10. THE Org_Service SHALL apply the same `allowed_auth` and `team_assignments` configuration to all invites created within a single bulk request.
11. WHEN a bulk invite operation creates invites, THE Org_Service SHALL send invite emails asynchronously for all created invites.

### Requirement 14: Domain Mapping Dry-Run/Preview

**User Story:** As a system admin, I want to preview what would happen if a user with a specific email authenticated via SSO, so that I can verify domain mapping rules before they affect real users.

#### Acceptance Criteria

1. WHEN a POST request is made to `/admin/sso/domain-mappings/preview` with a valid email and provider name, THE Admin_Handler SHALL return a Domain_Mapping_Preview result.
2. THE Domain_Mapping_Preview result SHALL include the email, extracted email domain, provider name, an array of matching rules, a `would_bypass_invite` boolean, an array of predicted team assignments, and the org role that would be applied.
3. WHEN matching rules exist for the email domain and provider, THE Admin_Handler SHALL set `would_bypass_invite` to true in the preview result.
4. WHEN no matching rules exist for the email domain and provider, THE Admin_Handler SHALL set `would_bypass_invite` to false in the preview result.
5. THE domain mapping preview endpoint SHALL be read-only, producing no side effects on the database — no users, invites, memberships, or mappings are created, modified, or deleted.
6. THE Admin_Handler SHALL require the system admin role for the domain mapping preview endpoint.
7. IF the preview request references a nonexistent SSO provider, THEN THE Admin_Handler SHALL return HTTP 404 with a descriptive error message.
8. IF the preview request contains an invalid email format, THEN THE Admin_Handler SHALL return HTTP 400 with a descriptive error message.

### Requirement 15: Invite Revocation Cascade on Team Archive/Delete

**User Story:** As an org admin, I want pending invites to be automatically cleaned up when a team is archived or deleted, so that new users are not assigned to teams that no longer exist.

#### Acceptance Criteria

1. WHEN a team is archived or deleted, THE Team_Service SHALL trigger an Invite_Revocation_Cascade for that team.
2. WHEN the cascade finds a pending invite whose ONLY team assignment references the archived or deleted team, THE Org_Service SHALL delete the entire invite (auto-revoke).
3. WHEN the cascade finds a pending invite with multiple team assignments including the archived or deleted team, THE Org_Service SHALL remove only the team assignment for the affected team and keep the invite active with its remaining assignments.
4. THE Invite_Revocation_Cascade SHALL not affect invites that have already been accepted.
5. THE Invite_Revocation_Cascade SHALL also handle legacy invites that reference the team via the old `team_id` column by revoking those invites.
6. WHEN the cascade auto-revokes an invite, THE Org_Service SHALL record an audit log entry with action `invite.auto_revoked` including the invite ID, email, team ID, and reason.
7. WHEN the cascade removes a team assignment from a multi-team invite, THE Org_Service SHALL record an audit log entry with action `invite.team_assignment_removed` including the invite ID, email, team ID, and remaining assignment count.
8. THE Invite_Revocation_Cascade SHALL preserve all other invite fields (allowed_auth, email, org_role, expires_at) when removing a single team assignment from a multi-team invite.
