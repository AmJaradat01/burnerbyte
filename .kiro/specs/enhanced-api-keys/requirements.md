# Requirements Document

## Introduction

The BurnerByte API Keys system currently provides basic create, list, and revoke functionality with four scopes and SHA-256 hashed key storage. This enhancement addresses a scope mismatch bug, expands the scope model, adds key lifecycle management (get, update, enable/disable, rotate), introduces usage tracking and IP allowlisting, enriches the list response with creator info, and integrates expired key cleanup into the existing worker.

## Glossary

- **API_Key_Service**: The service layer (`internal/service/apikey_service.go`) responsible for API key business logic including generation, validation, rotation, and lifecycle management.
- **API_Key_Repository**: The data access layer (`internal/repository/postgres/apikey_repo.go`) responsible for persisting and querying API key records in PostgreSQL.
- **API_Key_Handler**: The HTTP handler layer (`internal/handler/apikey.go`) responsible for routing and processing API key REST endpoints.
- **Auth_Middleware**: The authentication middleware (`internal/auth/middleware.go`) responsible for validating API key tokens, enforcing expiration, checking IP allowlists, and populating user context.
- **Cleanup_Worker**: The background worker (`internal/worker/cleanup.go`) responsible for periodic deletion of expired resources.
- **Valid_Scopes_Map**: The map in API_Key_Service that defines all accepted scope strings for API key creation and updates.
- **Scope**: A permission string in the format `resource:action` that restricts what operations an API key can perform. Full set: `inbox:create`, `inbox:read`, `inbox:write`, `inbox:delete`, `email:read`, `email:write`, `email:delete`, `webhook:read`, `webhook:write`.
- **Key_Prefix**: The first 11 characters of a raw API key (e.g., `bb_a1b2c3d`) stored in plaintext for identification purposes.
- **Soft_Revoke**: Setting `revoked_at` and `revoked_by` on an API key record instead of deleting the row, preserving audit history.
- **IP_Allowlist**: A JSONB array of CIDR notation strings stored on an API key record that restricts which source IPs may use the key.

## Requirements

### Requirement 1: Fix Scope Mismatch Between Handlers and Valid Scopes

**User Story:** As a developer, I want the inbox and email handler scope checks to reference scopes that exist in the Valid_Scopes_Map, so that API key-authenticated requests are not incorrectly rejected.

#### Acceptance Criteria

1. WHEN the Inbox_Handler checks API key scopes for inbox creation, THE API_Key_Service Valid_Scopes_Map SHALL contain the `inbox:write` scope that the handler references.
2. WHEN the Inbox_Handler checks API key scopes for inbox deletion, THE API_Key_Service Valid_Scopes_Map SHALL contain the `inbox:write` scope that the handler references.
3. THE Valid_Scopes_Map SHALL contain all nine scopes: `inbox:create`, `inbox:read`, `inbox:write`, `inbox:delete`, `email:read`, `email:write`, `email:delete`, `webhook:read`, `webhook:write`.
4. WHEN the Email_Handler processes a mark-read or mark-unread request from an API key-authenticated user, THE Email_Handler SHALL check for the `email:write` scope before allowing the operation.

### Requirement 2: Expanded Scope Enforcement on All Endpoints

**User Story:** As a team lead, I want API key scopes enforced on all resource endpoints, so that keys with limited scopes cannot access unauthorized operations.

#### Acceptance Criteria

1. WHEN an API key-authenticated request reaches the Webhook_Handler create or update or delete endpoint, THE Webhook_Handler SHALL reject the request with HTTP 403 if the key lacks the `webhook:write` scope.
2. WHEN an API key-authenticated request reaches the Webhook_Handler list or delivery-logs endpoint, THE Webhook_Handler SHALL reject the request with HTTP 403 if the key lacks the `webhook:read` scope.
3. WHEN an API key-authenticated request reaches the Inbox_Handler list-my-inboxes or get-inbox endpoint, THE Inbox_Handler SHALL reject the request with HTTP 403 if the key lacks the `inbox:read` scope.
4. WHEN an API key-authenticated request reaches the Inbox_Handler delete endpoint, THE Inbox_Handler SHALL check for the `inbox:delete` scope instead of `inbox:write`.
5. WHEN an API key-authenticated request reaches the Inbox_Handler create endpoint, THE Inbox_Handler SHALL check for the `inbox:create` scope instead of `inbox:write`.

### Requirement 3: Get Single API Key Endpoint

**User Story:** As a team member, I want to retrieve the full details of a single API key by its ID, so that I can inspect its configuration without listing all keys.

#### Acceptance Criteria

