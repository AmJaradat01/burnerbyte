# Requirements Document

## Introduction

The BurnerByte domains system currently provides basic CRUD operations, DNS verification (MX + TXT records) with manual trigger, a single domain setting (`attachments_enabled` with inherit/enabled/disabled), delete impact check (active inboxes only), joined counts in list/get (active_inboxes, inboxes_created_count, team_count), a background DNS recheck worker, and verification record generation. This enhancement adds domain search and filtering, extended domain-level settings participating in the settings cascade, a computed domain status field, domain description/notes, enriched impact checks, auto-verify on create, bulk domain operations, domain transfer between organizations, SPF record verification, verification history logging, enriched detail responses, and domain-level analytics.

## Glossary

- **Domain_Service**: The service layer (`internal/service/domain_service.go`) responsible for domain business logic including creation, updates, verification, transfers, and deletion.
- **Domain_Repository**: The data access layer (`internal/repository/postgres/domain_repo.go`) responsible for persisting and querying domain records in PostgreSQL.
- **Domain_Handler**: The HTTP handler layer (`internal/handler/domain.go`) responsible for routing and processing domain REST endpoints.
- **DNS_Verifier**: The DNS verification module (`internal/dns/verifier.go`) responsible for performing MX, TXT, and SPF DNS lookups.
- **DNS_Recheck_Worker**: The background worker (`internal/worker/dns_recheck.go`) responsible for periodically re-verifying DNS records for all domains.
- **Settings_Resolver**: The settings cascade resolver (`internal/service/settings_resolver.go`) responsible for walking the assignment → domain → org → system default cascade.
- **RBAC_Checker**: The role-based access control module (`internal/auth/rbac/rbac.go`) responsible for validating org-level role permissions.
- **Domain_Settings**: The JSONB settings object on the domains table containing domain-level configuration overrides (attachments_enabled, default_inbox_ttl, max_inbox_ttl, max_inboxes_per_domain).
- **Domain_Status**: A computed string field derived from `mx_verified` and `txt_verified` booleans, with values: `pending_verification`, `verified`, `partially_verified`, `failed`.
- **Verification_History**: A table recording each DNS verification attempt with timestamp, results per record type, and the trigger source (manual, auto-create, background worker).
- **Impact_Summary**: A read-only preview of all resources affected by deleting a domain, including counts of total inboxes, active inboxes, total emails, domain assignments with team names.
- **SPF_Record**: A DNS TXT record starting with `v=spf1` that specifies authorized mail senders for a domain, used for email deliverability monitoring.

## Requirements

### Requirement 1: Domain Search and Filter on List

**User Story:** As an org member, I want to search domains by name and filter by verification status, so that I can quickly find the domain I need in organizations with many domains.

#### Acceptance Criteria

1. WHEN a `search` query parameter is provided on the list domains endpoint, THE Domain_Repository SHALL filter domains whose `domain_name` contains the search term (case-insensitive).
2. WHEN a `status` query parameter is provided with a value of `verified`, THE Domain_Repository SHALL return only domains where both `mx_verified` and `txt_verified` are TRUE.
3. WHEN a `status` query parameter is provided with a value of `pending_verification`, THE Domain_Repository SHALL return only domains where both `mx_verified` and `txt_verified` are FALSE and `dns_last_checked_at` is NULL.
4. WHEN a `status` query parameter is provided with a value of `partially_verified`, THE Domain_Repository SHALL return only domains where exactly one of `mx_verified` or `txt_verified` is TRUE.
5. WHEN a `status` query parameter is provided with a value of `failed`, THE Domain_Repository SHALL return only domains where both `mx_verified` and `txt_verified` are FALSE and `dns_last_checked_at` is not NULL.
6. WHEN both `search` and `status` query parameters are provided, THE Domain_Repository SHALL apply both filters.
7. THE Domain_Repository SHALL continue to support pagination alongside search and filter parameters.

### Requirement 2: Extended Domain Settings

**User Story:** As an org admin, I want to configure default inbox TTL, maximum inbox TTL, and maximum inboxes per domain at the domain level, so that I can control resource usage per domain within the settings cascade.

