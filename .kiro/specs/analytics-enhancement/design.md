# Analytics Enhancement Bugfix Design

## Overview

The analytics page (`/analytics`) fails to render multiple data fields already returned by the backend API, resulting in an incomplete dashboard experience. The Org view omits storage metrics, member/team counts, and cumulative counters; chart tooltips lack contextual comparison data; and the Team view has significantly less detail than the Org view despite available data. This fix surfaces all existing backend data in the UI, adds trend indicators to summary metrics, enhances tooltip formatting, and brings the Team view closer to parity with the Org view.

## Glossary

- **Bug_Condition (C)**: The condition where the analytics page loads but fails to render data fields that the backend already provides (storage, members, teams, cumulative counters, storage trend chart, enhanced tooltips, Team view metrics)
- **Property (P)**: All available backend data is rendered in the UI with proper formatting, trend indicators, and contextual tooltips
- **Preservation**: Existing charts (Emails per Day, Inbox Creation Trend, Peak Hours, Domain Breakdown, Top Sender Domains), date range selector behavior, view toggling, error/empty states must remain unchanged
- **OrgStats**: The backend response from `GET /orgs/:id/analytics` containing all organization-level metrics
- **TeamStats**: The backend response from `GET /orgs/:id/teams/:id/analytics` containing team-level metrics
- **Insights**: The backend response from `GET /orgs/:id/analytics/insights` containing time-series, peak hours, and domain breakdown data including `DailyStat.StorageBytes`
- **Summary Metric Card**: A compact UI element displaying a single KPI with label, formatted value, and optional trend indicator

## Bug Details

### Bug Condition

The bug manifests when the analytics page renders without surfacing all available backend data. The `OrgAnalytics` component fetches `OrgStats` (which includes `storage_used_bytes`, `total_storage_bytes`, `total_members`, `total_teams`, `total_emails_received`, `total_inboxes_created`) and `Insights` (which includes `DailyStat.StorageBytes`) but only renders a subset as inline text. The `TeamAnalytics` component fetches `TeamStats` but only shows a text summary and single chart.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type AnalyticsPageRender
  OUTPUT: boolean

  RETURN (input.view = "org" AND (
           NOT rendersStorageMetric(input, "storage_used_bytes", "total_storage_bytes")
           OR NOT rendersMemberTeamCounts(input, "total_members", "total_teams")
           OR NOT rendersCumulativeCounters(input, "total_emails_received", "total_inboxes_created")
           OR NOT rendersStorageTrendChart(input, "DailyStat.StorageBytes")
           OR NOT rendersSummaryMetricCards(input)
           OR NOT rendersEnhancedTooltips(input)
         ))
         OR (input.view = "team" AND (
           NOT rendersSummaryMetricCards(input)
         ))