1. WHEN a GET request is made to `/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}`, THE API_Key_Handler SHALL return the full API key record including name, description, scopes, key_prefix, is_active, allowed_ips, request_count, last_used_at, last_used_ip, expires_at, created_at, revoked_at, and creator info.
2. WHEN the requested key ID does not belong to the specified team, THE API_Key_Handler SHALL return HTTP 404.
3. THE API_Key_Handler SHALL require the caller to have at minimum the OrgMember or TeamMember role.
4. THE API_Key_Handler SHALL join the creator's email and display_name from the users table in the response.

### Requirement 4: Update API Key Endpoint

**User Story:** As a team lead, I want to update an API key's name, description, scopes, and expiration, so that I can adjust key configuration without revoking and recreating.

#### Acceptance Criteria

1. WHEN a PATCH request is made to `/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}` with a new name, THE API_Key_Service SHALL update the key's name.
2. WHEN a PATCH request includes a new description, THE API_Key_Service SHALL update the key's description.
3. WHEN a PATCH request includes new scopes, THE API_Key_Service SHALL validate each scope against the Valid_Scopes_Map and update the key's scopes.
4. WHEN a PATCH request includes an invalid scope, THE API_Key_Service SHALL return an error identifying the invalid scope.
5. WHEN a PATCH request includes a new expires_at timestamp, THE API_Key_Service SHALL update the key's expiration.
6. THE API_Key_Handler SHALL require the caller to have the OrgAdmin or TeamLead role.
7. WHEN the requested key ID does not belong to the specified team, THE API_Key_Handler SHALL return HTTP 404.
8. IF the key has been revoked (revoked_at is set), THEN THE API_Key_Service SHALL reject the update with an error.

### Requirement 5: Description Field

**User Story:** As a developer, I want to add a longer description to API keys, so that I can document the purpose and usage context of each key.

#### Acceptance Criteria

1. THE API_Key_Repository SHALL store a `description` TEXT column on the api_keys table.
2. WHEN creating an API key, THE API_Key_Service SHALL accept an optional `description` field in the input.
3. WHEN listing or getting API keys, THE API_Key_Handler SHALL include the description in the response.

### Requirement 6: Enable/Disable Toggle (Soft Revoke)

**User Story:** As a team lead, I want to temporarily disable an API key and re-enable it later, so that I can suspend access without permanently losing the key configuration.

#### Acceptance Criteria

1. THE API_Key_Repository SHALL store an `is_active` BOOLEAN column on the api_keys table, defaulting to TRUE.
2. WHEN a PATCH request sets `is_active` to false, THE API_Key_Service SHALL deactivate the key.
3. WHEN a PATCH request sets `is_active` to true, THE API_Key_Service SHALL reactivate the key.
4. WHEN the Auth_Middleware resolves an API key that has `is_active` set to false, THE Auth_Middleware SHALL reject the request with HTTP 401 and the message "API key disabled".
5. IF the key has been revoked (revoked_at is set), THEN THE API_Key_Service SHALL reject reactivation with an error.

### Requirement 7: Revoke with History (Soft Delete)

**User Story:** As an org admin, I want revoking an API key to preserve the record with a revocation timestamp and revoker identity, so that I have a complete audit trail.

#### Acceptance Criteria

1. THE API_Key_Repository SHALL store `revoked_at` TIMESTAMPTZ and `revoked_by` UUID columns on the api_keys table.
2. WHEN a DELETE request is made to the revoke endpoint, THE API_Key_Service SHALL set `revoked_at` to the current timestamp and `revoked_by` to the requesting user's ID instead of deleting the row.
3. WHEN the Auth_Middleware resolves an API key that has `revoked_at` set, THE Auth_Middleware SHALL reject the request with HTTP 401 and the message "API key revoked".
4. WHEN listing API keys, THE API_Key_Repository SHALL exclude revoked keys by default.
5. WHEN listing API keys with a `include_revoked=true` query parameter, THE API_Key_Repository SHALL include revoked keys in the response.

### Requirement 8: Key Rotation

**User Story:** As a team lead, I want to rotate an API key's secret without changing its ID, name, scopes, or other configuration, so that I can cycle credentials on a schedule.

#### Acceptance Criteria

1. WHEN a POST request is made to `/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}/rotate`, THE API_Key_Service SHALL generate a new 32-byte random secret with the `bb_` prefix.
2. THE API_Key_Service SHALL replace the key's `key_hash` and `key_prefix` with values derived from the new secret.
3. THE API_Key_Service SHALL return the new raw key in the response exactly once (the raw key is not stored).
4. THE API_Key_Handler SHALL require the caller to have the OrgAdmin or TeamLead role.
5. IF the key has been revoked or is inactive, THEN THE API_Key_Service SHALL reject the rotation with an error.
6. WHEN the requested key ID does not belong to the specified team, THE API_Key_Handler SHALL return HTTP 404.

