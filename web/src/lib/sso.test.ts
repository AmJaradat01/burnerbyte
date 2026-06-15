import { describe, it, expect } from "vitest";
import { isValidProviderUrl, validateSSOProviderForm, ssoSummaryStats } from "./sso";

// Feature: enhanced-sso — the SSO tab fix added inline form validation
// (Bug 1.3) and header summary stats (Bug 1.9). These are the extracted,
// pure pieces of that behavior.

describe("isValidProviderUrl", () => {
  it("accepts absolute http/https URLs", () => {
    expect(isValidProviderUrl("https://idp.example.com/callback")).toBe(true);
    expect(isValidProviderUrl("http://localhost:8080/cb")).toBe(true);
  });
  it("rejects empty and malformed values", () => {
    expect(isValidProviderUrl("")).toBe(false);
    expect(isValidProviderUrl("not a url")).toBe(false);
    expect(isValidProviderUrl("/relative/path")).toBe(false);
  });
});

describe("validateSSOProviderForm", () => {
  const valid = {
    name: "Okta",
    client_id: "abc",
    client_secret: "shh",
    redirect_url: "https://app.example.com/sso/callback",
  };

  it("returns no errors for a complete, valid form", () => {
    expect(validateSSOProviderForm(valid)).toEqual({});
  });

  it("flags each missing required field", () => {
    const errs = validateSSOProviderForm({});
    expect(errs.name).toBeTruthy();
    expect(errs.client_id).toBeTruthy();
    expect(errs.client_secret).toBeTruthy();
    expect(errs.redirect_url).toBeTruthy();
  });

  it("flags an unparseable redirect_url (inline validation)", () => {
    const errs = validateSSOProviderForm({ ...valid, redirect_url: "not a url" });
    expect(errs.redirect_url).toBe("Invalid URL format");
  });

  it("treats whitespace-only values as missing", () => {
    const errs = validateSSOProviderForm({ ...valid, name: "   " });
    expect(errs.name).toBe("Name is required");
  });
});

describe("ssoSummaryStats", () => {
  it("counts enabled providers and sums linked users", () => {
    const stats = ssoSummaryStats([
      { enabled: true, linked_user_count: 3 },
      { enabled: false, linked_user_count: 5 },
      { enabled: true }, // linked_user_count omitted -> treated as 0
    ]);
    expect(stats.enabledCount).toBe(2);
    expect(stats.totalLinkedUsers).toBe(8);
  });

  it("returns zeros for an empty list", () => {
    expect(ssoSummaryStats([])).toEqual({ enabledCount: 0, totalLinkedUsers: 0 });
  });
});
