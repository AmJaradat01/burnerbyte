# Implementation Plan: Enhanced Domains

## Overview

This plan implements the enhanced domains feature across all layers: database migration, domain model expansion, DNS verifier (SPF), verification history repository, domain repository updates, domain service updates, settings resolver updates, domain handler updates (4 new endpoints + bulk operations), DNS recheck worker updates, route registration, and audit events. Each task builds incrementally on the previous, ending with full integration and wiring.

## Tasks

- [x] 1. Database migration 000034 for enhanced domains schema
  - Create `migrations/000034_enhanced_domains.up.sql`:
    - `ALTER TABLE domains ADD COLUMN description TEXT`
    - `ALTER TABLE domains ADD COLUMN spf_verified BOOLEAN NOT NULL DEFAULT FALSE`
    - `CREATE EXTENSION IF NOT EXISTS pg_trgm`
    - `CREATE INDEX idx_domains_name_trgm ON domains USING GIN (domain_name gin_trgm_ops)`
    - Create `domain_verification_history` table with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE`, `checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `mx_result BOOLEAN NOT NULL`, `txt_result BOOLEAN NOT NULL`, `spf_result BOOLEAN NOT NULL`, `trigger_source VARCHAR(20) NOT NULL`, `error_details TEXT`
    - `CREATE INDEX idx_verification_history_domain_time ON domain_verification_history(domain_id, checked_at DESC)`
  - Create `migrations/000034_enhanced_domains.down.sql`:
    - Drop the `domain_verification_history` table
    - Drop the trigram index `idx_domains_name_trgm`
    - Remove `spf_verified` and `description` columns from `domains`
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x] 2. Expand domain model types
  - [x] 2.1 Update `internal/domain/domain.go` with new and extended types
    - Add `Description string` field to `Domain` struct
    - Add `SPFVerified bool` field to `Domain` struct
    - Add `Status string` field to `Domain` struct
    - Add `TotalInboxes int` and `TotalEmails int` and `EmailsReceivedCount int` fields to `Domain` struct
    - Add `Assignments []DomainAssignmentSummary` field to `Domain` struct
    - Extend `DomainSettings` with `DefaultInboxTTL *string`, `MaxInboxTTL *string`, `MaxInboxesPerDomain *int`
    - Add `DomainAssignmentSummary` struct with `TeamID`, `TeamName`, `AccessLevel`
    - Add `Description string` to `CreateDomainInput`
    - Add `Description *string` to `UpdateDomainInput`
    - Add `DomainListFilter` struct with `Search string` and `Status string`
    - Add `VerificationHistory` struct with all fields from design
    - Add `BulkDomainRequest` struct with `DomainIDs []uuid.UUID` and `Force bool`
    - Add `BulkVerifyResult`, `BulkVerifyItem`, `BulkFailItem`, `BulkDeleteResult` structs
    - Add `TransferDomainInput` struct with `TargetOrgID uuid.UUID`
    - Add `TransferResult` struct with `Domain`, `RemovedAssignmentsCount`, `DeactivatedInboxesCount`
    - _Requirements: 1.1-1.6, 2.1-2.3, 3.1-3.5, 4.1-4.5, 7.1-7.8, 8.1-8.9, 9.1-9.6, 10.1, 11.1-11.6, 12.1-12.3_

- [x] 3. Add SPF verification to DNS verifier
  - [x] 3.1 Add `VerifySPF` function to `internal/dns/verifier.go`
    - Implement `VerifySPF(domainName, expectedHost string) (bool, error)` that looks up TXT records, finds one starting with `v=spf1`, and checks if it contains the expected hostname
    - _Requirements: 9.1_

  - [ ]* 3.2 Write unit tests for VerifySPF
    - Test valid SPF record containing expected host
    - Test SPF record without expected host
    - Test domain with no SPF record
    - _Requirements: 9.1_

