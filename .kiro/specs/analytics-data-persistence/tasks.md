# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Analytics Queries Return Reduced/Zero Values After Email Deletion
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate analytics data is lost when emails are deleted
  - **Scoped PBT Approach**: Scope the property to concrete failing cases — insert N emails for an org on a known date with known size_bytes, record analytics results, delete all emails, re-query analytics
  - Test `GetOrgEmailsPerDay`: insert 10 emails on a date, delete them, assert count for that date is still 10 (from `daily_email_stats`). On unfixed code this returns 0 because it queries `COUNT(*) FROM emails`
  - Test `GetOrgStats.TotalEmails`: insert 5 emails, delete them, assert `TotalEmails` is still 5. On unfixed code this returns 0 because it queries `COUNT(*) FROM emails`
  - Test `GetOrgStats.StorageUsedBytes`: insert emails with known `size_bytes`, delete them, assert `StorageUsedBytes` is unchanged. On unfixed code this returns 0 because it queries `SUM(size_bytes) FROM emails`
  - Test `GetOrgPeakHours`: insert emails at specific hours, delete them, assert peak hours still reflect the original distribution. On unfixed code this returns all zeros
  - Test `GetOrgDomainBreakdown`: insert emails across domains, delete them, assert domain breakdown is preserved. On unfixed code counts drop to 0
  - Test `GetTeamEmailsPerDay`: insert emails for a team, delete them, assert team daily counts are preserved. On unfixed code this returns 0
  - Test `GetTeamStats.TotalEmails`: insert emails for a team, delete them, assert `TotalEmails` is preserved. On unfixed code this returns 0
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Email-Derived Stats and Existing Counter Paths Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe on UNFIXED code: `GetOrgStats` returns correct `ActiveInboxes`, `TotalInboxes`, `TotalDomains`, `TotalTeams`, `TotalMembers` from live entity tables
  - Observe on UNFIXED code: `GetTeamStats` returns correct `ActiveInboxes`, `TotalInboxes`, `TotalMembers` from live entity tables
  - Observe on UNFIXED code: `GetSystemStats` returns correct live counts from entity tables (`TotalUsers`, `TotalTeams`, `TotalDomains`, `TotalInboxes`, `ActiveInboxes`, `TotalSessions`, etc.)
  - Observe on UNFIXED code: `org_analytics_counters` fields (`TotalEmailsReceived`, `TotalInboxesCreated`, `TotalStorageBytes`) are correctly returned by `GetOrgStats`
  - Observe on UNFIXED code: `GetOrgInboxesPerDay` reads from `daily_email_stats.inboxes_created` and returns correct time-series
  - Observe on UNFIXED code: `IncrementEmail`, `IncrementInbox`, `UpsertDailyStat` correctly upsert rows in `org_analytics_counters` and `daily_email_stats`
  - Write property-based tests: for any database state, live entity counts (`ActiveInboxes`, `TotalDomains`, `TotalTeams`, `TotalMembers`) equal the actual row counts in their respective tables
  - Write property-based tests: for any database state, `GetSystemStats` returns values matching live row counts
  - Write property-based tests: existing counter increment methods produce correct cumulative values
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Database migration — Create new dimension and team-level tables

  - [x] 3.1 Create migration `migrations/000030_analytics_dimension_tables.up.sql`
    - Create `hourly_email_stats` table: `(org_id UUID, date DATE, hour INT, emails_received INT, PRIMARY KEY (org_id, date, hour))` with FK to `organizations(id) ON DELETE CASCADE`
    - Create `daily_domain_email_stats` table: `(org_id UUID, date DATE, domain_name TEXT, emails_received INT, PRIMARY KEY (org_id, date, domain_name))` with FK to `organizations(id) ON DELETE CASCADE`
    - Create `daily_sender_domain_stats` table: `(org_id UUID, date DATE, sender_domain TEXT, emails_received INT, PRIMARY KEY (org_id, date, sender_domain))` with FK to `organizations(id) ON DELETE CASCADE`
    - Create `daily_team_email_stats` table: `(team_id UUID, date DATE, emails_received INT, inboxes_created INT, storage_bytes BIGINT, PRIMARY KEY (team_id, date))` with FK to `teams(id) ON DELETE CASCADE`
    - Create `team_analytics_counters` table: `(team_id UUID PRIMARY KEY, total_emails_received BIGINT DEFAULT 0, total_inboxes_created BIGINT DEFAULT 0, total_storage_bytes BIGINT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW())` with FK to `teams(id) ON DELETE CASCADE`
    - Seed `team_analytics_counters` for existing teams: `INSERT INTO team_analytics_counters (team_id) SELECT id FROM teams ON CONFLICT DO NOTHING`
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 3.2 Create down migration `migrations/000030_analytics_dimension_tables.down.sql`
    - Drop tables in reverse order: `team_analytics_counters`, `daily_team_email_stats`, `daily_sender_domain_stats`, `daily_domain_email_stats`, `hourly_email_stats`
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 4. Add new counter methods in `counter_repo.go`

  - [x] 4.1 Add `UpsertHourlyStat` method to `CounterRepo`
    - Upsert into `hourly_email_stats` for `(org_id, NOW()::date, hour)` incrementing `emails_received`
    - Accept `orgID uuid.UUID` and `hour int` parameters
    - _Bug_Condition: isBugCondition(query) where query reads peak hours from live emails table_
    - _Expected_Behavior: peak hours data persists in hourly_email_stats after email deletion_
    - _Requirements: 2.6_

  - [x] 4.2 Add `UpsertDomainStat` method to `CounterRepo`
    - Upsert into `daily_domain_email_stats` for `(org_id, NOW()::date, domain_name)` incrementing `emails_received`
    - Accept `orgID uuid.UUID` and `domainName string` parameters
    - _Bug_Condition: isBugCondition(query) where query reads domain breakdown from live emails table_
    - _Expected_Behavior: domain breakdown data persists in daily_domain_email_stats after email deletion_
    - _Requirements: 2.7_

  - [x] 4.3 Add `UpsertSenderDomainStat` method to `CounterRepo`
    - Upsert into `daily_sender_domain_stats` for `(org_id, NOW()::date, sender_domain)` incrementing `emails_received`
    - Accept `orgID uuid.UUID` and `senderDomain string` parameters
    - _Bug_Condition: isBugCondition(query) where query reads top sender domains from live emails table_
    - _Expected_Behavior: top sender domain data persists in daily_sender_domain_stats after email deletion_
    - _Requirements: 2.5_

  - [x] 4.4 Add `UpsertDailyTeamStat` method to `CounterRepo`
    - Upsert into `daily_team_email_stats` for `(team_id, NOW()::date)` incrementing `emails_received` and `storage_bytes`
    - Accept `teamID uuid.UUID`, `emailsReceived int`, `inboxesCreated int`, `storageBytes int64` parameters
    - _Bug_Condition: isBugCondition(query) where query reads team emails per day from live emails table_
    - _Expected_Behavior: team daily stats persist in daily_team_email_stats after email deletion_
    - _Requirements: 2.8_

  - [x] 4.5 Add `IncrementTeamEmail` method to `CounterRepo`
    - Upsert into `team_analytics_counters` for `team_id` incrementing `total_emails_received` and `total_storage_bytes`
    - Accept `teamID uuid.UUID` and `sizeBytes int64` parameters
    - _Bug_Condition: isBugCondition(query) where query reads team total emails from live emails table_
    - _Expected_Behavior: team total emails persists in team_analytics_counters after email deletion_
    - _Requirements: 2.9_

  - [x] 4.6 Add `IncrementTeamInbox` method to `CounterRepo`
    - Upsert into `team_analytics_counters` for `team_id` incrementing `total_inboxes_created`
    - Accept `teamID uuid.UUID` parameter
    - _Requirements: 2.9_

