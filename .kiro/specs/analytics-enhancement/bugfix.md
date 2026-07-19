# Bugfix Requirements Document

## Introduction

The analytics page (`/analytics`) fails to surface data already available from the backend API, and provides a degraded experience for Team views compared to the Organization view. The backend exposes `storage_used_bytes`, `total_storage_bytes`, `total_members`, `total_teams`, `TotalEmailsReceived`, `TotalInboxesCreated`, and `DailyStat.StorageBytes`, but none of these fields are rendered in the UI. Additionally, the existing charts lack rich interactions (tooltips with comparison data, trend indicators) and the Team view shows only a single "Emails per Day" chart with no summary metrics.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the Org analytics view is loaded THEN the system does not display storage usage metrics (`storage_used_bytes`, `total_storage_bytes`) despite the backend returning them in the OrgStats response

1.2 WHEN the Org analytics view is loaded THEN the system does not display `total_members` or `total_teams` counts despite the backend returning them in the OrgStats response

1.3 WHEN the Org analytics view is loaded THEN the system does not display cumulative counters (`total_emails_received`, `total_inboxes_created`) despite the backend returning them in the OrgStats response

1.4 WHEN the Org analytics view is loaded THEN the system does not render a daily storage trend chart despite the backend providing `DailyStat.StorageBytes` data

1.5 WHEN the Org analytics view is loaded THEN the system shows only an inline text summary instead of dedicated summary metric cards with trend indicators for key stats (total emails, inboxes, domains, storage, members, teams)

1.6 WHEN a user hovers over chart bars THEN the tooltip shows basic count data without period-over-period comparison or contextual formatting (e.g., percentage change from previous period)

1.7 WHEN the Team analytics view is selected THEN the system shows only a single "Emails per Day" chart and an inline text summary, lacking parity with the Org view's multi-chart layout, peak hours, and domain breakdown sections

### Expected Behavior (Correct)

2.1 WHEN the Org analytics view is loaded THEN the system SHALL display a storage usage metric showing `storage_used_bytes` relative to `total_storage_bytes` with human-readable formatting (e.g., "1.2 GB / 5 GB")

2.2 WHEN the Org analytics view is loaded THEN the system SHALL display `total_members` and `total_teams` counts in dedicated summary metric cards

2.3 WHEN the Org analytics view is loaded THEN the system SHALL display `total_emails_received` and `total_inboxes_created` cumulative counters in dedicated summary metric cards

2.4 WHEN the Org analytics view is loaded THEN the system SHALL render a daily storage trend chart using `DailyStat.StorageBytes` data from the insights endpoint, showing storage consumption over the selected time range

2.5 WHEN the Org analytics view is loaded THEN the system SHALL display a row of summary metric cards at the top of the page showing: total emails, total inboxes, total domains, storage used, total members, and total teams, each with a trend indicator showing change relative to the previous equivalent period

2.6 WHEN a user hovers over chart bars THEN the tooltip SHALL display the data value with locale-formatted numbers, the date/time label, and a comparison to the daily average for that metric

2.7 WHEN the Team analytics view is selected THEN the system SHALL display summary metric cards (total emails, total inboxes, active inboxes, total members) and the "Emails per Day" chart, providing a comparable level of detail to the Org view where data is available

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the Org analytics view is loaded THEN the system SHALL CONTINUE TO display the "Emails per Day" bar chart with average reference line

3.2 WHEN the Org analytics view is loaded THEN the system SHALL CONTINUE TO display the "Inbox Creation Trend" chart from the insights endpoint

3.3 WHEN the Org analytics view is loaded THEN the system SHALL CONTINUE TO display the "Email Activity by Hour" peak hours chart

3.4 WHEN the Org analytics view is loaded THEN the system SHALL CONTINUE TO display the "Emails by Domain" breakdown list

3.5 WHEN the Org analytics view is loaded THEN the system SHALL CONTINUE TO display the "Top Sender Domains" ranked list with percentages

3.6 WHEN the date range selector is changed THEN the system SHALL CONTINUE TO refetch time-series and insights data for the selected period (7, 30, or 90 days)

3.7 WHEN no organization is selected THEN the system SHALL CONTINUE TO display the NoOrgState component

3.8 WHEN API requests fail THEN the system SHALL CONTINUE TO display the ErrorState component with a retry action

3.9 WHEN the view selector is toggled between Organization and Team THEN the system SHALL CONTINUE TO switch between the respective analytics views
