import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithClient } from "@/test/query";

// Mock the API module but keep everything except `api` real, so importing the
// settings page module (which uses other api helpers transitively) is safe.
vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  };
});

import { api } from "@/lib/api";
import { SSOProvidersTab } from "./page";

function provider(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Okta",
    provider_type: "oidc",
    client_id: "cid",
    client_secret: "sec",
    redirect_url: "https://app.example.com/sso/callback",
    auto_provision: false,
    default_org_role: "member",
    default_team_role: "member",
    enabled: true,
    linked_user_count: 3,
    ...over,
  };
}

describe("SSOProvidersTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the provider list with header summary stats (Bug 1.9)", async () => {
    vi.mocked(api.get).mockResolvedValue([provider()]);
    const { container } = renderWithClient(<SSOProvidersTab />);

    // Wait for the query to resolve and the provider card to render.
    expect(await screen.findByText("Okta")).toBeInTheDocument();

    // Summary stats are present in the header.
    expect(container.textContent).toContain("enabled provider");
    expect(container.textContent).toContain("linked user");
  });

  it("renders the empty state when no providers are configured", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    renderWithClient(<SSOProvidersTab />);
    expect(await screen.findByText("No SSO providers configured")).toBeInTheDocument();
  });
});