- [x] 5. Expand `InboxEvent` struct and update `bridge.go` subscriber

  - [x] 5.1 Add fields to `InboxEvent` struct in `internal/realtime/bridge.go`
    - Add `SenderDomain string` field with json tag `"sender_domain"`
    - Add `DomainName string` field with json tag `"domain_name"`
    - Add `TeamID uuid.UUID` field with json tag `"team_id"`
    - Add `Hour int` field with json tag `"hour"`
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 5.2 Expand `CounterPersister` interface in `bridge.go`
    - Add `UpsertHourlyStat(ctx context.Context, orgID uuid.UUID, hour int) error`
    - Add `UpsertDomainStat(ctx context.Context, orgID uuid.UUID, domainName string) error`
    - Add `UpsertSenderDomainStat(ctx context.Context, orgID uuid.UUID, senderDomain string) error`
    - Add `UpsertDailyTeamStat(ctx context.Context, teamID uuid.UUID, emailsReceived, inboxesCreated int, storageBytes int64) error`
    - Add `IncrementTeamEmail(ctx context.Context, teamID uuid.UUID, sizeBytes int64) error`
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 5.3 Update `Subscribe` function to call new counter methods on `email.received`
    - After existing `IncrementEmail` and `UpsertDailyStat` calls, add:
    - Call `counterRepo.UpsertHourlyStat(ctx, evt.OrgID, evt.Hour)` if `evt.Hour >= 0`
    - Call `counterRepo.UpsertDomainStat(ctx, evt.OrgID, evt.DomainName)` if `evt.DomainName != ""`
    - Call `counterRepo.UpsertSenderDomainStat(ctx, evt.OrgID, evt.SenderDomain)` if `evt.SenderDomain != ""`
    - Call `counterRepo.UpsertDailyTeamStat(ctx, evt.TeamID, 1, 0, evt.SizeBytes)` if `evt.TeamID != uuid.Nil`
    - Call `counterRepo.IncrementTeamEmail(ctx, evt.TeamID, evt.SizeBytes)` if `evt.TeamID != uuid.Nil`
    - Log errors at slog.Error level but do not fail the event processing
    - _Bug_Condition: isBugCondition(query) — all dimension queries read from live emails_
    - _Expected_Behavior: new dimension tables are populated on every email.received event_
    - _Preservation: existing IncrementEmail and UpsertDailyStat calls remain unchanged_
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9, 3.4, 3.5_

  - [x] 5.4 Update `Publisher.PublishInboxEvent` signature and callers
    - Expand `PublishInboxEvent` to accept `senderDomain`, `domainName`, `teamID`, and `hour` parameters (or accept the full `InboxEvent` struct)
    - Populate the new fields in the published event
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 6. Update SMTP handler to pass additional metadata

  - [x] 6.1 Update `Process` in `internal/smtp/handler.go`
    - Extract sender domain from `email.From` by splitting on `@` and taking the domain portion
    - Look up the domain assignment to get `TeamID` and domain name (already available via `inbox.DomainAssignmentID`)
    - Extract the hour from `email.ReceivedAt` using `email.ReceivedAt.Hour()`
    - Pass `senderDomain`, `domainName`, `teamID`, and `hour` to `PublishInboxEvent`
    - _Bug_Condition: isBugCondition — dimension tables not populated because metadata not passed_
    - _Expected_Behavior: all metadata needed for dimension counters is included in the published event_
    - _Preservation: existing email storage, webhook dispatch, and WebSocket broadcast remain unchanged_
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 7. Rewrite analytics queries in `analytics_repo.go`

  - [x] 7.1 Rewrite `GetOrgStats` to use persistent tables
    - Replace `COUNT(*) FROM emails` for `TotalEmails` with `org_analytics_counters.total_emails_received`
    - Replace `SUM(size_bytes) FROM emails` for `StorageUsedBytes` with `org_analytics_counters.total_storage_bytes`
    - Replace live `TopSenderDomains` query with aggregation from `daily_sender_domain_stats`: `SELECT sender_domain, SUM(emails_received) ... GROUP BY sender_domain ORDER BY SUM DESC LIMIT 5`
    - Keep `ActiveInboxes`, `TotalInboxes`, `TotalDomains`, `TotalTeams`, `TotalMembers` queries unchanged (live entity counts)
    - Keep existing persistent counter reads (`TotalEmailsReceived`, `TotalInboxesCreated`, `TotalStorageBytes`) unchanged
    - _Bug_Condition: isBugCondition(query) where query.readsFrom contains 'emails' for TotalEmails, StorageUsedBytes, TopSenderDomains_
    - _Expected_Behavior: TotalEmails = org_analytics_counters.total_emails_received, StorageUsedBytes = org_analytics_counters.total_storage_bytes, TopSenderDomains from daily_sender_domain_stats_
    - _Preservation: ActiveInboxes, TotalInboxes, TotalDomains, TotalTeams, TotalMembers unchanged_
    - _Requirements: 1.3, 1.4, 1.5, 2.3, 2.4, 2.5, 3.2, 3.3, 3.4_

  - [x] 7.2 Rewrite `GetOrgEmailsPerDay` to use `daily_email_stats`
    - Replace `COUNT(*) FROM emails` subquery with `SELECT date, emails_received FROM daily_email_stats WHERE org_id = $1`
    - Keep `generate_series` for gap-filling with `COALESCE(emails_received, 0)`
    - _Bug_Condition: isBugCondition(query) where query reads emails per day from live emails table_
    - _Expected_Behavior: emails per day sourced from daily_email_stats which is never decremented_
    - _Requirements: 1.1, 1.2, 2.1, 2.2_

  - [x] 7.3 Rewrite `GetOrgPeakHours` to use `hourly_email_stats`
    - Replace `EXTRACT(HOUR FROM e.received_at)` on live rows with `SELECT hour, SUM(emails_received) FROM hourly_email_stats WHERE org_id = $1 AND date > ... GROUP BY hour`
    - Keep the 0-23 hour gap-filling logic
    - _Bug_Condition: isBugCondition(query) where query reads peak hours from live emails table_
    - _Expected_Behavior: peak hours sourced from hourly_email_stats which is never decremented_
    - _Requirements: 1.6, 2.6_

  - [x] 7.4 Rewrite `GetOrgDomainBreakdown` to use `daily_domain_email_stats`
    - Replace `COUNT(e.id)` joined to live emails with `SELECT domain_name, SUM(emails_received) FROM daily_domain_email_stats WHERE org_id = $1 GROUP BY domain_name ORDER BY SUM DESC`
    - _Bug_Condition: isBugCondition(query) where query reads domain breakdown from live emails table_
    - _Expected_Behavior: domain breakdown sourced from daily_domain_email_stats which is never decremented_
    - _Requirements: 1.7, 2.7_

  - [x] 7.5 Rewrite `GetTeamStats` to use `team_analytics_counters`
    - Replace `COUNT(*) FROM emails` for `TotalEmails` with `team_analytics_counters.total_emails_received`
    - Keep `ActiveInboxes`, `TotalInboxes`, `TotalMembers` queries unchanged (live entity counts)
    - _Bug_Condition: isBugCondition(query) where query reads team total emails from live emails table_
    - _Expected_Behavior: TotalEmails = team_analytics_counters.total_emails_received_
    - _Preservation: ActiveInboxes, TotalInboxes, TotalMembers unchanged_
    - _Requirements: 1.9, 2.9, 3.2, 3.3_

  - [x] 7.6 Rewrite `GetTeamEmailsPerDay` to use `daily_team_email_stats`
    - Replace `COUNT(*) FROM emails` subquery with `SELECT date, emails_received FROM daily_team_email_stats WHERE team_id = $1`
    - Keep `generate_series` for gap-filling with `COALESCE(emails_received, 0)`
    - _Bug_Condition: isBugCondition(query) where query reads team emails per day from live emails table_
    - _Expected_Behavior: team emails per day sourced from daily_team_email_stats which is never decremented_
    - _Requirements: 1.8, 2.8_

  - [x] 7.7 Rewrite `GetOrgInboxesPerDay` to use `daily_email_stats`
    - Replace `COUNT(*) FROM inboxes` subquery with `SELECT date, inboxes_created FROM daily_email_stats WHERE org_id = $1`
    - Keep `generate_series` for gap-filling with `COALESCE(inboxes_created, 0)`
    - _Preservation: this query already partially uses persistent data; fully switch to daily_email_stats_
    - _Requirements: 3.7_

