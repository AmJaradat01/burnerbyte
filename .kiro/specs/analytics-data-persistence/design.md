# Analytics Data Persistence Bugfix Design

## Overview

All analytics queries in `analytics_repo.go` compute chart data by counting/summing live rows in the `emails` table. When emails are deleted (manually or by the cleanup worker), these counts drop to zero, wiping dashboard charts and stat cards. The fix rewrites every affected query to read from persistent, append-only tables (`daily_email_stats`, `org_analytics_counters`) that are already incremented on email receive and inbox creation but never decremented on delete. For dimensions not yet tracked (peak hours, domain breakdown, top sender domains, team-level stats), new persistent tables and counter-increment paths are added.

## Glossary

- **Bug_Condition (C)**: Any analytics query that derives its result from live `emails` table rows — these return incorrect (reduced/zero) values after email deletion
- **Property (P)**: Analytics queries return historically accurate, monotonically non-decreasing values that reflect all emails ever received, regardless of whether those email rows still exist
- **Preservation**: Live-entity counts (`ActiveInboxes`, `TotalDomains`, `TotalTeams`, `TotalMembers`), system admin stats, and the existing counter-increment paths must remain unchanged
- **`analytics_repo.go`**: Repository in `internal/repository/postgres/` containing all analytics SQL queries — the primary file with buggy queries
- **`counter_repo.go`**: Repository in `internal/repository/postgres/` containing counter increment/upsert methods — already works for org-level email and inbox counters
- **`bridge.go`**: Event subscriber in `internal/realtime/` that calls counter increments when `email.received` events arrive via Redis pub/sub
- **`daily_email_stats`**: Existing persistent table with `(org_id, date, emails_received, inboxes_created, storage_bytes)` — already populated correctly
- **`org_analytics_counters`**: Existing persistent table with `(org_id, total_emails_received, total_inboxes_created, total_storage_bytes)` — already populated correctly

## Bug Details

### Bug Condition

The bug manifests when any analytics query is executed after emails have been deleted. Every affected function in `analytics_repo.go` joins to or counts from the `emails` table directly, so deletions cause data loss in analytics results. The `daily_email_stats` and `org_analytics_counters` tables already hold the correct persistent data but are not used by these queries.

**Formal Specification:**
```
FUNCTION isBugCondition(query)
  INPUT: query of type AnalyticsQuery
  OUTPUT: boolean

  RETURN query.readsFrom CONTAINS 'emails'
         AND query.purpose IN ['time_series', 'aggregate_count', 'aggregate_sum', 'dimension_breakdown']
         AND existsDeletedEmails(query.orgID)
         AND query.result < historicalTruth(query.orgID)
END FUNCTION
```

### Examples

- **Emails Per Day chart**: Org received 50 emails on Monday. Cleanup worker deletes 40 expired emails Tuesday night. Wednesday morning, the Monday bar shows 10 instead of 50. With the fix, `daily_email_stats` still has `emails_received=50` for Monday.
- **OrgStats.TotalEmails**: Org has received 1,200 emails lifetime. User manually deletes 300. `TotalEmails` drops from 1,200 to 900. With the fix, `org_analytics_counters.total_emails_received` still reads 1,200.
- **OrgStats.StorageUsedBytes**: Org accumulated 500MB of email storage. After cleanup, `SUM(size_bytes)` returns 50MB. With the fix, `org_analytics_counters.total_storage_bytes` still reads 500MB.
- **Peak Hours chart**: Org received 80% of emails between 9-11 AM. After deletion, the chart shows flat zeros. With the fix, `hourly_email_stats` preserves the distribution.
- **Team Emails Per Day**: Team received 20 emails on Friday. Emails expire over the weekend. Monday chart shows 0 for Friday. With the fix, `daily_team_email_stats` still has `emails_received=20`.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Live entity counts (`ActiveInboxes`, `TotalInboxes`, `TotalDomains`, `TotalTeams`, `TotalMembers`) must continue to query their respective entity tables directly — these reflect current state, not historical totals
- System admin stats (`GetSystemStats`) must continue to return live counts from entity tables
- The existing counter-increment paths in `bridge.go` (for `org_analytics_counters` and `daily_email_stats`) must continue to work identically
- The existing `IncrementInbox` call in `inbox_service.go` must continue to work identically
- Mouse/keyboard interactions, API request/response shapes, and HTTP status codes must remain unchanged

