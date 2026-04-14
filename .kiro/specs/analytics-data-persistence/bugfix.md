# Bugfix Requirements Document

## Introduction

Analytics charts and stat cards on the dashboard (`/dashboard`) and analytics (`/analytics`) pages lose their data when emails are deleted — either manually by users or automatically by the cleanup worker. The root cause is that all time-series queries (`GetOrgEmailsPerDay`, `GetTeamEmailsPerDay`, `GetOrgPeakHours`, `GetOrgDomainBreakdown`) and several aggregate stats (`TotalEmails`, `StorageUsedBytes`, `TopSenderDomains`) are computed via live `COUNT(*)`/`SUM()` queries against the `emails` table. When rows are removed, the counts drop to zero. The system already has persistent, append-only counters (`org_analytics_counters` and `daily_email_stats` tables) that are never decremented on delete, but these are not used by the affected queries.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN emails are deleted (manually or via cleanup worker) THEN the system returns zero or reduced counts for the "Email Volume" / "Emails Per Day" chart because `GetOrgEmailsPerDay` queries `COUNT(*) FROM emails` grouped by `received_at`

1.2 WHEN emails are deleted THEN the system returns zero or reduced counts for the "This Week" card because it derives its value from live email row counts

1.3 WHEN emails are deleted THEN the system returns zero or reduced value for `OrgStats.TotalEmails` because `GetOrgStats` queries `COUNT(*) FROM emails`

1.4 WHEN emails are deleted THEN the system returns zero or reduced value for `OrgStats.StorageUsedBytes` because `GetOrgStats` queries `SUM(size_bytes) FROM emails`

1.5 WHEN emails are deleted THEN the system returns an empty list for `OrgStats.TopSenderDomains` because the query groups by live `emails.from_address`

1.6 WHEN emails are deleted THEN the system returns zero or reduced counts for the "Peak Hours" chart because `GetOrgPeakHours` queries `EXTRACT(HOUR FROM e.received_at)` on live email rows

1.7 WHEN emails are deleted THEN the system returns zero or reduced counts for the "Domain Breakdown" chart because `GetOrgDomainBreakdown` queries `COUNT(e.id)` joined to live email rows

1.8 WHEN emails are deleted THEN the system returns zero or reduced counts for team-level "Emails Per Day" chart because `GetTeamEmailsPerDay` queries `COUNT(*) FROM emails` for the team scope

1.9 WHEN emails are deleted THEN the system returns zero or reduced value for `TeamStats.TotalEmails` because `GetTeamStats` queries `COUNT(*) FROM emails` for the team scope

### Expected Behavior (Correct)

2.1 WHEN emails are deleted THEN the system SHALL continue to return historically accurate email-per-day counts for the "Email Volume" chart by reading from the persistent `daily_email_stats` table instead of counting live email rows

2.2 WHEN emails are deleted THEN the system SHALL continue to return historically accurate "This Week" totals by summing from the persistent `daily_email_stats` table

2.3 WHEN emails are deleted THEN the system SHALL return the all-time total emails received from `org_analytics_counters.total_emails_received` for `OrgStats.TotalEmails`

2.4 WHEN emails are deleted THEN the system SHALL return the all-time total storage from `org_analytics_counters.total_storage_bytes` for `OrgStats.StorageUsedBytes`

2.5 WHEN emails are deleted THEN the system SHALL continue to return historically accurate top sender domain data by reading from persistent per-day dimension tables rather than live email rows

2.6 WHEN emails are deleted THEN the system SHALL continue to return historically accurate peak hour data by reading from persistent per-day dimension tables rather than live email rows

2.7 WHEN emails are deleted THEN the system SHALL continue to return historically accurate domain breakdown data by reading from persistent per-day dimension tables rather than live email rows

2.8 WHEN emails are deleted THEN the system SHALL continue to return historically accurate team-level email-per-day counts by reading from persistent team-scoped daily stats rather than live email rows

2.9 WHEN emails are deleted THEN the system SHALL return the all-time total emails received for `TeamStats.TotalEmails` from persistent team-level counters rather than live email rows

### Unchanged Behavior (Regression Prevention)

3.1 WHEN emails have NOT been deleted THEN the system SHALL CONTINUE TO return accurate email-per-day time-series data that matches the actual number of emails received each day

3.2 WHEN querying `ActiveInboxes`, `TotalDomains`, `TotalTeams`, or `TotalMembers` THEN the system SHALL CONTINUE TO return live counts from their respective entity tables (these are not affected by email deletion)

3.3 WHEN querying `TotalInboxes` or `ActiveInboxes` on org or team stats THEN the system SHALL CONTINUE TO return live counts from the `inboxes` table

3.4 WHEN querying `TotalEmailsReceived`, `TotalInboxesCreated`, or `TotalStorageBytes` persistent counters THEN the system SHALL CONTINUE TO return correct values from `org_analytics_counters` (these already work correctly)

3.5 WHEN a new email is received THEN the system SHALL CONTINUE TO increment both the persistent counters (`org_analytics_counters`, `daily_email_stats`) and any new dimension tables so that analytics remain accurate going forward

3.6 WHEN querying system-level admin stats (`GetSystemStats`) THEN the system SHALL CONTINUE TO return live counts (admin stats reflect current state, not historical totals)

3.7 WHEN querying inboxes-per-day time-series (`GetOrgInboxesPerDay`) THEN the system SHALL CONTINUE TO return data from the persistent `daily_email_stats.inboxes_created` column (this already reads from persistent data via `daily_email_stats`)