#### Acceptance Criteria

1. THE Domain_Settings SHALL support a `default_inbox_ttl` field (string duration format, e.g., "1h", "24h") that overrides the org-level default when creating inboxes under this domain.
2. THE Domain_Settings SHALL support a `max_inbox_ttl` field (string duration format) that limits the maximum TTL for inboxes under this domain.
3. THE Domain_Settings SHALL support a `max_inboxes_per_domain` field (integer) that limits how many active inboxes can exist under this domain.
4. WHEN updating domain settings, THE Domain_Service SHALL validate that `default_inbox_ttl` is a valid Go duration string.
5. WHEN updating domain settings, THE Domain_Service SHALL validate that `max_inbox_ttl` is a valid Go duration string.
6. WHEN updating domain settings, THE Domain_Service SHALL validate that `max_inboxes_per_domain` is a positive integer when provided.
7. IF `default_inbox_ttl` exceeds the resolved `max_inbox_ttl` for the domain, THEN THE Domain_Service SHALL return a validation error.
8. THE Settings_Resolver SHALL include the domain level in the cascade for `default_inbox_ttl`: assignment → domain → org → system default.
9. THE Settings_Resolver SHALL include the domain level in the cascade for `max_inbox_ttl`: assignment → domain → org → system default.
10. THE Settings_Resolver SHALL include the domain level in the cascade for `max_inboxes_per_domain`: assignment → domain → org → system default.

### Requirement 3: Domain Status Field

**User Story:** As an org member, I want a single status field on each domain, so that I can understand the verification state at a glance without interpreting multiple boolean fields.

#### Acceptance Criteria

1. WHEN retrieving a domain, THE Domain_Service SHALL compute a `status` field with value `verified` when both `mx_verified` and `txt_verified` are TRUE.
2. WHEN retrieving a domain, THE Domain_Service SHALL compute a `status` field with value `pending_verification` when both `mx_verified` and `txt_verified` are FALSE and `dns_last_checked_at` is NULL.
3. WHEN retrieving a domain, THE Domain_Service SHALL compute a `status` field with value `partially_verified` when exactly one of `mx_verified` or `txt_verified` is TRUE.
4. WHEN retrieving a domain, THE Domain_Service SHALL compute a `status` field with value `failed` when both `mx_verified` and `txt_verified` are FALSE and `dns_last_checked_at` is not NULL.
5. THE Domain_Handler SHALL include the computed `status` field in all domain responses (list, get, create, update, verify).

### Requirement 4: Domain Description and Notes

**User Story:** As an org admin, I want to add a description to a domain, so that team members can understand the domain's purpose and configuration notes.

#### Acceptance Criteria

1. THE Domain_Repository SHALL store a `description` TEXT column on the domains table.
2. WHEN creating a domain, THE Domain_Service SHALL accept an optional `description` field in the input.
3. WHEN updating a domain, THE Domain_Service SHALL accept an optional `description` field in the input.
4. WHEN retrieving or listing domains, THE Domain_Handler SHALL include `description` in the response.
5. THE Domain_Service SHALL validate that `description` does not exceed 1000 characters.

### Requirement 5: Enriched Impact Check

**User Story:** As an org admin, I want the domain impact check to show comprehensive resource counts before deletion, so that I can make an informed decision about permanent deletion.

#### Acceptance Criteria

1. WHEN a GET request is made to `/orgs/{orgId}/domains/{domainId}/impact`, THE Domain_Handler SHALL return an Impact_Summary.
2. THE Impact_Summary SHALL include `active_inbox_count` (inboxes that are active and not expired).
3. THE Impact_Summary SHALL include `total_inbox_count` (all inboxes, active and expired).
4. THE Impact_Summary SHALL include `total_email_count` (all emails across all inboxes for this domain).
5. THE Impact_Summary SHALL include `assignment_count` (number of domain assignments).
6. THE Impact_Summary SHALL include `assignments` array with each entry containing `team_id`, `team_name`, and `access_level`.
7. THE Domain_Handler SHALL require the OrgAdmin role or higher to access the impact endpoint.
8. WHEN the domain does not exist or does not belong to the specified org, THE Domain_Handler SHALL return HTTP 404.

