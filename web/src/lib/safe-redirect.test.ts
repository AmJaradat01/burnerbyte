import { describe, it, expect } from "vitest";
import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeRedirect("/inboxes")).toBe("/inboxes");
    expect(safeRedirect("/orgs/abc/settings?tab=team")).toBe("/orgs/abc/settings?tab=team");
  });

  it("falls back to / for empty input", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect("")).toBe("/");
  });

  it("blocks open-redirect vectors", () => {
    const attacks = [
      "//evil.com",
      "https://evil.com",
      "http://evil.com",
      "javascript:alert(1)",
      "evil.com",
      "//",
      " /inboxes", // leading space -> not a "/" start
    ];
    for (const a of attacks) {
      expect(safeRedirect(a), `should block ${JSON.stringify(a)}`).toBe("/");
    }
  });
});