### Requirement 9: Usage Tracking

**User Story:** As a team lead, I want to see how many requests each API key has made and from which IP address, so that I can monitor key usage and detect anomalies.

#### Acceptance Criteria

1. THE API_Key_Repository SHALL store a `request_count` BIGINT column on the api_keys table, defaulting to 0.
2. THE API_Key_Repository SHALL store a `last_used_ip` TEXT column on the api_keys table.
3. WHEN the Auth_Middleware successfully authenticates a request with an API key, THE Auth_Middleware SHALL increment the key's `request_count` by 1 and update `last_used_ip` with the request's remote IP address.
4. WHEN listing or getting API keys, THE API_Key_Handler SHALL include `request_count`, `last_used_at`, and `last_used_ip` in the response.

### Requirement 10: Creator Info in Responses

**User Story:** As a team member, I want to see who created each API key in the list and detail views, so that I can identify key ownership.

#### Acceptance Criteria

1. WHEN listing API keys, THE API_Key_Repository SHALL join the users table to include the creator's email and display_name.
2. WHEN getting a single API key, THE API_Key_Repository SHALL join the users table to include the creator's email and display_name.
3. THE API_Key_Handler SHALL include `created_by_email` and `created_by_name` fields in the API key JSON response.

### Requirement 11: IP Allowlist

**User Story:** As a security-conscious team lead, I want to restrict an API key to specific IP addresses or CIDR ranges, so that stolen keys cannot be used from unauthorized networks.

#### Acceptance Criteria

1. THE API_Key_Repository SHALL store an `allowed_ips` JSONB column on the api_keys table, defaulting to NULL (no restriction).
2. WHEN creating or updating an API key with an `allowed_ips` array, THE API_Key_Service SHALL validate that each entry is a valid IPv4 address, IPv6 address, or CIDR notation string.
3. IF an API key has a non-empty `allowed_ips` list, THEN THE Auth_Middleware SHALL reject requests from IP addresses not matching any entry with HTTP 403 and the message "IP not allowed for this API key".
4. WHEN `allowed_ips` is NULL or empty, THE Auth_Middleware SHALL allow requests from any IP address.
5. IF an `allowed_ips` entry is not a valid IP or CIDR string, THEN THE API_Key_Service SHALL return a validation error identifying the invalid entry.

### Requirement 12: Expired Key Cleanup

**User Story:** As a platform operator, I want expired API keys to be automatically cleaned up, so that the database does not accumulate stale key records.

#### Acceptance Criteria

1. WHEN the Cleanup_Worker runs its periodic cycle, THE Cleanup_Worker SHALL delete API key records where `expires_at` is in the past and `revoked_at` is already set, or where `expires_at` is more than 30 days in the past.
2. WHEN expired keys are deleted, THE Cleanup_Worker SHALL log the count of deleted keys.
3. THE Cleanup_Worker SHALL not delete keys that are expired but still within the 30-day grace period and have not been revoked.

### Requirement 13: Bulk Revoke

**User Story:** As a team lead, I want to revoke multiple API keys in a single request, so that I can efficiently clean up keys during team offboarding or security incidents.

#### Acceptance Criteria

1. WHEN a POST request is made to `/orgs/{orgId}/teams/{teamId}/api-keys/bulk-revoke` with an array of key IDs, THE API_Key_Service SHALL soft-revoke each key that belongs to the specified team.
2. THE API_Key_Service SHALL skip key IDs that do not belong to the specified team and include them in a `skipped` array in the response.
3. THE API_Key_Service SHALL skip key IDs that are already revoked and include them in the `skipped` array.
4. THE API_Key_Handler SHALL require the caller to have the OrgAdmin or TeamLead role.
5. THE API_Key_Handler SHALL return the count of successfully revoked keys and the list of skipped key IDs.

### Requirement 14: Database Migration for Schema Changes

**User Story:** As a developer, I want a single migration that adds all new columns and indexes to the api_keys table, so that the schema supports all enhanced features.

#### Acceptance Criteria

1. THE migration SHALL add the following columns to the api_keys table: `description TEXT`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`, `revoked_at TIMESTAMPTZ`, `revoked_by UUID REFERENCES users(id)`, `request_count BIGINT NOT NULL DEFAULT 0`, `last_used_ip TEXT`, `allowed_ips JSONB`.
2. THE migration SHALL add an index on `is_active` for filtering active keys.
3. THE migration SHALL add an index on `revoked_at` for filtering revoked keys.
4. THE migration SHALL include a corresponding down migration that removes all added columns and indexes.