### Requirement 6: Auto-Verify on Create

**User Story:** As an org admin, I want DNS verification to be triggered automatically after creating a domain, so that domains with pre-configured DNS records are verified without a separate manual step.

#### Acceptance Criteria

1. WHEN a domain is successfully created, THE Domain_Service SHALL trigger an asynchronous DNS verification check for the new domain.
2. THE Domain_Service SHALL not block the create response on the DNS verification result.
3. THE Domain_Service SHALL update the domain's `mx_verified`, `txt_verified`, and `dns_last_checked_at` fields with the verification results.
4. IF the asynchronous DNS verification fails (network error or timeout), THEN THE Domain_Service SHALL log the error and leave the domain in `pending_verification` status.

### Requirement 7: Bulk Domain Operations

**User Story:** As an org admin, I want to verify multiple domains at once and delete multiple domains at once, so that I can efficiently manage domains during bulk DNS configuration or cleanup.

#### Acceptance Criteria

1. WHEN a POST request is made to `/orgs/{orgId}/domains/bulk-verify` with an array of domain IDs, THE Domain_Service SHALL trigger DNS verification for each specified domain.
2. THE Domain_Handler SHALL return a results array with each entry containing the domain ID, domain name, and updated verification status.
3. THE Domain_Service SHALL skip domain IDs that do not exist or do not belong to the org and include them in a `failed` array with the reason.
4. WHEN a POST request is made to `/orgs/{orgId}/domains/bulk-delete` with an array of domain IDs, THE Domain_Service SHALL delete each specified domain.
5. THE Domain_Service SHALL skip domains that have active inboxes (unless `force` is set to TRUE in the request body) and include them in a `skipped` array with the reason.
6. THE Domain_Handler SHALL return the count of successfully deleted domains, plus the `skipped` and `failed` arrays.
7. THE Domain_Handler SHALL require the OrgAdmin role or higher for both bulk-verify and bulk-delete operations.
8. THE Domain_Handler SHALL limit bulk operations to a maximum of 50 domain IDs per request.

### Requirement 8: Domain Transfer Between Organizations

**User Story:** As a system admin, I want to transfer a domain from one organization to another, so that I can reorganize domains during corporate restructuring without recreating them.

#### Acceptance Criteria

1. WHEN a POST request is made to `/orgs/{orgId}/domains/{domainId}/transfer` with a `target_org_id`, THE Domain_Service SHALL move the domain to the target organization.
2. THE Domain_Service SHALL validate that the target organization exists and has not reached its domain limit.
3. THE Domain_Service SHALL remove all domain assignments for the domain (assignments belong to teams in the source org and cannot transfer).
4. THE Domain_Service SHALL clean up Redis inbox keys for all active inboxes under the domain being transferred.
5. THE Domain_Service SHALL deactivate all active inboxes under the domain (inboxes belong to users in the source org context).
6. THE Domain_Service SHALL update the domain's `org_id` to the target organization's ID.
7. THE Domain_Handler SHALL require the system admin role to perform a transfer.
8. WHEN a transfer completes, THE Domain_Handler SHALL record audit events in both the source and target organizations.
9. THE Domain_Handler SHALL return the updated domain and a summary including `removed_assignments_count` and `deactivated_inboxes_count`.

### Requirement 9: SPF Record Verification

**User Story:** As an org admin, I want SPF record verification alongside MX and TXT checks, so that I can monitor email deliverability configuration for my domains.

#### Acceptance Criteria

1. THE DNS_Verifier SHALL provide a `VerifySPF` function that checks if the domain has a TXT record starting with `v=spf1` that includes the expected hostname.
2. THE Domain_Repository SHALL store an `spf_verified` BOOLEAN column on the domains table, defaulting to FALSE.
3. WHEN DNS verification is triggered (manual, auto-create, or background worker), THE Domain_Service SHALL check SPF records in addition to MX and TXT records.
4. THE Domain_Service SHALL update the `spf_verified` field alongside `mx_verified` and `txt_verified`.
5. THE Domain_Handler SHALL include `spf_verified` in all domain responses.
6. THE Domain_Status computation SHALL consider `spf_verified` as informational only (the status is still derived from `mx_verified` and `txt_verified` only, since SPF is for deliverability monitoring).