- [x] 8. Update `inbox_service.go` for team-level counter increments

  - [x] 8.1 Add team-level counter calls in `CreateInbox`
    - After existing org-level `IncrementInbox` and `UpsertDailyStat` calls, add:
    - Call `s.counterRepo.IncrementTeamInbox(ctx, teamID)` to increment team all-time inbox counter
    - Call `s.counterRepo.UpsertDailyTeamStat(ctx, teamID, 0, 1, 0)` to increment team daily inbox stat
    - Log errors at slog.Error level but do not fail inbox creation
    - _Preservation: existing org-level IncrementInbox and UpsertDailyStat calls remain unchanged_
    - _Requirements: 2.9, 3.4, 3.5_

- [x] 9. Fix verification

  - [x] 9.1 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Analytics Queries Return Persistent Values After Email Deletion
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 9.2 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Email-Derived Stats and Existing Counter Paths Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 10. Checkpoint - Ensure all tests pass
  - Run full test suite to confirm no regressions
  - Verify bug condition test (Property 1) passes — analytics survive email deletion
  - Verify preservation test (Property 2) passes — live entity counts and existing counters unchanged
  - Ensure all new counter methods are exercised by the test suite
  - Ask the user if questions arise

## Test Coverage Status — COVERED via integration tests

A test-database harness now exists (`internal/repository/postgres/testdb_test.go`,
runs against `burnerbyte_test`, skips when no DB is reachable). Integration tests
in `analytics_integration_test.go` verify the properties end-to-end:
- Property 1 (bug fixed): with persistent stats seeded and ZERO live emails
  (post-deletion state), `GetOrgStats` (TotalEmails, StorageUsedBytes,
  TopSenderDomains), `GetOrgEmailsPerDay`, `GetOrgPeakHours`, and
  `GetOrgDomainBreakdown` all return historical values from the persistent
  counter/dimension tables.
- Property 2 (preservation): live entity counts (teams/domains/inboxes) still
  reflect actual rows.

Team-level queries (`GetTeamStats`, `GetTeamEmailsPerDay`) read the analogous
`team_analytics_counters` / `daily_team_email_stats` tables via the identical
fix pattern.
