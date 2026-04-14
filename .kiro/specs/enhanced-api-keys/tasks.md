# Implementation Plan: Enhanced API Keys

## Overview

This plan implements the full enhanced API key lifecycle for BurnerByte: database migration, domain model expansion, repository methods (CRUD + soft-revoke + rotation + bulk-revoke + cleanup), service-layer business logic (scope validation, IP/CIDR validation, key rotation, enable/disable), handler endpoints (Get, Update, Rotate, BulkRevoke), middleware hardening (revoked/disabled/IP checks, usage tracking), scope enforcement across inbox/email/webhook handlers, expired key cleanup in the worker, and route registration in main.go. All code is Go, targeting the existing Chi/PostgreSQL/pgx architecture.

## Tasks

- [x] 1. Database migration for enhanced API keys schema
  - [x] 1.1 Create migration 000032_enhanced_api_keys.up.sql
    - Add columns to `api_keys` table: `description TEXT`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`, `revoked_at TIMESTAMPTZ`, `revoked_by UUID REFERENCES users(id)`, `request_count BIGINT NOT NULL DEFAULT 0`, `last_used_ip TEXT`, `allowed_ips JSONB`
    - Add index `idx_api_keys_is_active` on `is_active`
    - Add index `idx_api_keys_revoked_at` on `revoked_at`
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 1.2 Create migration 000032_enhanced_api_keys.down.sql
    - Drop indexes `idx_api_keys_revoked_at` and `idx_api_keys_is_active`
    - Drop columns `allowed_ips`, `last_used_ip`, `request_count`, `revoked_by`, `revoked_at`, `is_active`, `description` in reverse order
    - _Requirements: 14.4_

- [x] 2. Domain model updates (`internal/domain/apikey.go`)
  - [x] 2.1 Expand the `APIKey` struct with new fields
    - Add `Description *string`, `IsActive bool`, `AllowedIPs []string`, `RequestCount int64`, `LastUsedIP *string`, `RevokedAt *time.Time`, `RevokedBy *uuid.UUID`, `CreatedByEmail string`, `CreatedByName string`
    - Ensure JSON tags match the design: `description`, `is_active`, `allowed_ips`, `request_count`, `last_used_ip`, `revoked_at`, `revoked_by`, `created_by_email`, `created_by_name`
    - _Requirements: 5.1, 6.1, 7.1, 9.1, 9.2, 10.3, 11.1_

  - [x] 2.2 Update `CreateAPIKeyInput` and add `UpdateAPIKeyInput`, `BulkRevokeInput`, `BulkRevokeResult`
    - Add `Description *string` and `AllowedIPs []string` fields to `CreateAPIKeyInput`
    - Create `UpdateAPIKeyInput` struct with optional fields: `Name *string`, `Description *string`, `Scopes []string`, `IsActive *bool`, `ExpiresAt *string`, `AllowedIPs *[]string`
    - Create `BulkRevokeInput` struct with `KeyIDs []uuid.UUID`
    - Create `BulkRevokeResult` struct with `Revoked int` and `Skipped []uuid.UUID`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 5.2, 6.2, 6.3, 11.2, 13.1, 13.5_

- [x] 3. Repository layer updates (`internal/repository/postgres/apikey_repo.go`)
  - [x] 3.1 Update `Create` method to include new columns
    - Extend INSERT to include `description`, `is_active`, `allowed_ips` columns
    - Marshal `allowed_ips` as JSONB alongside existing `scopes` marshaling
    - _Requirements: 5.2, 6.1, 11.1_

  - [x] 3.2 Update `GetByID` to SELECT new columns and JOIN users for creator info
    - Add `description`, `is_active`, `allowed_ips`, `request_count`, `last_used_ip`, `revoked_at`, `revoked_by` to SELECT
    - JOIN `users` table on `created_by` to fetch `email` as `created_by_email` and `display_name` as `created_by_name`
    - Unmarshal `allowed_ips` JSONB into `[]string`
    - _Requirements: 3.1, 3.4, 9.4, 10.2_

  - [x] 3.3 Update `GetByHash` to SELECT new columns needed by middleware
    - Add `is_active`, `revoked_at`, `allowed_ips`, `request_count`, `last_used_ip` to SELECT
    - Unmarshal `allowed_ips` JSONB
    - _Requirements: 6.4, 7.3, 11.3_

  - [x] 3.4 Update `ListByTeam` to support revoked filter and JOIN users
    - Add `includeRevoked bool` parameter
    - When `includeRevoked` is false, add `WHERE revoked_at IS NULL` to both COUNT and SELECT queries
    - JOIN `users` table for `created_by_email` and `created_by_name`
    - Add all new columns to SELECT and Scan
    - _Requirements: 7.4, 7.5, 10.1_

  - [x] 3.5 Implement `Update` method for partial updates
    - Build dynamic SET clause based on non-nil fields in `UpdateAPIKeyInput`
    - Handle `name`, `description`, `scopes` (JSON marshal), `is_active`, `expires_at` (parse timestamp), `allowed_ips` (JSON marshal)
    - Use parameterized query with positional args
    - Return error if no fields provided
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 6.2, 6.3_

  - [x] 3.6 Implement `SoftRevoke` method
    - `UPDATE api_keys SET revoked_at = NOW(), revoked_by = $2 WHERE id = $1`
    - Return error if key not found
    - _Requirements: 7.2_

  - [x] 3.7 Implement `BulkSoftRevoke` method
    - Accept `teamID uuid.UUID`, `ids []uuid.UUID`, `revokedBy uuid.UUID`
    - Execute `UPDATE api_keys SET revoked_at = NOW(), revoked_by = $1 WHERE id = ANY($2) AND team_id = $3 AND revoked_at IS NULL`
    - Determine skipped IDs by comparing input IDs against affected rows
    - Return count of revoked and slice of skipped IDs
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 3.8 Implement `RotateKey` method
    - `UPDATE api_keys SET key_hash = $2, key_prefix = $3 WHERE id = $1`
    - Return error if key not found
    - _Requirements: 8.2_

  - [x] 3.9 Replace `UpdateLastUsed` with `UpdateLastUsedWithTracking`
    - New signature: `UpdateLastUsedWithTracking(ctx context.Context, id uuid.UUID, ip string) error`
    - SQL: `UPDATE api_keys SET last_used_at = NOW(), request_count = request_count + 1, last_used_ip = $2 WHERE id = $1`
    - Keep old `UpdateLastUsed` method but mark as deprecated or remove
    - _Requirements: 9.3_

  - [x] 3.10 Implement `DeleteExpiredKeys` method
    - SQL: `DELETE FROM api_keys WHERE (expires_at < NOW() AND revoked_at IS NOT NULL) OR (expires_at < NOW() - INTERVAL '30 days')`
    - Return count of deleted rows
    - _Requirements: 12.1, 12.3_

- [x] 4. Checkpoint — Verify migration and repository compile
  - Ensure all code compiles, ask the user if questions arise.

- [x] 5. Service layer updates (`internal/service/apikey_service.go`)
  - [x] 5.1 Expand `validScopes` map to include all 9 scopes
    - Add `inbox:write`, `inbox:delete`, `email:write`, `webhook:read`, `webhook:write` to the existing map
    - _Requirements: 1.3_

  - [x] 5.2 Implement `ValidateIPs` function
    - Accept `[]string`, validate each entry as valid IPv4, IPv6, or CIDR using `net.ParseIP` and `net.ParseCIDR`
    - Return error identifying the specific invalid entry
    - _Requirements: 11.2, 11.5_

  - [x] 5.3 Update `Generate` method to accept description and allowed_ips
    - Add `Description` and `AllowedIPs` from `CreateAPIKeyInput` to the created `APIKey`
    - Call `ValidateIPs` if `AllowedIPs` is non-empty
    - Set `IsActive: true` on the new key
    - _Requirements: 5.2, 11.2_

  - [x] 5.4 Implement `Get` method
    - Accept `teamID` and `keyID`, call `repo.GetByID`
    - Return 404-style error if key's `TeamID` doesn't match
    - _Requirements: 3.1, 3.2_

  - [x] 5.5 Implement `Update` method
    - Accept `teamID`, `keyID`, and `UpdateAPIKeyInput`
    - Fetch key by ID, verify team ownership (404 if mismatch)
    - Reject if `revoked_at` is set ("cannot modify revoked key")
    - Validate scopes against `validScopes` if provided
    - Validate IPs via `ValidateIPs` if provided
    - Call `repo.Update`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 6.2, 6.3, 6.5_

  - [x] 5.6 Implement `Rotate` method
    - Accept `teamID` and `keyID`
    - Fetch key, verify team ownership (404 if mismatch)
    - Reject if revoked or inactive ("cannot rotate inactive key" / "cannot modify revoked key")
    - Generate new 32-byte random secret with `bb_` prefix
    - Compute SHA-256 hash, extract prefix
    - Call `repo.RotateKey` with new hash and prefix
    - Return the new raw key in the response
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6_

  - [x] 5.7 Implement `BulkRevoke` method
    - Accept `teamID`, `userID`, and `BulkRevokeInput`
    - Validate `KeyIDs` is non-empty
    - Call `repo.BulkSoftRevoke`
    - Return `BulkRevokeResult` with revoked count and skipped IDs
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 5.8 Update `List` method to accept `includeRevoked` parameter
    - Pass `includeRevoked` through to `repo.ListByTeam`
    - _Requirements: 7.4, 7.5_

  - [x] 5.9 Update `Revoke` method to use soft-revoke
    - Accept `userID` parameter in addition to `teamID` and `keyID`
    - Replace `repo.Delete` call with `repo.SoftRevoke(ctx, id, userID)`
    - _Requirements: 7.2_

  - [x] 5.10 Update `ValidateAndResolve` to check `is_active`, `revoked_at`, and pass IP for tracking
    - After fetching key by hash, check `key.RevokedAt != nil` → error "API key revoked"
    - Check `!key.IsActive` → error "API key disabled"
    - Accept `remoteIP string` parameter
    - Replace `repo.UpdateLastUsed` with `repo.UpdateLastUsedWithTracking(ctx, key.ID, remoteIP)`
    - _Requirements: 6.4, 7.3, 9.3_

  - [x] 5.11 Write property test for scope map completeness (Property 1)
    - **Property 1: Scope Map Completeness**
    - Generate random strings, verify valid scopes return true and invalid scopes return false
    - **Validates: Requirements 1.3**

  - [x] 5.12 Write property test for scope validation on mutation (Property 4)
    - **Property 4: Scope Validation on Mutation**
    - Generate random string arrays mixing valid/invalid scopes, verify create/update accept or reject correctly
    - **Validates: Requirements 4.3, 4.4**

  - [x] 5.13 Write property test for IP and CIDR validation (Property 12)
    - **Property 12: IP and CIDR Validation**
    - Generate random valid IPv4/IPv6/CIDR strings and invalid strings, verify `ValidateIPs` accepts or rejects correctly
    - **Validates: Requirements 11.2, 11.5**

- [x] 6. Checkpoint — Verify service layer compiles
  - Ensure all code compiles, ask the user if questions arise.

- [x] 7. Handler layer updates (`internal/handler/apikey.go`)
  - [x] 7.1 Update `Create` handler to pass description and allowed_ips
    - The existing handler already decodes `CreateAPIKeyInput`; the new fields will be picked up automatically from the expanded struct
    - Ensure error responses for invalid IPs/scopes return HTTP 400
    - _Requirements: 5.2, 11.2_

  - [x] 7.2 Update `List` handler to accept `include_revoked` query parameter
    - Parse `include_revoked` from `r.URL.Query().Get("include_revoked")`
    - Pass boolean to `svc.List`
    - _Requirements: 7.4, 7.5_

  - [x] 7.3 Update `Revoke` handler to pass user ID for soft-revoke
    - Extract `uc.UserID` and pass to `svc.Revoke`
    - _Requirements: 7.2_

  - [x] 7.4 Implement `Get` handler method
    - Parse `orgId`, `teamId`, `keyId` from URL params
    - Check team role (OrgMember or TeamMember minimum)
    - Call `svc.Get(ctx, teamID, keyID)`
    - Return full API key JSON including creator info, usage stats, allowed_ips
    - Return 404 if not found or wrong team
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 7.5 Implement `Update` handler method
    - Parse `orgId`, `teamId`, `keyId` from URL params
    - Check team role (OrgAdmin or TeamLead)
    - Decode `UpdateAPIKeyInput` from request body
    - Call `svc.Update(ctx, teamID, keyID, input)`
    - Return updated key JSON or appropriate error (400 for invalid input, 404 for not found)
    - Add audit record for `apikey.updated`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7_

  - [x] 7.6 Implement `Rotate` handler method
    - Parse `orgId`, `teamId`, `keyId` from URL params
    - Check team role (OrgAdmin or TeamLead)
    - Call `svc.Rotate(ctx, teamID, keyID)`
    - Return the new raw key in the response (shown once)
    - Return 400 if revoked/inactive, 404 if not found
    - Add audit record for `apikey.rotated`
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6_

  - [x] 7.7 Implement `BulkRevoke` handler method
    - Parse `orgId`, `teamId` from URL params
    - Check team role (OrgAdmin or TeamLead)
    - Decode `BulkRevokeInput` from request body
    - Validate `KeyIDs` is non-empty (400 if empty)
    - Call `svc.BulkRevoke(ctx, teamID, uc.UserID, input)`
    - Return `BulkRevokeResult` JSON with revoked count and skipped array
    - Add audit record for `apikey.bulk_revoked`
    - _Requirements: 13.1, 13.4, 13.5_

  - [x] 7.8 Register new routes in `Routes` method
    - Add `r.Get("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", h.Get)`
    - Add `r.Patch("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", h.Update)`
    - Add `r.Post("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}/rotate", h.Rotate)`
    - Add `r.Post("/orgs/{orgId}/teams/{teamId}/api-keys/bulk-revoke", h.BulkRevoke)`
    - _Requirements: 3.1, 4.1, 8.1, 13.1_

  - [x] 7.9 Write property test for update field persistence (Property 3)
    - **Property 3: Update Field Persistence**
    - Generate random valid update inputs, patch key, retrieve, verify updated fields match and unspecified fields unchanged
    - **Validates: Requirements 4.1, 4.2, 4.5, 5.2**

  - [x] 7.10 Write property test for revoked key rejects all mutations (Property 5)
    - **Property 5: Revoked Key Rejects All Mutations**
    - Generate random mutation inputs on revoked keys, verify all are rejected
    - **Validates: Requirements 4.8, 6.5, 8.5**

  - [x] 7.11 Write property test for enable/disable round-trip (Property 6)
    - **Property 6: Enable/Disable Round-Trip**
    - Generate random active keys, toggle is_active false then true, verify key authenticates again
    - **Validates: Requirements 6.2, 6.3**

  - [x] 7.12 Write property test for key rotation produces new credentials (Property 10)
    - **Property 10: Key Rotation Produces New Credentials**
    - Generate random active keys, rotate, verify new raw key format `bb_` + 64 hex chars, verify hash/prefix changed, verify metadata unchanged
    - **Validates: Requirements 8.1, 8.2**

  - [x] 7.13 Write property test for bulk revoke correctness (Property 15)
    - **Property 15: Bulk Revoke Correctness**
    - Generate random key sets across teams, bulk revoke, verify revoked + skipped = total input IDs
    - **Validates: Requirements 13.1, 13.2, 13.3**

- [x] 8. Middleware updates (`internal/auth/middleware.go`)
  - [x] 8.1 Update `APIKeyRepo` interface to use `UpdateLastUsedWithTracking`
    - Replace `UpdateLastUsed(ctx context.Context, id uuid.UUID) error` with `UpdateLastUsedWithTracking(ctx context.Context, id uuid.UUID, ip string) error`
    - _Requirements: 9.3_

  - [x] 8.2 Add revoked key check in API key auth block
    - After `GetByHash` and expiration check, add: if `key.RevokedAt != nil` → 401 "API key revoked"
    - _Requirements: 7.3_

  - [x] 8.3 Add disabled key check in API key auth block
    - After revoked check, add: if `!key.IsActive` → 401 "API key disabled"
    - _Requirements: 6.4_

  - [x] 8.4 Add IP allowlist enforcement in API key auth block
    - After active check, if `key.AllowedIPs` is non-empty, parse `r.RemoteAddr` to extract IP
    - Check if request IP matches any entry in `AllowedIPs` (exact IP match or CIDR containment using `net.ParseCIDR` and `Contains`)
    - If no match → 403 "IP not allowed for this API key"
    - If `AllowedIPs` is nil or empty, allow all IPs
    - _Requirements: 11.3, 11.4_

  - [x] 8.5 Replace `UpdateLastUsed` call with `UpdateLastUsedWithTracking`
    - Extract remote IP from `r.RemoteAddr` (strip port if present)
    - Call `apikeyRepo.UpdateLastUsedWithTracking(r.Context(), key.ID, remoteIP)`
    - Log error but do not block request on tracking failure
    - _Requirements: 9.3_

  - [x] 8.6 Write property test for middleware rejects disabled and revoked keys (Property 7)
    - **Property 7: Middleware Rejects Disabled and Revoked Keys**
    - Generate keys with `is_active=false` or `revoked_at` set, verify middleware returns 401
    - **Validates: Requirements 6.4, 7.3**

  - [x] 8.7 Write property test for IP allowlist enforcement (Property 13)
    - **Property 13: IP Allowlist Enforcement**
    - Generate random IPs × allowlists, verify middleware allows iff IP matches at least one entry; verify empty allowlist allows all
    - **Validates: Requirements 11.3, 11.4**

  - [x] 8.8 Write property test for request count monotonic increment (Property 11)
    - **Property 11: Request Count Monotonic Increment**
    - Generate N auth attempts, verify `request_count` equals initial + N and `last_used_ip` equals most recent IP
    - **Validates: Requirements 9.3**

- [x] 9. Checkpoint — Verify handler and middleware compile
  - Ensure all code compiles, ask the user if questions arise.

- [x] 10. Scope enforcement in existing handlers
  - [x] 10.1 Fix inbox handler scope checks (`internal/handler/inbox.go`)
    - `CreateInboxFlat`: change scope check from `inbox:write` to `inbox:create`
    - `DeleteInbox`: change scope check from `inbox:write` to `inbox:delete`
    - `ListMyInboxes`: add API key scope check for `inbox:read`
    - `GetInbox`: add API key scope check for `inbox:read`
    - _Requirements: 1.1, 1.2, 2.3, 2.4, 2.5_

  - [x] 10.2 Add email handler scope checks (`internal/handler/email.go`)
    - `MarkAllRead`: add API key scope check for `email:write`
    - `MarkReadUnread`: add API key scope check for `email:write`
    - _Requirements: 1.4_

  - [x] 10.3 Add webhook handler scope checks (`internal/handler/webhook.go`)
    - `Create`: add API key scope check for `webhook:write`
    - `Update`: add API key scope check for `webhook:write`
    - `Delete`: add API key scope check for `webhook:write`
    - `List`: add API key scope check for `webhook:read`
    - `ListDeliveryLogs`: add API key scope check for `webhook:read`
    - _Requirements: 2.1, 2.2_

  - [x] 10.4 Write property test for scope enforcement across endpoints (Property 2)
    - **Property 2: Scope Enforcement Across Endpoints**
    - Generate random scope subsets × endpoint pairs, verify 403 when required scope missing and pass when present
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [x] 10.5 Write property test for soft-revoke preserves row with metadata (Property 8)
    - **Property 8: Soft-Revoke Preserves Row with Metadata**
    - Generate random active keys, revoke, verify `revoked_at` non-null, `revoked_by` matches revoker, row still exists
    - **Validates: Requirements 7.2**

  - [x] 10.6 Write property test for list filtering by revocation status (Property 9)
    - **Property 9: List Filtering by Revocation Status**
    - Generate mixed key sets per team, list with/without `include_revoked`, verify correct filtering
    - **Validates: Requirements 7.4, 7.5**

- [x] 11. Cleanup worker integration (`internal/worker/cleanup.go`)
  - [x] 11.1 Add `apikeyRepo` parameter to `CleanupJob` function
    - Extend `CleanupJob` signature to accept `*postgres.APIKeyRepo`
    - Call `apikeyRepo.DeleteExpiredKeys(ctx)` in the cleanup cycle
    - Log the count of deleted expired API keys
    - _Requirements: 12.1, 12.2_

  - [x] 11.2 Update `CleanupJob` call site in `cmd/api/main.go`
    - Pass `apikeyRepo` to the `CleanupJob` function call in the worker setup
    - _Requirements: 12.1_

  - [x] 11.3 Write property test for expired key cleanup correctness (Property 14)
    - **Property 14: Expired Key Cleanup Correctness**
    - Generate keys with varied `expires_at` and `revoked_at` states, run cleanup, verify only correct keys deleted
    - **Validates: Requirements 12.1, 12.3**

- [x] 12. Route registration in `cmd/api/main.go`
  - [x] 12.1 Register new API key routes
    - Add `r.Get("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", apikeyHandler.Get)`
    - Add `r.Patch("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}", apikeyHandler.Update)`
    - Add `r.Post("/orgs/{orgId}/teams/{teamId}/api-keys/{keyId}/rotate", apikeyHandler.Rotate)`
    - Add `r.Post("/orgs/{orgId}/teams/{teamId}/api-keys/bulk-revoke", apikeyHandler.BulkRevoke)`
    - _Requirements: 3.1, 4.1, 8.1, 13.1_

- [x] 13. Final checkpoint — Ensure full build compiles and all tests pass
  - Ensure all code compiles with `go build ./...`
  - Run `go vet ./...` to check for issues
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major layer
- Property tests use the [rapid](https://github.com/flyingmutant/rapid) library as specified in the design
- All 15 correctness properties from the design are covered by property test sub-tasks
- The migration number 000032 follows the existing sequence (latest is 000031)
- Soft-revoke replaces hard-delete throughout — the existing `Delete` repo method is superseded by `SoftRevoke`