### Requirement 10: Verification History

**User Story:** As an org admin, I want to see a log of past DNS verification attempts and results, so that I can debug DNS configuration issues over time.

#### Acceptance Criteria

1. THE Domain_Repository SHALL store verification history in a `domain_verification_history` table with columns: `id`, `domain_id`, `checked_at`, `mx_result` (boolean), `txt_result` (boolean), `spf_result` (boolean), `trigger_source` (enum: `manual`, `auto_create`, `background`), and `error_details` (text, nullable).
2. WHEN a DNS verification is performed, THE Domain_Service SHALL insert a record into the verification history table with the results and trigger source.
3. WHEN a GET request is made to `/orgs/{orgId}/domains/{domainId}/verification-history`, THE Domain_Handler SHALL return the verification history for the domain, ordered by `checked_at` descending.
4. THE Domain_Handler SHALL support pagination on the verification history endpoint.
5. THE Domain_Handler SHALL require the OrgAdmin role or higher to access the verification history endpoint.
6. WHEN the domain does not exist or does not belong to the specified org, THE Domain_Handler SHALL return HTTP 404.

### Requirement 11: Enriched Detail Response

**User Story:** As an org member, I want the domain detail endpoint to return comprehensive resource counts and assignment details, so that I can understand the domain's scope without making multiple API calls.

#### Acceptance Criteria

1. WHEN a GET request is made to the domain detail endpoint, THE Domain_Handler SHALL return `total_inboxes` (all inboxes, active and expired) in addition to the existing `active_inboxes`.
2. WHEN a GET request is made to the domain detail endpoint, THE Domain_Handler SHALL return `total_emails` (count of all emails across all inboxes for this domain).
3. WHEN a GET request is made to the domain detail endpoint, THE Domain_Handler SHALL return an `assignments` array with each entry containing `team_id`, `team_name`, and `access_level`.
4. THE Domain_Repository SHALL compute `total_inboxes` by counting all inboxes (active and expired) associated with the domain.
5. THE Domain_Repository SHALL compute `total_emails` by counting all emails in inboxes associated with the domain.
6. THE Domain_Repository SHALL retrieve assignment details with team names by joining domain_assignments with teams.

### Requirement 12: Domain-Level Analytics

**User Story:** As an org admin, I want to see domain-specific analytics including emails received count, so that I can understand domain usage patterns.

#### Acceptance Criteria

1. WHEN a GET request is made to the domain detail endpoint, THE Domain_Handler SHALL return `emails_received_count` from the persistent analytics counters.
2. THE Domain_Repository SHALL retrieve `emails_received_count` from the `org_analytics_counters` table filtered by the domain ID dimension.
3. WHEN no analytics counter exists for a domain, THE Domain_Handler SHALL return `emails_received_count` as 0.

### Requirement 13: Database Migration for Schema Changes

**User Story:** As a developer, I want a single migration that adds all new columns, tables, and indexes to support the enhanced domains features, so that the schema supports all enhanced features.

#### Acceptance Criteria

1. THE migration SHALL add the following columns to the domains table: `description TEXT`, `spf_verified BOOLEAN NOT NULL DEFAULT FALSE`.
2. THE migration SHALL add a GIN trigram index on `domain_name` for case-insensitive search (requires `pg_trgm` extension).
3. THE migration SHALL create a `domain_verification_history` table with columns: `id UUID PRIMARY KEY`, `domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE`, `checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `mx_result BOOLEAN NOT NULL`, `txt_result BOOLEAN NOT NULL`, `spf_result BOOLEAN NOT NULL`, `trigger_source VARCHAR(20) NOT NULL`, `error_details TEXT`.
4. THE migration SHALL add an index on `domain_verification_history(domain_id, checked_at DESC)` for efficient history queries.
5. THE migration SHALL include a corresponding down migration that removes all added columns, tables, and indexes.