**Scope:**
All inputs that do NOT involve analytics queries reading from the `emails` table should be completely unaffected by this fix. This includes:
- Email CRUD operations (create, read, update, delete)
- Inbox management (create, extend TTL, delete)
- Webhook dispatching and notification persistence
- Authentication, RBAC, and session management
- SMTP email receiving pipeline (except for adding new counter increments)

## Hypothesized Root Cause

Based on the bug description, the root cause is straightforward:

1. **Direct `emails` table queries**: Every analytics function in `analytics_repo.go` (`GetOrgStats`, `GetOrgEmailsPerDay`, `GetOrgPeakHours`, `GetOrgDomainBreakdown`, `GetTeamStats`, `GetTeamEmailsPerDay`) computes results by joining to and counting/summing live `emails` rows. When rows are deleted, the counts decrease.

2. **Persistent tables exist but are unused by queries**: `daily_email_stats` and `org_analytics_counters` are already populated correctly via `bridge.go` and `inbox_service.go`, but the analytics queries don't read from them. The `GetOrgStats` function does read `org_analytics_counters` for the `TotalEmailsReceived`/`TotalInboxesCreated`/`TotalStorageBytes` fields, but the other fields (`TotalEmails`, `StorageUsedBytes`, `TopSenderDomains`) still query live rows.

3. **Missing dimension tables**: Peak hours, domain breakdown, top sender domains, and team-level daily stats have no persistent tables at all. These dimensions are only computable from live `emails` rows today.

4. **Missing team-level counters**: There is no `daily_team_email_stats` or `team_analytics_counters` table. Team stats are derived entirely from live email rows joined through `domain_assignments`.

## Correctness Properties

Property 1: Bug Condition - Persistent Analytics Survive Email Deletion

_For any_ analytics query where the result is derived from email volume data (emails per day, total emails, storage bytes, peak hours, domain breakdown, top sender domains, team emails per day, team total emails), the fixed query functions SHALL return values sourced from persistent append-only tables (`daily_email_stats`, `org_analytics_counters`, and new dimension/team tables) that are never decremented on email deletion, ensuring historically accurate results regardless of whether the underlying email rows still exist.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**

Property 2: Preservation - Non-Email-Derived Stats Unchanged

_For any_ analytics query that derives its result from live entity counts (active inboxes, total inboxes, total domains, total teams, total members) or system admin stats, the fixed code SHALL produce exactly the same result as the original code, preserving all existing behavior for queries that do not depend on the `emails` table.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `migrations/000030_analytics_dimension_tables.up.sql` (new)

**Specific Changes**:
1. **Create `hourly_email_stats` table**: `(org_id UUID, date DATE, hour INT, emails_received INT, PRIMARY KEY (org_id, date, hour))` — tracks email volume by hour for peak hours chart
2. **Create `daily_domain_email_stats` table**: `(org_id UUID, date DATE, domain_name TEXT, emails_received INT, PRIMARY KEY (org_id, date, domain_name))` — tracks email volume per receiving domain for domain breakdown chart
3. **Create `daily_sender_domain_stats` table**: `(org_id UUID, date DATE, sender_domain TEXT, emails_received INT, PRIMARY KEY (org_id, date, sender_domain))` — tracks top sender domains
4. **Create `daily_team_email_stats` table**: `(team_id UUID, date DATE, emails_received INT, inboxes_created INT, storage_bytes BIGINT, PRIMARY KEY (team_id, date))` — tracks team-level daily stats
5. **Create `team_analytics_counters` table**: `(team_id UUID PRIMARY KEY, total_emails_received BIGINT, total_inboxes_created BIGINT, total_storage_bytes BIGINT, updated_at TIMESTAMPTZ)` — tracks team-level all-time counters