- [x] 4. Create verification history repository
  - [x] 4.1 Create `internal/repository/postgres/verification_history_repo.go`
    - Implement `VerificationHistoryRepo` struct with `db database.DBTX`
    - Implement `NewVerificationHistoryRepo(db database.DBTX)` constructor
    - Implement `Create(ctx, record *domain.VerificationHistory) error` — inserts a verification history record
    - Implement `ListByDomain(ctx, domainID uuid.UUID, page, perPage int) ([]domain.VerificationHistory, int, error)` — paginated list ordered by `checked_at DESC`
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 5. Update domain repository with new query methods
  - [x] 5.1 Update `internal/repository/postgres/domain_repo.go` — filtered list method
    - Add `ListByOrgFiltered(ctx, orgID uuid.UUID, filter domain.DomainListFilter, page, perPage int) ([]domain.Domain, int, error)` that applies `search` (case-insensitive `ILIKE` or trigram) and `status` filters (translating status strings to SQL conditions on `mx_verified`, `txt_verified`, `dns_last_checked_at`) with pagination
    - Include joined counts (`active_inboxes`, `inboxes_created_count`, `team_count`) in the filtered list query, matching the existing `ListByOrg` pattern
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 5.2 Update `internal/repository/postgres/domain_repo.go` — enriched get, DNS status, transfer methods
    - Add `GetByIDEnriched(ctx, id uuid.UUID) (*domain.Domain, error)` that returns domain with `total_inboxes` (all inboxes), `total_emails` (all emails across inboxes), `emails_received_count` (from `org_analytics_counters`), and `assignments` (joined with `domain_assignments` and `teams`)
    - Update `UpdateDNSStatus(ctx, id, mx, txt, spf bool) error` to accept and persist the `spf_verified` column
    - Add `UpdateOrgID(ctx, domainID, newOrgID uuid.UUID) error` for domain transfer
    - Update `Create` to persist `description` field
    - Update `Update` to persist `description` field
    - Update `GetByID` to scan `description` and `spf_verified` columns
    - Update `ListByOrg` to scan `description` and `spf_verified` columns
    - Update `ListByPage` to scan `description` and `spf_verified` columns
    - Update `scanOne` and `scanRow` helpers to include new columns
    - _Requirements: 4.1, 9.2, 8.6, 11.1-11.6, 12.1-12.3_

