import { describe, it, expect } from "vitest";
import {
  type PasswordPolicy,
  passwordRequirements,
  passwordMeetsPolicy,
  passwordStrength,
} from "./password-policy";

const strict: PasswordPolicy = {
  min_length: 8,
  require_uppercase: true,
  require_lowercase: true,
  require_number: true,
  require_special: true,
};

describe("passwordMeetsPolicy", () => {
  // The bug this guards: the setup wizard advanced past the admin step on any
  // non-empty password, so a policy-violating one was only rejected by
  // POST /setup/complete — after four more screens of input.
  it("rejects the exact password the wizard used to accept", () => {
    expect(passwordMeetsPolicy("amjaradat01@hexajo.com", strict)).toBe(false);
  });

  it("accepts a password satisfying every rule", () => {
    expect(passwordMeetsPolicy("Abcd@1234$", strict)).toBe(true);
  });

  it.each([
    ["no uppercase", "abcd@1234$"],
    ["no lowercase", "ABCD@1234$"],
    ["no number", "Abcdefg@$"],
    ["no special", "Abcd12345"],
    ["too short", "Ab@1x"],
  ])("rejects a password with %s", (_label, pw) => {
    expect(passwordMeetsPolicy(pw, strict)).toBe(false);
  });

  it("honours a relaxed policy instead of assuming the defaults", () => {
    const relaxed: PasswordPolicy = {
      min_length: 4,
      require_uppercase: false,
      require_lowercase: false,
      require_number: false,
      require_special: false,
    };
    expect(passwordMeetsPolicy("abcd", relaxed)).toBe(true);
    expect(passwordMeetsPolicy("abc", relaxed)).toBe(false);
  });

  // A failed metadata fetch must not lock the user out of their own install;
  // the server re-validates regardless.
  it("falls back to a non-empty check when the policy has not loaded", () => {
    expect(passwordMeetsPolicy("x", undefined)).toBe(true);
    expect(passwordMeetsPolicy("", undefined)).toBe(false);
  });
});

describe("passwordRequirements", () => {
  it("lists only the rules the policy actually enables", () => {
    const labels = passwordRequirements("x", {
      min_length: 6,
      require_uppercase: true,
      require_lowercase: false,
      require_number: false,
      require_special: false,
    }).map((r) => r.label);
    expect(labels).toEqual(["At least 6 characters", "Uppercase letter"]);
  });

  it("returns nothing when the policy is unknown", () => {
    expect(passwordRequirements("anything", undefined)).toEqual([]);
  });
});

describe("passwordStrength", () => {
  it("reports Strong only when every requirement is met", () => {
    expect(passwordStrength(passwordRequirements("Abcd@1234$", strict)).label).toBe("Strong");
  });

  it("reports Weak for a password meeting almost nothing", () => {
    expect(passwordStrength(passwordRequirements("abc", strict)).label).toBe("Weak");
  });

  it("is 0% with no requirements rather than dividing by zero", () => {
    expect(passwordStrength([]).pct).toBe(0);
  });
});