---

**File**: `internal/repository/postgres/counter_repo.go`

**Specific Changes**:
1. **Add `UpsertHourlyStat` method**: Increments `hourly_email_stats` for the current org, date, and hour
2. **Add `UpsertDomainStat` method**: Increments `daily_domain_email_stats` for the receiving domain
3. **Add `UpsertSenderDomainStat` method**: Increments `daily_sender_domain_stats` for the sender's domain
4. **Add `UpsertDailyTeamStat` method**: Increments `daily_team_email_stats` for the team
5. **Add `IncrementTeamEmail` method**: Increments `team_analytics_counters` for the team
6. **Add `IncrementTeamInbox` method**: Increments `team_analytics_counters.total_inboxes_created`

---

**File**: `internal/realtime/bridge.go`

**Function**: `Subscribe`

**Specific Changes**:
1. **Expand `CounterPersister` interface**: Add methods for `UpsertHourlyStat`, `UpsertDomainStat`, `UpsertSenderDomainStat`, `UpsertDailyTeamStat`, `IncrementTeamEmail`
2. **Add counter calls in `email.received` handler**: After the existing `IncrementEmail` and `UpsertDailyStat` calls, add calls to the new dimension counter methods
3. **Pass additional data in `InboxEvent`**: Add `SenderDomain`, `DomainName`, and `TeamID` fields so the bridge can route increments to the correct dimension tables

---

**File**: `internal/smtp/handler.go`

**Function**: `Process`

**Specific Changes**:
1. **Extract sender domain**: Parse `email.From` to extract the domain portion after `@`
2. **Include sender domain, receiving domain name, and team ID in the published `InboxEvent`**: Look up the domain assignment to get `TeamID` and domain name, then include these in the Redis pub/sub event so `bridge.go` can increment the new dimension tables

---

**File**: `internal/realtime/bridge.go`

**Struct**: `InboxEvent`

**Specific Changes**:
1. **Add fields**: `SenderDomain string`, `DomainName string`, `TeamID uuid.UUID`

---

**File**: `internal/repository/postgres/analytics_repo.go`

**Specific Changes**:
1. **Rewrite `GetOrgStats`**: Replace `COUNT(*) FROM emails` with `org_analytics_counters.total_emails_received` for `TotalEmails`. Replace `SUM(size_bytes) FROM emails` with `org_analytics_counters.total_storage_bytes` for `StorageUsedBytes`. Replace live `TopSenderDomains` query with aggregation from `daily_sender_domain_stats`.
2. **Rewrite `GetOrgEmailsPerDay`**: Replace `COUNT(*) FROM emails` grouped by `received_at` with `SELECT date, emails_received FROM daily_email_stats` using `generate_series` for gap-filling.
3. **Rewrite `GetOrgPeakHours`**: Replace `EXTRACT(HOUR FROM e.received_at)` on live rows with aggregation from `hourly_email_stats`.
4. **Rewrite `GetOrgDomainBreakdown`**: Replace `COUNT(e.id)` joined to live emails with aggregation from `daily_domain_email_stats`.
5. **Rewrite `GetTeamStats`**: Replace `COUNT(*) FROM emails` with `team_analytics_counters.total_emails_received` for `TotalEmails`.
6. **Rewrite `GetTeamEmailsPerDay`**: Replace `COUNT(*) FROM emails` grouped by `received_at` with `SELECT date, emails_received FROM daily_team_email_stats` using `generate_series` for gap-filling.
7. **Rewrite `GetOrgInboxesPerDay`**: Replace `COUNT(*) FROM inboxes` grouped by `created_at` with `SELECT date, inboxes_created FROM daily_email_stats` using `generate_series` for gap-filling.

---

**File**: `internal/service/inbox_service.go`

**Function**: `CreateInbox`

**Specific Changes**:
1. **Add team-level counter increments**: After the existing org-level `IncrementInbox` and `UpsertDailyStat` calls, add `IncrementTeamInbox` and `UpsertDailyTeamStat` calls for the team scope.

---

