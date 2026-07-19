# Dashboard Analytics Polish Bugfix Design

## Overview

The dashboard page and analytics page share the same backend data but have accumulated UI inconsistencies, missing features, and a minor backend validation gap. The dashboard uses outdated inline Recharts tooltips, the wrong chart type (AreaChart for discrete data), lacks trend indicators, and has a redundant "This Week" sidebar card. The analytics page has a missing empty state for domain breakdown and a responsive grid issue at medium breakpoints. The domain time-series endpoint lacks an existence check for the requested domain. This fix unifies the two pages visually, adds the missing UX affordances, and closes the backend validation gap.

## Glossary

- **Bug_Condition (C)**: The set of UI states and API calls where inconsistencies, missing indicators, or validation gaps are triggered
- **Property (P)**: Visual and behavioral consistency between dashboard and analytics pages; proper empty states; validated API inputs
- **Preservation**: Existing dashboard layout, real-time WebSocket updates, audit log display, quick links, admin access control, analytics team views, and permission enforcement that must remain unchanged
- **ChartTooltip**: The shared tooltip component at `web/src/app/analytics/chart-tooltip.tsx` that shows value + "% vs avg" comparison
- **computeTrend**: The exported utility in `web/src/app/analytics/page.tsx` that splits time-series data into halves to compute a period-over-period percentage change
- **MetricCard**: The border-top stat component in the analytics page that shows label, value, and trend arrow
- **DomainDetailChart**: The expandable domain drill-down chart at `web/src/app/analytics/domain-detail-chart.tsx`

## Bug Details

### Bug Condition

The bug manifests across multiple co-occurring conditions: when the dashboard page renders charts with tooltips, when stat cards display without trends, when the Email Volume chart uses AreaChart for discrete data, when the "This Week" sidebar card duplicates the main chart, when the analytics domain breakdown is empty, when the metric grid renders at md breakpoint, when the domain detail chart refetches without a loading indicator, and when the domain time-series endpoint receives a non-existent domain name.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { page: "dashboard" | "analytics", context: RenderContext | APIRequest }
  OUTPUT: boolean

  IF input.page == "dashboard" THEN
    RETURN context.rendersChartTooltip == true          // 1.1: old tooltip style
           OR context.rendersStatCards == true           // 1.3: no trend arrows
           OR context.rendersEmailVolumeChart == true    // 1.4: AreaChart instead of BarChart
           OR context.rendersSidebarWeekCard == true     // 1.6: redundant weekly chart
           OR context.rendersMetrics == true             // 1.5: missing cumulative metrics
           OR context.rendersStorageCard == true         // 1.2: no trend visualization
  END IF

  IF input.page == "analytics" THEN
    RETURN (context.domainBreakdown.length == 0 AND context.rendersSection == true)  // 1.7
           OR (context.viewportWidth >= 768 AND context.viewportWidth < 1024)        // 1.8
           OR (context.domainChartRefetching == true AND context.showsLoading == false) // 1.9
  END IF

  IF input.type == "APIRequest" THEN
    RETURN input.endpoint == "/orgs/:orgId/analytics/domain-series"
           AND NOT domainExistsInOrg(input.domain, input.orgId)  // 1.10
  END IF

  RETURN false
