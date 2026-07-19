# Implementation Plan

## Overview

This plan implements the analytics enhancement bugfix using the exploratory bugfix workflow: first write tests to confirm the bug exists, then write preservation tests for existing behavior, then implement the fix, and finally validate everything passes.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Missing Analytics Data Not Rendered
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the analytics page fails to render available backend data
  - **Scoped PBT Approach**: Scope the property to concrete failing cases where OrgStats/TeamStats contain data fields that are not rendered in the DOM
  - Test that rendering `OrgAnalytics` with mocked API responses containing `storage_used_bytes=1073741824`, `total_storage_bytes=5368709120`, `total_members=12`, `total_teams=4`, `total_emails_received=45230`, `total_inboxes_created=312` does NOT produce metric cards for these values (from Bug Condition in design: `isBugCondition` returns true when `NOT rendersStorageMetric` OR `NOT rendersMemberTeamCounts` OR `NOT rendersCumulativeCounters` OR `NOT rendersSummaryMetricCards` OR `NOT rendersStorageTrendChart`)
  - Test that rendering `TeamAnalytics` with `total_emails=890`, `total_inboxes=23`, `active_inboxes=18`, `total_members=6` does NOT produce summary metric cards
  - Test that hovering a chart bar does NOT show average comparison percentage in tooltip
  - Test that insights response containing `storage_per_day` data does NOT produce a storage trend chart
  - Run test on UNFIXED code - expect FAILURE (this confirms the bug exists)
  - **EXPECTED OUTCOME**: Test FAILS because the current code renders inline text summary instead of metric cards, omits storage/member/team fields, has no storage chart, and tooltips lack comparison data
  - Document counterexamples found (e.g., "queryByText('1.0 GB / 5.0 GB') returns null", "no element with role matching metric card for members")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Charts and Navigation Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: "Emails per Day" bar chart with average reference line renders correctly on unfixed code with arbitrary TimeSeriesPoint[] data
  - Observe: "Inbox Creation Trend" chart renders for insights.inboxes_per_day data on unfixed code
  - Observe: "Email Activity by Hour" chart renders for insights.peak_hours data on unfixed code
  - Observe: "Emails by Domain" breakdown list renders with percentages on unfixed code
  - Observe: "Top Sender Domains" list renders with rank numbers and percentages on unfixed code
  - Observe: DateRangeSelector changes trigger refetch with correct days parameter on unfixed code
  - Observe: View toggle between Organization and Team renders correct component on unfixed code
  - Observe: NoOrgState renders when no organization is selected on unfixed code
  - Observe: ErrorState with retry renders on API failure on unfixed code
  - Write property-based tests: for all valid TimeSeriesPoint[] arrays, the EmailChart component renders a bar chart with average reference line
  - Write property-based tests: for all valid Insights data, existing chart sections render correctly
  - Write property-based tests: for all valid OrgStats with top_sender_domains, the ranked list renders with correct percentages
  - Write property-based tests: for any date range selection (7, 30, 90), the query refetch is triggered with the correct parameter
  - Verify all preservation tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3. Fix for analytics page missing data rendering and enhanced interactions

  - [x] 3.1 Extend TypeScript interfaces
    - Add `total_emails_received: number` and `total_inboxes_created: number` to `OrgStats` interface
    - Add `total_storage_bytes: number` to `OrgStats` interface
    - Add `storage_per_day: { date: string; storage_bytes: number }[]` to `Insights` interface
    - Verify TeamStats interface already has all needed fields (`total_emails`, `total_inboxes`, `active_inboxes`, `total_members`)
    - _Bug_Condition: isBugCondition(input) where OrgStats interface omits total_emails_received, total_inboxes_created, total_storage_bytes; Insights interface omits storage_per_day_
    - _Expected_Behavior: All backend fields are typed and accessible in the component_
    - _Preservation: Existing interface fields remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.2 Create MetricCard component
    - Build inline `MetricCard` component with props: `label`, `value` (formatted string), `trend` (percentage number or null)
    - Use `text-label` class for label, `tabular-nums` for value
    - Trend indicator: green arrow up for positive, red arrow down for negative, neutral dash when null
    - Use Lucide `TrendingUp` / `TrendingDown` icons for trend arrows
    - Layout: `border-t pt-4` with negative space (per steering: no nested cards, no identical card grids)
    - Ensure WCAG AA contrast on trend colors against background
    - _Bug_Condition: No MetricCard component exists; inline text summary used instead_
    - _Expected_Behavior: MetricCard renders label, locale-formatted value, and trend indicator_
    - _Preservation: No existing component is modified_
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7_

  - [x] 3.3 Add Org summary metrics row
    - Replace inline `<p>` text summary in `OrgAnalytics` with a responsive grid of 6 MetricCards
    - Grid layout: `grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4`
    - Metrics: Total Emails, Total Inboxes, Total Domains, Storage Used (formatted as "X.Y GB / Z.Z GB"), Total Members, Total Teams
    - Format storage with a `formatBytes` utility (human-readable)
    - All numeric values use `toLocaleString()` and `tabular-nums`
    - _Bug_Condition: isBugCondition returns true when NOT rendersSummaryMetricCards(input)_
    - _Expected_Behavior: 6 metric cards visible with formatted values and trend indicators_
    - _Preservation: Existing charts below remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 3.4 Add Storage Trend Chart
    - Create a new chart section using `storage_per_day` data from insights endpoint
    - Use Recharts BarChart (or AreaChart) with Y-axis formatted in human-readable bytes
    - Place below existing charts in the left column
    - Lazy-load via `dynamic(() => import(...), { ssr: false })` per steering rules
    - Include empty state when no storage data available
    - Use `var(--chart-4)` or next available chart color token
    - _Bug_Condition: isBugCondition returns true when NOT rendersStorageTrendChart(input, "DailyStat.StorageBytes")_
    - _Expected_Behavior: Storage trend chart visualizes daily storage consumption over selected time range_
    - _Preservation: Existing charts in left and right columns unchanged_
    - _Requirements: 2.4_

  - [x] 3.5 Enhance Chart Tooltips
    - Create a custom `ChartTooltip` component replacing inline Recharts Tooltip formatters
    - Display: locale-formatted data value, clear date/time label, comparison to daily average with percentage delta (e.g., "+44.9% vs avg")
    - Style with `var(--popover)` background, `var(--border)` border, `var(--popover-foreground)` text
    - Apply to all existing charts (Emails per Day, Inbox Creation, Peak Hours) and new Storage chart
    - Use `tabular-nums` for all numeric values in tooltip
    - _Bug_Condition: isBugCondition returns true when NOT rendersEnhancedTooltips(input)_
    - _Expected_Behavior: Tooltip shows value with locale formatting, date label, and avg comparison percentage_
    - _Preservation: Tooltip positioning and trigger behavior unchanged; chart data rendering unchanged_
    - _Requirements: 2.6_

  - [x] 3.6 Add Team summary metrics row
    - Replace inline `<p>` text summary in `TeamAnalytics` with a responsive grid of 4 MetricCards
    - Grid layout: `grid grid-cols-2 md:grid-cols-4 gap-4`
    - Metrics: Total Emails, Total Inboxes, Active Inboxes, Total Members
    - All numeric values use `toLocaleString()` and `tabular-nums`
    - _Bug_Condition: isBugCondition returns true for team view when NOT rendersSummaryMetricCards(input)_
    - _Expected_Behavior: 4 metric cards visible in Team view with formatted values_
    - _Preservation: Existing Team "Emails per Day" chart unchanged_
    - _Requirements: 2.7_

  - [x] 3.7 Lazy-load new chart components
    - Extract StorageTrendChart to a separate file for code splitting
    - Use `dynamic(() => import('./StorageTrendChart'), { ssr: false })` pattern
    - Add loading skeleton placeholder matching chart dimensions
    - Ensure existing Recharts imports in page.tsx remain (they are already bundled together)
    - Mark component file with `'use client'` directive
    - _Bug_Condition: New chart must follow lazy-loading pattern per steering rules_
    - _Expected_Behavior: StorageTrendChart is code-split and only loaded client-side_
    - _Preservation: Existing chart loading behavior unchanged_
    - _Requirements: 2.4_

  - [x] 3.8 Implement trend calculation logic
    - Compute trend percentage by comparing current period metric to previous equivalent period
    - If current period is 30 days, compare to the 30 days before that
    - Formula: `((current - previous) / previous) * 100`
    - If no previous period data available from API (or previous is 0), show neutral indicator (null trend)
    - Apply to all Org and Team metric cards
    - Handle edge cases: division by zero, negative values, very large percentages (cap display at +/-999%)
    - _Bug_Condition: No trend calculation exists; metrics show raw values only_
    - _Expected_Behavior: Each metric card shows period-over-period percentage change_
    - _Preservation: Underlying metric values unchanged; trend is additive display_
    - _Requirements: 2.5_

  - [x] 3.9 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Missing Analytics Data Now Rendered
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (metric cards present, storage chart present, enhanced tooltips present, team metrics present)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.10 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Charts and Navigation Still Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all existing charts, error states, loading states, date range selection, and view toggling work identically after fix
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite to confirm no regressions
  - Verify TypeScript compilation passes (`next build` or `tsc --noEmit`)
  - Confirm exploration test (Property 1) passes after fix
  - Confirm preservation tests (Property 2) still pass after fix
  - Ensure all new components meet accessibility requirements (aria-labels, contrast, keyboard)
  - Ensure all numeric values use `tabular-nums` class
  - Ensure no em-dashes in any visible text
  - Ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "2"],
      "description": "Write exploration and preservation tests before any fix"
    },
    {
      "wave": 2,
      "tasks": ["3.1"],
      "description": "Extend TypeScript interfaces to type all backend fields"
    },
    {
      "wave": 3,
      "tasks": ["3.2", "3.4", "3.5"],
      "description": "Build MetricCard component, Storage Trend Chart, and enhanced tooltips in parallel"
    },
    {
      "wave": 4,
      "tasks": ["3.3", "3.6", "3.7", "3.8"],
      "description": "Integrate metric cards into Org/Team views, lazy-load charts, and add trend logic"
    },
    {
      "wave": 5,
      "tasks": ["3.9", "3.10"],
      "description": "Verify exploration test passes and preservation tests still pass"
    },
    {
      "wave": 6,
      "tasks": ["4"],
      "description": "Final checkpoint - ensure all tests pass"
    }
  ]
}
```

## Notes

- Exploration test (task 1) is expected to FAIL on unfixed code, confirming the bug exists. It will pass after the fix is implemented.
- Preservation tests (task 2) must PASS on unfixed code before any implementation begins, establishing the behavioral baseline.
- The fix follows the order: interfaces first, then components, then integration, then verification.
- All new chart components must be lazy-loaded via `dynamic()` per project steering rules.
- Trend calculation gracefully handles missing previous period data by showing a neutral indicator.
