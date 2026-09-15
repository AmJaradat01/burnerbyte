/**
 * Bug Condition Exploration Test
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7**
 *
 * Property 1: Bug Condition - Missing Analytics Data Not Rendered
 *
 * These tests encode the EXPECTED (fixed) behavior. They are expected to FAIL
 * on the current unfixed code, confirming that the bug exists. Once the fix is
 * implemented, these tests will pass.
 *
 * Counterexamples surfaced by failure will document exactly which data fields
 * the UI fails to render despite the backend providing them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderWithClient } from "@/test/query";

// Mock the API module
vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  };
});

// Mock the org-store to provide a current org and teams
vi.mock("@/stores/org-store", () => ({
  useOrgStore: vi.fn(),
}));

import { api } from "@/lib/api";
import { useOrgStore } from "@/stores/org-store";
import AnalyticsPage from "./page";
import { TeamAnalytics } from "./page";

const MOCK_ORG = { id: "org-1", name: "Test Org", slug: "test-org" };
const MOCK_TEAMS = [{ id: "team-1", name: "Engineering" }];

// OrgStats response including all backend fields
const MOCK_ORG_STATS = {
  total_emails: 5000,
  total_inboxes: 150,
  active_inboxes: 89,
  total_domains: 12,
  total_teams: 4,
  total_members: 12,
  storage_used_bytes: 1073741824, // 1.0 GB
  total_storage_bytes: 5368709120, // 5.0 GB
  total_emails_received: 45230,
  total_inboxes_created: 312,
  top_sender_domains: [
    { domain: "gmail.com", count: 1200 },
    { domain: "outlook.com", count: 800 },
  ],
};

// TeamStats response
const MOCK_TEAM_STATS = {
  total_emails: 890,
  total_inboxes: 23,
  active_inboxes: 18,
  total_members: 6,
};

// Insights response including storage_per_day data
const MOCK_INSIGHTS = {
  inboxes_per_day: [
    { date: "2024-01-14", count: 5 },
    { date: "2024-01-15", count: 8 },
  ],
  peak_hours: [
    { hour: 9, count: 45 },
    { hour: 14, count: 62 },
  ],
  domain_breakdown: [
    { domain: "example.com", count: 300 },
    { domain: "test.io", count: 150 },
  ],
  storage_per_day: [
    { date: "2024-01-14", storage_bytes: 900000000 },
    { date: "2024-01-15", storage_bytes: 1073741824 },
  ],
};

// Time series data for emails per day
const MOCK_TIME_SERIES = {
  data: [
    { date: "2024-01-14", count: 120 },
    { date: "2024-01-15", count: 142 },
    { date: "2024-01-16", count: 98 },
  ],
};

function setupOrgView() {
  vi.mocked(useOrgStore).mockReturnValue({
    currentOrg: MOCK_ORG,
    teams: MOCK_TEAMS,
  } as ReturnType<typeof useOrgStore>);

  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.includes("/analytics/emails-per-day")) return MOCK_TIME_SERIES as never;
    if (path.includes("/analytics/insights")) return MOCK_INSIGHTS as never;
    if (path.includes("/analytics")) return MOCK_ORG_STATS as never;
    return {} as never;
  });
}

function setupTeamView() {
  vi.mocked(useOrgStore).mockReturnValue({
    currentOrg: MOCK_ORG,
    teams: MOCK_TEAMS,
  } as ReturnType<typeof useOrgStore>);

  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.includes("/teams/") && path.includes("/analytics/emails-per-day")) {
      return { data: [{ date: "2024-01-15", count: 50 }] } as never;
    }
    if (path.includes("/teams/") && path.includes("/analytics")) {
      return MOCK_TEAM_STATS as never;
    }
    return {} as never;
  });
}

describe("Bug Condition Exploration: Missing Analytics Data Not Rendered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Org View - Missing Metric Cards (Req 1.1, 1.2, 1.3, 1.5)", () => {
    it("should render storage usage metric showing human-readable format", async () => {
      setupOrgView();
      const { container } = renderWithClient(<AnalyticsPage />);

      // Wait for data to load
      await waitFor(() => {
        expect(container.textContent).toContain("5,000");
      });

      // Bug condition: storage_used_bytes=1073741824 and total_storage_bytes=5368709120
      // should be rendered as a storage metric (e.g., "1.0 GB / 5.0 GB" or similar)
      // On unfixed code, this will NOT be present
      const hasStorageMetric =
        container.textContent?.includes("1.0 GB") ||
        container.textContent?.includes("1 GB") ||
        container.textContent?.includes("1,073,741,824");

      expect(hasStorageMetric).toBe(true);
    });

    it("should render total_members count in a dedicated metric element", async () => {
      setupOrgView();
      const { container } = renderWithClient(<AnalyticsPage />);

      await waitFor(() => {
        expect(container.textContent).toContain("5,000");
      });

      // Bug condition: total_members=12 should appear in a dedicated metric card
      // The unfixed code shows it nowhere or only in inline text
      // We look for a dedicated metric-like presentation (not just inline text)
      const metricElements = container.querySelectorAll('[class*="metric"], [data-testid*="metric"]');
      const hasMembers = Array.from(metricElements).some(
        (el) => el.textContent?.includes("12") && el.textContent?.toLowerCase().includes("member")
      );

      // Alternatively check if "Members" label exists with "12" value nearby
      const allText = container.textContent || "";
      const hasMemberMetricCard = allText.includes("Members") && allText.includes("12");

      expect(hasMembers || hasMemberMetricCard).toBe(true);
    });

    it("should render total_teams count in a dedicated metric element", async () => {
      setupOrgView();
      const { container } = renderWithClient(<AnalyticsPage />);

      await waitFor(() => {
        expect(container.textContent).toContain("5,000");
      });

      // Bug condition: total_teams=4 should appear in a dedicated metric card
      // Look for "Teams" label with "4" value
      const allText = container.textContent || "";
      const hasTeamMetricCard = allText.includes("Teams") && allText.includes("4");

      expect(hasTeamMetricCard).toBe(true);
    });

    it("should render total_emails_received cumulative counter", async () => {
      setupOrgView();
      const { container } = renderWithClient(<AnalyticsPage />);

      await waitFor(() => {
        expect(container.textContent).toContain("5,000");
      });

      // Bug condition: total_emails_received=45230 should be rendered
      // On unfixed code, this field is not even in the TypeScript interface
      const allText = container.textContent || "";
      const hasEmailsReceived =
        allText.includes("45,230") || allText.includes("45230");

      expect(hasEmailsReceived).toBe(true);
    });

    it("should render total_inboxes_created cumulative counter", async () => {
      setupOrgView();
      const { container } = renderWithClient(<AnalyticsPage />);

      await waitFor(() => {
        expect(container.textContent).toContain("5,000");
      });

      // Bug condition: total_inboxes_created=312 should be rendered
      // On unfixed code, this field is not even in the TypeScript interface
      const allText = container.textContent || "";
      const hasInboxesCreated = allText.includes("312");

      expect(hasInboxesCreated).toBe(true);
    });
  });

  describe("Org View - Missing Storage Trend Chart (Req 1.4)", () => {
    it("should render a storage trend chart when insights contain storage_per_day data", async () => {
      setupOrgView();
      const { container } = renderWithClient(<AnalyticsPage />);

      await waitFor(() => {
        expect(container.textContent).toContain("5,000");
      });

      // Bug condition: insights response has storage_per_day data but no chart renders it
      // Look for a chart heading or container related to storage trend
      const allText = container.textContent || "";
      const hasStorageChart =
        allText.toLowerCase().includes("storage") &&
        (container.querySelector('[class*="recharts"]') !== null ||
          allText.toLowerCase().includes("storage trend") ||
          allText.toLowerCase().includes("storage usage"));

      // The unfixed code has no storage chart at all
      expect(hasStorageChart).toBe(true);
    });
  });

  describe("Org View - Enhanced Tooltips (Req 1.6)", () => {
    it("should show average comparison percentage in tooltip formatter", async () => {
      setupOrgView();
      const { container } = renderWithClient(<AnalyticsPage />);

      await waitFor(() => {
        expect(container.textContent).toContain("5,000");
      });

      // Bug condition: The ChartTooltip component is now used, which includes "% vs avg" text.
      // In jsdom we cannot trigger hover to reveal the tooltip, but we can verify
      // that the ChartTooltip component is configured by checking the Recharts Tooltip
      // uses our custom content prop. We verify indirectly by importing and rendering
      // the ChartTooltip component directly with test data.
      const { ChartTooltip: TooltipComp } = await import("./chart-tooltip") as { ChartTooltip: React.FC<Record<string, unknown>> };

      // Render the ChartTooltip with active state to verify it outputs "% vs avg"
      const { container: tooltipContainer } = renderWithClient(
        <TooltipComp
          active={true}
          payload={[{ value: 142, dataKey: "count" }]}
          label="2024-01-15"
          average={98}
          unit="emails"
          labelFormatter={(v: string | number) => `Date: ${v}`}
        />
      );

      const tooltipText = tooltipContainer.textContent || "";
      const hasComparisonText = tooltipText.includes("% vs avg");
      expect(hasComparisonText).toBe(true);
    });
  });

  describe("Team View - Missing Summary Metric Cards (Req 1.7)", () => {
    it("should render summary metric cards for team stats", async () => {
      setupTeamView();

      vi.mocked(api.get).mockImplementation(async (path: string) => {
        if (path.includes("/teams/") && path.includes("/analytics/emails-per-day")) {
          return { data: [{ date: "2024-01-15", count: 50 }] } as never;
        }
        if (path.includes("/teams/") && path.includes("/analytics")) {
          return MOCK_TEAM_STATS as never;
        }
        return {} as never;
      });

      const { container } = renderWithClient(<TeamAnalytics orgId="org-1" teamId="team-1" />);

      // Wait for team stats to load
      await waitFor(() => {
        expect(container.textContent).toContain("890");
      });

      // The fixed code should render 4 metric cards with border-t class for team stats
      const metricElements = container.querySelectorAll('[class*="border-t"]');
      const hasTeamMetricCards = metricElements.length >= 4;

      expect(hasTeamMetricCards).toBe(true);
    });

    it("should render active_inboxes as a dedicated metric in team view", async () => {
      setupTeamView();

      vi.mocked(api.get).mockImplementation(async (path: string) => {
        if (path.includes("/teams/") && path.includes("/analytics/emails-per-day")) {
          return { data: [{ date: "2024-01-15", count: 50 }] } as never;
        }
        if (path.includes("/teams/") && path.includes("/analytics")) {
          return MOCK_TEAM_STATS as never;
        }
        return {} as never;
      });

      const { container } = renderWithClient(<TeamAnalytics orgId="org-1" teamId="team-1" />);

      await waitFor(() => {
        expect(container.textContent).toContain("890");
      });

      // The fixed code renders "Active Inboxes" as a labeled metric card
      const allText = container.textContent || "";
      const hasActiveInboxesMetric =
        allText.includes("Active Inboxes") ||
        allText.includes("Active inboxes");

      expect(hasActiveInboxesMetric).toBe(true);
    });
  });
});
