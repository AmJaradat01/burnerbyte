# Bugfix Requirements Document

## Introduction

The dashboard page (`/dashboard`) and analytics page (`/analytics`) share the same backend data but have accumulated inconsistencies, missing features, UX gaps, and security concerns. The dashboard uses outdated tooltip patterns, lacks trend indicators and charts present on the analytics page, and uses a different chart type (AreaChart vs BarChart) for the same data. The analytics page has an empty state gap and a responsive grid issue. The domain time-series endpoint lacks domain-ownership validation, and the expanded domain chart has no loading feedback on date range changes.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the dashboard renders chart tooltips THEN the system displays old inline Recharts `Tooltip` with basic `contentStyle` and `formatter` props instead of the `ChartTooltip` component used on the analytics page

1.2 WHEN the dashboard displays storage information THEN the system only shows a static number in a stat card with no trend visualization, while the analytics page shows a full StorageTrendChart

1.3 WHEN the dashboard displays stat cards THEN the system only shows simple delta text ("Today vs yesterday") without period-over-period percentage trend indicators ("+X.X% / -X.X%") that the analytics MetricCards provide

1.4 WHEN the dashboard renders the "Email Volume" chart THEN the system uses an AreaChart, while the analytics page uses a BarChart for the same daily discrete email data, creating visual inconsistency

1.5 WHEN the dashboard renders metrics THEN the system omits "Emails Received" (cumulative) and "Inboxes Created" (cumulative) metrics that are available from the same API and displayed on the analytics page

1.6 WHEN the dashboard renders the "This Week" sidebar card THEN the system duplicates the main email volume chart with a 7-day bar chart using different styling, providing redundant information instead of unique insights

1.7 WHEN the analytics page domain_breakdown data is empty THEN the system hides the "Emails by Domain" section entirely with no empty state, violating the project's empty state conventions

1.8 WHEN the analytics page metric grid renders on medium screens (768-1024px) THEN the system uses `lg:grid-cols-8` causing 4 columns at md breakpoint which squishes 8 metric cards awkwardly

1.9 WHEN the expanded domain drill-down chart refetches data due to date range change THEN the system provides no visual loading indicator on the expanded chart, even though the data does refetch correctly

1.10 WHEN a user queries the domain time-series endpoint with an arbitrary `domain` query parameter THEN the system does not validate that the requested domain belongs to the querying organization (the SQL filters by `org_id` preventing data leakage, but invalid domain names still execute unnecessary queries)

1.11 WHEN analytics endpoints receive heavy traffic THEN the system applies only the general rate limiter (300 req/min for authenticated users) without analytics-specific throttling for the expensive SQL queries (generate_series JOINs)

1.12 WHEN the WebSocket admin-stats endpoint broadcasts SystemStats THEN the system correctly restricts to `IsSystemAdmin` only, which is the intended behavior for system-wide aggregated stats

### Expected Behavior (Correct)

2.1 WHEN the dashboard renders chart tooltips THEN the system SHALL use the shared `ChartTooltip` component with "% vs avg" comparison, matching the analytics page behavior

2.2 WHEN the dashboard displays storage information THEN the system SHALL show a mini storage sparkline or trend indicator alongside the stat card value, using storage_per_day data from the insights endpoint

2.3 WHEN the dashboard displays stat cards THEN the system SHALL show period-over-period percentage trend arrows (+X.X% / -X.X%) computed from available time-series data, consistent with the analytics page MetricCards

2.4 WHEN the dashboard renders the "Email Volume" chart THEN the system SHALL use a BarChart (matching the analytics page) since daily email counts are discrete data better suited to bar representation

2.5 WHEN the dashboard renders metrics THEN the system SHALL display "Emails Received" (cumulative) and "Inboxes Created" (cumulative) metrics sourced from the existing analytics API response

2.6 WHEN the dashboard renders the sidebar card THEN the system SHALL replace the redundant weekly chart with more useful content such as inbox activity trend or top senders summary

2.7 WHEN the analytics page domain_breakdown data is empty THEN the system SHALL display a proper empty state with a Globe icon, descriptive title, and guidance text following the project's empty state conventions

2.8 WHEN the analytics page metric grid renders on medium screens THEN the system SHALL use a responsive grid (`md:grid-cols-4 xl:grid-cols-8` or equivalent) so metric cards are readable at all breakpoints without squishing

2.9 WHEN the expanded domain drill-down chart refetches data due to date range change THEN the system SHALL display a loading skeleton or indicator while the new data is being fetched

2.10 WHEN a user queries the domain time-series endpoint THEN the system SHALL validate that the requested domain exists in the organization's domain list before executing the time-series query, returning a 404 or empty result for non-existent domains

2.11 WHEN analytics endpoints receive traffic THEN the system SHALL apply the existing general rate limiter which is already active on all authenticated routes (300 req/min), and the expensive queries are bounded by the `days <= 365` validation

2.12 WHEN the WebSocket admin-stats endpoint is accessed THEN the system SHALL CONTINUE to restrict access to `IsSystemAdmin` users only, broadcasting system-wide aggregated data as currently implemented

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the dashboard renders for admin users THEN the system SHALL CONTINUE TO show the greeting header, auto-refresh toggle, refresh button, and new inbox link

3.2 WHEN the dashboard renders recent activity THEN the system SHALL CONTINUE TO display audit log entries with action dots, humanized action names, actor emails, and time-ago timestamps

3.3 WHEN the dashboard renders quick links THEN the system SHALL CONTINUE TO display navigation links to Inboxes, Domains, Teams, Webhooks, API Keys, and Analytics

3.4 WHEN the analytics page renders with a team selected THEN the system SHALL CONTINUE TO display team-specific analytics with emails per day, inbox creation trend, and storage trend charts

3.5 WHEN the analytics page date range selector changes THEN the system SHALL CONTINUE TO refetch all time-series data (emails per day, insights, domain charts) with the new day count

3.6 WHEN the analytics page domain breakdown items are clicked THEN the system SHALL CONTINUE TO expand/collapse the domain detail chart with proper aria-expanded accessibility attributes

3.7 WHEN the WebSocket auto-refresh is enabled on the dashboard THEN the system SHALL CONTINUE TO update stats in real-time via the admin-stats WebSocket connection with reconnect logic

3.8 WHEN non-admin users access the dashboard route THEN the system SHALL CONTINUE TO redirect them to the home page

3.9 WHEN the analytics endpoints are called THEN the system SHALL CONTINUE TO enforce `org.analytics.view` permission checks and `org_id` scoping in all SQL queries
