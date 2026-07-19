import { describe, it, expect } from "vitest";
import { computeTrend } from "./page";

describe("computeTrend", () => {
  it("returns null for empty array", () => {
    expect(computeTrend([])).toBeNull();
  });

  it("returns null for single element array", () => {
    expect(computeTrend([{ count: 10 }])).toBeNull();
  });

  it("returns null when first half sums to zero", () => {
    expect(computeTrend([{ count: 0 }, { count: 0 }, { count: 5 }, { count: 10 }])).toBeNull();
  });

  it("computes positive trend when second half is larger", () => {
    // First half: [10, 10] = 20, Second half: [15, 15] = 30
    // ((30 - 20) / 20) * 100 = 50%
    const data = [{ count: 10 }, { count: 10 }, { count: 15 }, { count: 15 }];
    expect(computeTrend(data)).toBeCloseTo(50);
  });

  it("computes negative trend when second half is smaller", () => {
    // First half: [20, 20] = 40, Second half: [10, 10] = 20
    // ((20 - 40) / 40) * 100 = -50%
    const data = [{ count: 20 }, { count: 20 }, { count: 10 }, { count: 10 }];
    expect(computeTrend(data)).toBeCloseTo(-50);
  });

  it("returns 0 when both halves are equal", () => {
    const data = [{ count: 5 }, { count: 5 }, { count: 5 }, { count: 5 }];
    expect(computeTrend(data)).toBeCloseTo(0);
  });

  it("caps positive trend at 999%", () => {
    // First half: [1] = 1, Second half: [100] = 100
    // ((100 - 1) / 1) * 100 = 9900%, should cap at 999
    const data = [{ count: 1 }, { count: 100 }];
    expect(computeTrend(data)).toBe(999);
  });

  it("caps negative trend at -999%", () => {
    // This can't naturally happen (minimum is -100% when second is 0)
    // but mathematically with the formula it's capped
    // First half: [100, 100] = 200, Second half: [0, 0] = 0
    // ((0 - 200) / 200) * 100 = -100%
    const data = [{ count: 100 }, { count: 100 }, { count: 0 }, { count: 0 }];
    expect(computeTrend(data)).toBeCloseTo(-100);
  });

  it("handles odd-length arrays by splitting at midpoint", () => {
    // 5 elements: midpoint = 2, first half = [0..2), second half = [2..5)
    // First half: [10, 10] = 20, Second half: [20, 20, 20] = 60
    // ((60 - 20) / 20) * 100 = 200%
    const data = [{ count: 10 }, { count: 10 }, { count: 20 }, { count: 20 }, { count: 20 }];
    expect(computeTrend(data)).toBeCloseTo(200);
  });

  it("handles two element array", () => {
    // midpoint = 1, first = [5], second = [10]
    // ((10 - 5) / 5) * 100 = 100%
    const data = [{ count: 5 }, { count: 10 }];
    expect(computeTrend(data)).toBeCloseTo(100);
  });
});