- [x] 6. Checkpoint — Verify migration and repository layer compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update domain service with new business logic
  - [x] 7.1 Add `ComputeStatus` pure function to `internal/service/domain_service.go`
    - Implement `ComputeStatus(d *domain.Domain) string` that returns `"verified"`, `"pending_verification"`, `"partially_verified"`, or `"failed"` based on `mx_verified`, `txt_verified`, and `dns_last_checked_at` (ignoring `spf_verified`)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 7.2 Write property test for ComputeStatus (Property 1)
    - **Property 1: Domain status computation is deterministic and correct**
    - Use `pgregory.net/rapid` to generate random booleans for `mx_verified`, `txt_verified`, `spf_verified` and random `*time.Time` for `dns_last_checked_at`
    - Assert the four status rules hold and that `spf_verified` does not affect the result
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 9.6**

  - [x] 7.3 Update `AddDomain` in domain service
    - Accept and persist `Description` from `CreateDomainInput`
    - Validate description length ≤ 1000 characters
    - After successful create, launch a goroutine that runs MX, TXT, and SPF verification, updates DNS status via repo, and inserts a verification history record with `trigger_source = "auto_create"`
    - Log errors from async verification at `slog.Error` level; do not block the response
    - Add `VerificationHistoryRepo` as a dependency on `DomainService`
    - _Requirements: 4.2, 4.5, 6.1, 6.2, 6.3, 6.4, 9.3, 9.4, 10.2_

  - [x] 7.4 Update `GetDomain` in domain service
    - Use `GetByIDEnriched` repo method for detail endpoint
    - Compute and set `Status` field via `ComputeStatus`
    - Set `VerificationRecord` as before
    - _Requirements: 3.5, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.1, 12.2, 12.3_

  - [x] 7.5 Update `ListByOrg` in domain service
    - Accept `DomainListFilter` parameter
    - Delegate to `ListByOrgFiltered` repo method
    - Compute and set `Status` on each domain in the result
    - _Requirements: 1.1-1.7, 3.5_

  - [x] 7.6 Update `UpdateDomain` in domain service
    - Accept and validate `Description` (≤ 1000 chars)
    - Validate `DefaultInboxTTL` and `MaxInboxTTL` as valid Go duration strings via `time.ParseDuration`
    - Validate `MaxInboxesPerDomain` is positive when provided
    - Validate that `default_inbox_ttl` does not exceed the resolved `max_inbox_ttl`
    - Persist all new settings fields
    - _Requirements: 2.1-2.7, 4.3, 4.5_

  - [x] 7.7 Update `TriggerVerify` in domain service
    - Add SPF verification call alongside MX and TXT
    - Update DNS status with all three booleans
    - Insert a verification history record with `trigger_source = "manual"`
    - _Requirements: 9.3, 9.4, 10.2_

  - [x] 7.8 Add `BulkVerify` method to domain service
    - Accept `orgID uuid.UUID` and `domainIDs []uuid.UUID`
    - Validate max 50 IDs
    - For each ID: fetch domain, verify org ownership, run MX/TXT/SPF checks, update DNS status, insert verification history with `trigger_source = "manual"`, compute status, add to results
    - Collect failures (not found, wrong org) in `failed` array
    - Return `BulkVerifyResult`
    - _Requirements: 7.1, 7.2, 7.3, 7.8_

  - [x] 7.9 Add `BulkDelete` method to domain service
    - Accept `orgID uuid.UUID`, `domainIDs []uuid.UUID`, `force bool`
    - Validate max 50 IDs
    - For each ID: fetch domain, verify org ownership, check active inboxes (skip if active and not force), clean up Redis keys, delete domain
    - Collect skipped (active inboxes without force) and failed (not found, wrong org) in respective arrays
    - Return `BulkDeleteResult`
    - _Requirements: 7.4, 7.5, 7.6, 7.8_

  - [x] 7.10 Add `TransferDomain` method to domain service
    - Accept `orgID, domainID, targetOrgID uuid.UUID`
    - Verify domain exists and belongs to source org
    - Verify target org exists and has not reached domain limit
    - Delete all domain assignments for the domain
    - List active inboxes, clean up Redis keys, deactivate inboxes
    - Update domain's `org_id` to target org
    - Return `TransferResult` with counts
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9_

  - [x] 7.11 Add `GetVerificationHistory` method to domain service
    - Accept `orgID, domainID uuid.UUID, page, perPage int`
    - Verify domain belongs to org
    - Delegate to `VerificationHistoryRepo.ListByDomain`
    - _Requirements: 10.2, 10.3, 10.4_

  - [ ]* 7.12 Write property test for description length validation (Property 8)
    - **Property 8: Description length validation**
    - Use `rapid` to generate strings of varying lengths
    - Assert strings > 1000 chars are rejected, strings ≤ 1000 chars are accepted
    - **Validates: Requirements 4.5**

  - [ ]* 7.13 Write property test for duration validation (Property 5)
    - **Property 5: Duration string validation matches Go's time.ParseDuration**
    - Use `rapid` to generate random strings
    - Assert the service validation accepts a string iff `time.ParseDuration` succeeds
    - **Validates: Requirements 2.4, 2.5**

  - [ ]* 7.14 Write property test for default TTL not exceeding max TTL (Property 6)
    - **Property 6: Default TTL cannot exceed max TTL**
    - Use `rapid` to generate pairs of valid duration strings
    - Assert that when parsed default > parsed max, validation fails; otherwise succeeds
    - **Validates: Requirements 2.7**

- [x] 8. Update settings resolver with domain-level cascade
  - [x] 8.1 Update `internal/service/settings_resolver.go`
    - Update `ResolveDefaultInboxTTL` to include domain level: team → domain → org → system default
    - Update `ResolveDefaultInboxTTLWithTeam` to include domain level in the fallback chain
    - Update `ResolveMaxInboxTTL` to include domain level: assignment → domain → org → system default
    - Add `ResolveMaxInboxesPerDomain(ctx, assignmentID uuid.UUID) int` with cascade: assignment → domain → org → system default
    - _Requirements: 2.8, 2.9, 2.10_

  - [ ]* 8.2 Write property test for settings cascade (Property 7)
    - **Property 7: Settings cascade returns first non-nil value in priority order**
    - Use `rapid` to generate random cascade configurations with nil/non-nil values at each level
    - Assert the resolver returns the highest-priority non-nil value, or system default if all nil
    - **Validates: Requirements 2.8, 2.9, 2.10**