END FUNCTION
```

### Examples

- Dashboard tooltip: hovering over a bar in "Email Volume" shows a plain `formatter` tooltip with "Emails: 42" instead of ChartTooltip with "+15.2% vs avg"
- Dashboard stat card: "Active Inboxes" card shows "12 total created" text but no "+3.5%" trend arrow like the analytics MetricCard
- Dashboard Email Volume: renders as filled area curve instead of discrete bars, visually implying continuous data
- Dashboard sidebar: "This Week" card duplicates main chart data in a mini bar chart instead of showing unique content like inbox activity
- Analytics domain breakdown empty: when org has no domain data, the "Emails by Domain" section vanishes entirely with no empty state
- Analytics grid at 768px: 8 MetricCards forced into `lg:grid-cols-8` (only activates at 1024px) leaving md at 2 cols, which is fine, but the `lg` breakpoint at 1024px crams 8 cards awkwardly
- Domain detail chart: changing date range from "30 days" to "90 days" causes data to refetch but the existing chart stays visible with stale data (no loading overlay)
- Backend: `GET /orgs/:orgId/analytics/domain-series?domain=nonexistent.fake` executes the generate_series SQL query for a domain that does not exist in the org

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Dashboard greeting header, auto-refresh toggle, refresh button, and "New Inbox" link
- Dashboard recent activity (audit log entries with action dots, humanized names, time-ago)
- Dashboard quick links section (Inboxes, Domains, Teams, Webhooks, API Keys, Analytics)
- Analytics team view (team-specific charts and metrics)
- Analytics date range selector refetching all time-series data
- Analytics domain breakdown expand/collapse with aria-expanded
- WebSocket admin-stats real-time update with reconnect logic
- Non-admin redirect to home page
- Permission enforcement (`org.analytics.view`, `org_id` SQL scoping)

**Scope:**
All inputs that do NOT involve the specific rendering conditions (tooltip, chart type, stat cards, sidebar, domain empty state, grid breakpoint, domain chart loading, domain validation) should be completely unaffected by this fix.

## Hypothesized Root Cause

Based on the code analysis, the root causes are:

1. **Dashboard Tooltip Divergence**: The dashboard was built before `ChartTooltip` existed. It uses inline `contentStyle` + `formatter` props on the Recharts `Tooltip` component instead of importing and using `<ChartTooltip>` from `./analytics/chart-tooltip`.

2. **Chart Type Mismatch**: The dashboard uses `RechartsAreaChart` + `Area` for the Email Volume chart. This was likely an early design choice before the analytics page standardized on `BarChart` for discrete daily counts.

3. **Missing Trend Computation**: The dashboard's `StatCard` component accepts `delta`/`deltaLabel` (absolute numbers) but not percentage trends. It does not import or use the `computeTrend` utility from the analytics page.

4. **Redundant Sidebar Card**: The "This Week" card was added as a quick summary but duplicates the main 30-day chart with a 7-day subset. No inbox activity or unique insight was surfaced.

5. **Analytics Empty State Gap**: The domain breakdown section conditionally renders only when `domain_breakdown.length > 0`. No `else` branch was written.

6. **Grid Breakpoint Issue**: The metric grid uses `lg:grid-cols-8` which activates at 1024px, cramming 8 cards. The missing `md:grid-cols-4` breakpoint means cards jump from 2-wide to 8-wide with no intermediate step.

7. **Domain Chart Refetch Indicator**: `DomainDetailChart` shows a Skeleton on initial load (`isLoading`), but on refetch (when `days` changes), React Query transitions without re-entering loading state. The `isFetching` flag is not checked.

8. **Domain Validation Gap**: `OrgDomainTimeSeries` handler validates the `domain` param is non-empty but does not verify the domain belongs to the org before running the time-series query.

## Correctness Properties

Property 1: Bug Condition - Dashboard/Analytics Visual Consistency

_For any_ render where the bug condition holds (dashboard charts, stat cards, sidebar card, analytics empty state, grid, domain chart loading, or domain API call with non-existent domain), the fixed code SHALL produce behavior matching the analytics page patterns: ChartTooltip with % vs avg, BarChart for daily email data, trend arrows on stat cards, useful sidebar content, proper empty state, responsive grid at md, loading indicator on refetch, and 404 for non-existent domains.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

Property 2: Preservation - Existing Functionality Unchanged

_For any_ input where the bug condition does NOT hold (admin layout, audit log, quick links, team analytics, date range refetch, domain expand/collapse, WebSocket updates, non-admin redirect, permission checks), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

## Fix Implementation

### Changes Required

**File**: `web/src/app/dashboard/page.tsx`

**Specific Changes**:

1. **Import ChartTooltip**: Add `import { ChartTooltip } from "./analytics/chart-tooltip"` and `import { computeTrend } from "./analytics/page"`. Remove the inline `tooltipStyle` object.

2. **Switch Email Volume to BarChart**: Replace `RechartsAreaChart` + `Area` with `RechartsBarChart` + `Bar` in the "Email Volume" chart section. Keep `CartesianGrid`, `XAxis`, `YAxis`, `ReferenceLine`. Use `radius={[4, 4, 0, 0]}` matching analytics.

3. **Replace Tooltip with ChartTooltip**: In all chart sections (Email Volume, Activity by Hour, Weekly mini-chart), replace `<Tooltip contentStyle={tooltipStyle} .../>` with `<Tooltip content={<ChartTooltip average={avg} unit="emails" labelFormatter={...} />} />`.

4. **Add Trend Indicators to StatCard**: Modify the `StatCard` component to accept an optional `trend: number | null` prop. Use `computeTrend` on `chartWeek.data` for emails, and on insights data for inboxes. Show TrendingUp/TrendingDown/Minus icons with percentage text, matching the analytics `MetricCard` pattern.

5. **Add Missing Metrics**: Add "Emails Received" and "Inboxes Created" stat cards using `stats.total_emails_received` and `stats.total_inboxes_created` from the existing API response.

6. **Replace "This Week" Sidebar Card**: Replace the redundant weekly email chart with an "Inbox Activity" card showing recent inbox creations with time-ago timestamps (fetched from existing insights `inboxes_per_day` data) or a storage mini-sparkline using `insights.storage_per_day`.

7. **Remove unused dynamic imports**: Remove `RechartsAreaChart` and `Area` dynamic imports since they are no longer used.

---

**File**: `web/src/app/analytics/page.tsx`

**Specific Changes**:

1. **Add Domain Breakdown Empty State**: Add an `else` branch when `insights.domain_breakdown.length === 0` showing a centered empty state with Globe icon, "No domain data" title, and "Emails will appear here once your domains receive traffic" description.

2. **Fix Responsive Grid**: Change the metric grid from `grid-cols-2 md:grid-cols-4 lg:grid-cols-8` to `grid-cols-2 md:grid-cols-4 xl:grid-cols-8` so the 8-column layout only activates at 1280px instead of 1024px.

---

**File**: `web/src/app/analytics/domain-detail-chart.tsx`

**Specific Changes**:

1. **Add Refetch Loading Indicator**: Destructure `isFetching` from the `useQuery` hook. When `isFetching && !isLoading` (i.e., background refetch), overlay a subtle loading indicator (semi-transparent overlay with Skeleton pulse or opacity reduction on the chart container).

---

**File**: `internal/handler/analytics.go`

**Specific Changes**:

1. **Add Domain Existence Check**: Before calling `h.svc.GetOrgDomainTimeSeries`, call a service method (e.g., `h.svc.OrgHasDomain(ctx, orgID, domainName)`) that performs a `SELECT 1 FROM domains WHERE org_id = $1 AND name = $2` check. If the domain does not exist, return 404 with `"domain not found in organization"`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write component tests that render the dashboard and analytics pages with mocked data and assert tooltip rendering, chart type, stat card content, empty states, and grid classes. Run on UNFIXED code to observe failures.

**Test Cases**:
1. **Dashboard Tooltip Test**: Render dashboard with chart data, hover simulation; assert ChartTooltip renders with "% vs avg" text (will fail on unfixed code - gets inline tooltip)
2. **Dashboard Chart Type Test**: Render Email Volume section; assert BarChart component is used, not AreaChart (will fail on unfixed code)
3. **Dashboard Trend Arrow Test**: Render stat cards with time-series data; assert trend percentage is displayed (will fail on unfixed code)
4. **Analytics Empty Domain Test**: Render analytics with empty `domain_breakdown`; assert empty state component renders (will fail on unfixed code)
5. **Analytics Grid Breakpoint Test**: Render metric grid; assert `xl:grid-cols-8` class present (will fail on unfixed code - has `lg:grid-cols-8`)
6. **Domain Chart Refetch Test**: Trigger days change on expanded domain; assert loading indicator appears during refetch (will fail on unfixed code)
7. **Backend Domain Validation Test**: Send GET request with non-existent domain; assert 404 response (will fail on unfixed code - returns 200 with empty data)

**Expected Counterexamples**:
- Dashboard tooltips render without "% vs avg" comparison text
- Dashboard Email Volume uses `<Area>` elements instead of `<Bar>` elements
- Stat cards show no percentage trend indicators
- Domain breakdown section absent when data is empty (no empty state)

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := renderFixed(input)
  ASSERT expectedBehavior(result)
    WHERE expectedBehavior includes:
      - ChartTooltip component with average and unit props
      - BarChart for Email Volume
      - Trend percentage on stat cards
      - Useful sidebar content (not redundant weekly chart)
      - Empty state for empty domain breakdown
      - xl:grid-cols-8 (not lg:grid-cols-8) on metric grid
      - Loading indicator during domain chart refetch
      - 404 response for non-existent domains
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT renderOriginal(input) = renderFixed(input)
    WHERE preserved behaviors include:
      - Admin layout (greeting, auto-refresh, refresh button, new inbox link)
      - Audit log display (action dots, humanized names, time-ago)
      - Quick links rendering
      - Team analytics views
      - WebSocket real-time updates
      - Non-admin redirect
      - Permission enforcement
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of stats, chart data, and org configurations
- It catches edge cases in trend computation (zero division, empty arrays, single data points)
- It provides strong guarantees that non-buggy rendering paths remain unchanged

**Test Plan**: Observe behavior on UNFIXED code first for admin layout, audit log, quick links, and permission flows, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Admin Layout Preservation**: Verify greeting, auto-refresh toggle, refresh button, and new inbox link render unchanged after fix
2. **Audit Log Preservation**: Verify audit entries display with correct action dots, humanized names, and time-ago after fix
3. **Quick Links Preservation**: Verify all 6 navigation links render with correct hrefs and icons after fix
4. **WebSocket Preservation**: Verify real-time stats update via admin-stats WebSocket after fix
5. **Team Analytics Preservation**: Verify team view renders correctly with team-specific data after fix
6. **Permission Preservation**: Verify non-admin redirect and `org.analytics.view` enforcement after fix

### Unit Tests

- Test `computeTrend` with various data shapes: empty, single point, equal halves, zero first half, large values
- Test ChartTooltip rendering with various average/value combinations
- Test StatCard with trend prop (positive, negative, null, zero)
- Test domain existence check handler returns 404 for missing domain
- Test domain existence check handler returns 200 for valid domain
- Test DomainDetailChart shows loading overlay when `isFetching && !isLoading`

### Property-Based Tests

- Generate random time-series arrays and verify `computeTrend` returns null for insufficient data and bounded values for valid data
- Generate random stat configurations and verify StatCard renders correctly with trend arrows matching sign
- Generate random viewport widths and verify analytics grid classes produce readable card sizes at all breakpoints
- Generate random domain names (existing and non-existing) and verify the handler returns correct status codes

### Integration Tests

- Test full dashboard render with mocked API responses verifying all charts use BarChart and ChartTooltip
- Test analytics page with empty domain breakdown verifying empty state appears
- Test domain time-series endpoint integration with org domain validation
- Test dashboard auto-refresh cycle verifying WebSocket updates still work after tooltip/chart changes