**File**: `internal/domain/analytics.go` (if needed)

**Specific Changes**:
1. **Add domain types** for any new response shapes if the handler needs to return new dimension data structures. The existing types (`HourlyPoint`, `DomainBreakdown`, `SenderDomain`, `TimeSeriesPoint`) should be sufficient.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that insert emails into the database, record analytics query results, delete the emails, then re-query analytics and compare. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Org Emails Per Day Drop**: Insert 10 emails for an org on a given date, query `GetOrgEmailsPerDay`, delete all emails, re-query — count drops from 10 to 0 (will fail on unfixed code)
2. **Org Total Emails Drop**: Insert 5 emails, query `GetOrgStats.TotalEmails`, delete emails, re-query — drops from 5 to 0 (will fail on unfixed code)
3. **Org Storage Drop**: Insert emails with known `size_bytes`, query `GetOrgStats.StorageUsedBytes`, delete emails, re-query — drops to 0 (will fail on unfixed code)
4. **Peak Hours Vanish**: Insert emails at specific hours, query `GetOrgPeakHours`, delete emails, re-query — all hours show 0 (will fail on unfixed code)
5. **Team Emails Per Day Drop**: Insert emails for a team, query `GetTeamEmailsPerDay`, delete emails, re-query — drops to 0 (will fail on unfixed code)

**Expected Counterexamples**:
- All time-series and aggregate queries return reduced/zero values after email deletion
- Root cause confirmed: queries read from `emails` table which loses rows on delete

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL query WHERE isBugCondition(query) DO
  // Insert emails, record counters, delete emails, re-query
  insertEmails(query.orgID, query.emailData)
  resultBefore := executeAnalyticsQuery(query)
  deleteEmails(query.orgID)
  resultAfter := executeAnalyticsQuery(query)
  ASSERT resultAfter == resultBefore  // persistent data survives deletion
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL query WHERE NOT isBugCondition(query) DO
  ASSERT originalFunction(query) = fixedFunction(query)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for live-entity queries (`ActiveInboxes`, `TotalDomains`, `TotalTeams`, `TotalMembers`, system stats), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Live Entity Counts Preserved**: Verify `ActiveInboxes`, `TotalInboxes`, `TotalDomains`, `TotalTeams`, `TotalMembers` return identical values before and after the fix for the same database state
2. **System Stats Preserved**: Verify `GetSystemStats` returns identical values before and after the fix
3. **Counter Increment Preserved**: Verify that `IncrementEmail`, `IncrementInbox`, `UpsertDailyStat` continue to work identically after adding new counter methods
4. **API Response Shape Preserved**: Verify that the JSON response structure from analytics endpoints remains identical

### Unit Tests

- Test each rewritten query in `analytics_repo.go` returns correct values from persistent tables after email deletion
- Test new counter methods (`UpsertHourlyStat`, `UpsertDomainStat`, `UpsertSenderDomainStat`, `UpsertDailyTeamStat`, `IncrementTeamEmail`, `IncrementTeamInbox`) correctly upsert rows
- Test `GetOrgStats` returns persistent counter values for `TotalEmails` and `StorageUsedBytes`
- Test `GetTeamStats` returns persistent counter values for `TotalEmails`
- Test edge cases: no emails ever received (counters at zero), single email, counter row missing (graceful fallback)

### Property-Based Tests

- Generate random sequences of email insertions and deletions, verify analytics query results never decrease after deletion (monotonicity property)
- Generate random org/team configurations, verify live-entity counts (`ActiveInboxes`, `TotalDomains`, etc.) are unaffected by the fix
- Generate random email metadata (sender domains, hours, receiving domains), verify dimension table aggregations match the insertion history

### Integration Tests

- Test full email receive flow through SMTP handler → bridge → counter increments → analytics query, verify all dimension tables are populated
- Test cleanup worker deletes emails, then verify analytics endpoints still return historically accurate data
- Test team-level analytics after email deletion to verify team counters persist
- Test backfill worker (if implemented) correctly populates dimension tables from existing `daily_email_stats` data