END FUNCTION
```

### Examples

- Org view loads: `storage_used_bytes = 1_073_741_824`, `total_storage_bytes = 5_368_709_120` but no storage metric is visible. Expected: "1.0 GB / 5.0 GB" displayed in a summary metric.
- Org view loads: `total_members = 12`, `total_teams = 4` but these values only appear in no dedicated UI element. Expected: dedicated summary metrics showing "12 Members" and "4 Teams".
- Org view loads: `total_emails_received = 45230`, `total_inboxes_created = 312` but not rendered. Expected: cumulative counters displayed as summary metrics.
- Org view loads: insights response contains `DailyStat.StorageBytes` array but no storage trend chart is rendered. Expected: a line/bar chart showing daily storage consumption.
- User hovers a chart bar showing count=142 on 2024-01-15. Tooltip shows "142" only. Expected: "142 emails, Daily avg: 98 (+44.9%)".
- Team view loads: `total_emails = 890`, `total_inboxes = 23`, `active_inboxes = 18`, `total_members = 6` but only inline text summary visible. Expected: summary metric cards for each stat.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- "Emails per Day" bar chart with average reference line must continue to render identically
- "Inbox Creation Trend" chart from insights endpoint must continue to render
- "Email Activity by Hour" peak hours chart must continue to render
- "Emails by Domain" breakdown list with percentages must continue to render
- "Top Sender Domains" ranked list with percentages must continue to render
- Date range selector (7, 30, 90 days) must continue to refetch time-series and insights data
- `NoOrgState` component must continue to display when no organization is selected
- `ErrorState` component with retry action must continue to display on API failures
- View selector toggling between Organization and Team must continue to work

**Scope:**
All inputs that do NOT involve the newly surfaced metrics, tooltips, or Team view enhancements should be completely unaffected by this fix. This includes:
- All existing chart rendering logic and data transformations
- API query keys and fetch patterns for existing endpoints
- Error and loading state handling
- View toggling and date range selection mechanics
- Existing inline text summaries (can be removed if replaced by metric cards)

## Hypothesized Root Cause

Based on the bug description, the most likely issues are:

1. **Incomplete OrgStats Interface**: The frontend TypeScript `OrgStats` interface does not include `total_emails_received`, `total_inboxes_created`, or `total_storage_bytes` fields, so even though the backend returns them, the code never references them.

2. **Missing Summary Metric Cards Component**: The page uses an inline `<p>` text summary instead of dedicated metric cards. No `MetricCard` component exists to display individual KPIs with trend indicators.

3. **Missing Storage Trend Chart**: The Insights response likely includes `storage_bytes` data (via `DailyStat`), but the frontend `Insights` TypeScript interface does not model it and no chart renders it.

4. **Basic Tooltip Implementation**: The current `Tooltip` `formatter` prop provides simple string interpolation (`${count} (Avg: ${avg})`) rather than computing period-over-period comparison or formatting with locale-aware numbers and percentage deltas.

5. **Team View Lacks Metric Cards**: The `TeamAnalytics` component renders only a `<p>` text summary and a single chart. It does not have summary metric cards despite `TeamStats` providing `total_emails`, `total_inboxes`, `active_inboxes`, and `total_members`.

## Correctness Properties

Property 1: Bug Condition - Missing Org Metrics Rendered

_For any_ analytics page render where the Org view is active and OrgStats data is successfully loaded, the fixed page SHALL display summary metric cards for: total emails, total inboxes, total domains, storage used (formatted as human-readable bytes relative to total), total members, and total teams, each with a trend indicator showing change relative to the previous equivalent period.

**Validates: Requirements 2.1, 2.2, 2.3, 2.5**

Property 2: Bug Condition - Storage Trend Chart Rendered

_For any_ analytics page render where the Org view is active and insights data containing daily storage bytes is successfully loaded, the fixed page SHALL render a storage trend chart visualizing `DailyStat.StorageBytes` over the selected time range.

**Validates: Requirements 2.4**

Property 3: Bug Condition - Enhanced Tooltips

_For any_ chart hover interaction on the analytics page, the tooltip SHALL display the data value with locale-formatted numbers, the date/time label, and a comparison to the daily average for that metric (showing percentage delta).

**Validates: Requirements 2.6**

Property 4: Bug Condition - Team View Summary Metrics

_For any_ analytics page render where the Team view is active and TeamStats data is successfully loaded, the fixed page SHALL display summary metric cards for: total emails, total inboxes, active inboxes, and total members.

**Validates: Requirements 2.7**

Property 5: Preservation - Existing Charts Unchanged

_For any_ analytics page render, the fixed code SHALL produce the same chart output (Emails per Day with reference line, Inbox Creation Trend, Peak Hours, Domain Breakdown, Top Sender Domains) as the original code, preserving all existing visualization behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

Property 6: Preservation - Navigation and Error Handling Unchanged

_For any_ interaction with the date range selector, view toggler, or error/empty states, the fixed code SHALL produce the same behavior as the original code, preserving data refetching, view switching, NoOrgState display, and ErrorState with retry.

**Validates: Requirements 3.6, 3.7, 3.8, 3.9**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `web/src/app/analytics/page.tsx`

**Specific Changes**:

1. **Extend TypeScript Interfaces**: Add `total_emails_received`, `total_inboxes_created`, and `total_storage_bytes` to the `OrgStats` interface. Add `storage_per_day` (or equivalent) to the `Insights` interface for daily storage data.

2. **Create Summary Metric Cards**: Build a `MetricCard` inline component (or extract to a shared component) that displays:
   - Label (text-label class)
   - Value (tabular-nums, locale-formatted)
   - Trend indicator (percentage change vs. previous period, green up / red down / neutral)
   - Use `border-t` / negative space layout per steering (no identical card grids, no nested cards)

3. **Add Org Summary Metrics Row**: Replace the inline `<p>` text summary with a responsive grid of metric cards: total emails, total inboxes, total domains, storage used/total, total members, total teams. Use `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4`.

4. **Add Storage Trend Chart**: Render a new chart section using `DailyStat.StorageBytes` data from the insights endpoint. Format Y-axis in human-readable bytes. Place in the left column below existing charts.

5. **Enhance Chart Tooltips**: Create a custom tooltip component that:
   - Formats values with `toLocaleString()`
   - Shows the date/time label clearly
   - Computes and displays comparison to daily average (e.g., "+45% vs avg")
   - Uses `var(--popover)` background, `var(--border)` border

6. **Add Team Summary Metrics Row**: Replace the inline `<p>` text summary in `TeamAnalytics` with metric cards for: total emails, total inboxes, active inboxes, total members.

7. **Lazy-load New Chart**: The storage trend chart must be lazy-loaded via `dynamic()` per steering rules. Consider extracting chart components to separate files for code splitting.

8. **Trend Calculation**: Compute trend by comparing current period stats to a hypothetical previous period. If no previous period data is available from the API, omit the trend indicator gracefully (show neutral dash).

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write component tests that render `OrgAnalytics` and `TeamAnalytics` with mocked API responses containing all backend fields, then assert that the missing data is rendered. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Storage Metric Test**: Render OrgAnalytics with `storage_used_bytes=1073741824, total_storage_bytes=5368709120`, assert "1.0 GB / 5.0 GB" or equivalent is in the DOM (will fail on unfixed code)
2. **Member/Team Count Test**: Render OrgAnalytics with `total_members=12, total_teams=4`, assert metric cards with these values exist (will fail on unfixed code)
3. **Cumulative Counters Test**: Render OrgAnalytics with `total_emails_received=45230, total_inboxes_created=312`, assert these are rendered (will fail on unfixed code)
4. **Storage Trend Chart Test**: Render OrgAnalytics with insights containing storage_per_day data, assert a storage chart is present (will fail on unfixed code)
5. **Enhanced Tooltip Test**: Simulate hover on a chart bar, assert tooltip contains average comparison text (will fail on unfixed code)
6. **Team Metrics Test**: Render TeamAnalytics with full TeamStats, assert metric cards for all four stats exist (will fail on unfixed code)

**Expected Counterexamples**:
- DOM queries for storage, member, team metric cards return null
- Tooltip content lacks percentage comparison text
- Possible causes: missing interface fields, no MetricCard component, basic tooltip formatter

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := renderAnalyticsPage_fixed(input)
  ASSERT allMetricCardsPresent(result)
  ASSERT storageTrendChartPresent(result)
  ASSERT tooltipShowsComparison(result)
  ASSERT teamMetricCardsPresent(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT renderAnalyticsPage_original(input) = renderAnalyticsPage_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for existing charts, error states, loading states, and view toggling, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Emails Per Day Chart Preservation**: Verify the bar chart renders identically with average reference line for arbitrary TimeSeriesPoint[] data
2. **Inbox Creation Chart Preservation**: Verify inbox trend chart renders for arbitrary inboxes_per_day data
3. **Peak Hours Chart Preservation**: Verify hourly chart renders for arbitrary HourlyPoint[] data
4. **Domain Lists Preservation**: Verify domain breakdown and top sender lists render correctly for arbitrary domain data
5. **Error State Preservation**: Verify ErrorState renders with retry on API failure
6. **Date Range Preservation**: Verify changing date range triggers refetch with correct days parameter
7. **View Toggle Preservation**: Verify toggling between org/team views renders the correct component

### Unit Tests

- Test `MetricCard` component renders label, formatted value, and trend indicator correctly
- Test byte formatting utility (e.g., `formatBytes(1073741824)` returns "1.0 GB")
- Test trend percentage calculation (current vs. previous period)
- Test enhanced tooltip formatter outputs correct comparison text
- Test that `OrgStats` interface correctly types all backend fields
- Test edge cases: zero storage, zero members, empty insights data

### Property-Based Tests

- Generate random OrgStats values and verify all metric cards render with correctly formatted numbers
- Generate random TimeSeriesPoint[] arrays and verify tooltip shows correct average comparison for any hovered point
- Generate random TeamStats values and verify all four metric cards render
- Generate arbitrary insights data and verify storage trend chart renders when data is present, empty state when absent

### Integration Tests

- Test full analytics page load with Organization view, verify all sections render
- Test switching from Org to Team view and back, verify correct data displayed
- Test date range change triggers refetch and updates all time-series charts
- Test error recovery: API fails then retry succeeds, verify full page renders
- Test with empty/zero data: verify graceful empty states without crashes
