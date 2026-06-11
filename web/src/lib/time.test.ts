import { describe, it, expect } from "vitest";
import { timeAgo } from "./time";

describe("timeAgo", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("reports 'just now' under 5s", () => {
    expect(timeAgo(ago(0), now)).toBe("just now");
    expect(timeAgo(ago(4), now)).toBe("just now");
  });

  it("reports seconds, minutes, hours, days", () => {
    expect(timeAgo(ago(30), now)).toBe("30s ago");
    expect(timeAgo(ago(5 * 60), now)).toBe("5m ago");
    expect(timeAgo(ago(3 * 3600), now)).toBe("3h ago");
    expect(timeAgo(ago(2 * 86400), now)).toBe("2d ago");
  });

  it("falls back to a date string beyond ~30 days", () => {
    const out = timeAgo(ago(40 * 86400), now);
    expect(out).not.toMatch(/ago$/);
    expect(out.length).toBeGreaterThan(0);
  });

  it("accepts a Date instance", () => {
    expect(timeAgo(new Date(now - 90 * 1000), now)).toBe("1m ago");
  });
});