- [x] 9. Checkpoint — Verify service and settings resolver compile and pass tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Update domain handler with new and extended endpoints
  - [x] 10.1 Update existing handler methods in `internal/handler/domain.go`
    - Update `NewDomainHandler` to accept `VerificationHistoryRepo` dependency (or access it through the service)
    - Update `CreateDomain` to pass `Description` from input and include `status` in response
    - Update `ListDomains` to parse `search` and `status` query params, pass `DomainListFilter` to service, include `status` in each domain response
    - Update `GetDomain` to return enriched response with `status`, `total_inboxes`, `total_emails`, `emails_received_count`, `assignments`, `spf_verified`, `description`
    - Update `UpdateDomain` to handle `description` and new settings fields
    - Update `VerifyDomain` to include `spf_verified` and `status` in response
    - Update `GetDomainImpact` to return enriched impact summary with `total_inbox_count`, `total_email_count`, `assignment_count`, and `assignments` array with team details
    - _Requirements: 1.1-1.7, 3.5, 4.2, 4.3, 4.4, 5.1-5.8, 9.5, 11.1-11.3_

  - [x] 10.2 Add `GetVerificationHistory` handler method
    - Parse `orgId` and `domainId` from URL, parse pagination params
    - Require `OrgAdmin` role
    - Call `svc.GetVerificationHistory`, return paginated response
    - Return 404 if domain not found or wrong org
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

  - [x] 10.3 Add `BulkVerify` handler method
    - Parse `orgId` from URL, decode `BulkDomainRequest` body
    - Require `OrgAdmin` role
    - Validate `domain_ids` is not empty and ≤ 50
    - Call `svc.BulkVerify`, return results
    - Record audit event `domain.bulk_verified`
    - _Requirements: 7.1, 7.2, 7.3, 7.7, 7.8_

  - [x] 10.4 Add `BulkDelete` handler method
    - Parse `orgId` from URL, decode `BulkDomainRequest` body (with `force` field)
    - Require `OrgAdmin` role
    - Validate `domain_ids` is not empty and ≤ 50
    - Call `svc.BulkDelete`, return results
    - Record audit event `domain.bulk_deleted`
    - _Requirements: 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 10.5 Add `TransferDomain` handler method
    - Parse `orgId` and `domainId` from URL, decode `TransferDomainInput` body
    - Require system admin role via `auth.RequireSystemAdmin` middleware
    - Call `svc.TransferDomain`, return `TransferResult`
    - Record audit events in both source and target orgs: `domain.transferred_out` and `domain.transferred_in`
    - _Requirements: 8.1, 8.2, 8.7, 8.8, 8.9_

- [x] 11. Register new routes in `cmd/api/main.go`
  - [x] 11.1 Wire new dependencies and register new routes
    - Instantiate `VerificationHistoryRepo` in main.go
    - Pass `VerificationHistoryRepo` to `DomainService` constructor (update constructor call)
    - Register new domain routes in the authenticated group:
      - `GET /orgs/{orgId}/domains/{domainId}/verification-history` → `domainHandler.GetVerificationHistory`
      - `POST /orgs/{orgId}/domains/{domainId}/transfer` → wrapped with `auth.RequireSystemAdmin`, `domainHandler.TransferDomain`
      - `POST /orgs/{orgId}/domains/bulk-verify` → `domainHandler.BulkVerify`
      - `POST /orgs/{orgId}/domains/bulk-delete` → `domainHandler.BulkDelete`
    - _Requirements: 7.7, 8.7, 10.5_

- [x] 12. Update DNS recheck worker
  - [x] 12.1 Update `internal/worker/dns_recheck.go`
    - Add `VerificationHistoryRepo` as a parameter to `DNSRecheckJob`
    - Add SPF verification call alongside MX and TXT in the recheck loop
    - Update the `UpdateDNSStatus` call to pass the `spf` boolean
    - After each status change, insert a verification history record with `trigger_source = "background"`
    - Update the `DNSRecheckJob` call in `cmd/api/main.go` to pass the `VerificationHistoryRepo`
    - _Requirements: 9.3, 10.2_

- [x] 13. Final checkpoint — Full build and test verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses Go throughout — all code examples and implementations use Go with the existing project conventions
- Migration number is 000034, following the existing sequence ending at 000033
