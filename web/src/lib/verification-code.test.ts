import { describe, it, expect } from "vitest";
import { extractVerificationCode } from "./verification-code";

describe("extractVerificationCode", () => {
  it("extracts codes near a verification keyword", () => {
    expect(extractVerificationCode("Your verification code is 123456")).toBe("123456");
    expect(extractVerificationCode("482910 is your one-time passcode")).toBe("482910");
    expect(extractVerificationCode("Use code 8472 to confirm your email")).toBe("8472");
    expect(extractVerificationCode("G-654321 is your Google verification code")).toBe("654321");
    expect(extractVerificationCode("Enter OTP 5567 to continue")).toBe("5567");
  });

  it("prefers the 6-digit code when several numbers appear", () => {
    expect(extractVerificationCode("Order 12 — your security code is 998877, valid 10 min")).toBe("998877");
  });

  it("returns null when no verification context is present", () => {
    expect(extractVerificationCode("Your order #12345 has shipped")).toBeNull();
    expect(extractVerificationCode("Meeting moved to 1430 today")).toBeNull();
    expect(extractVerificationCode("Invoice 2024 total due: 4500")).toBeNull();
    expect(extractVerificationCode("")).toBeNull();
    expect(extractVerificationCode("no numbers here at all")).toBeNull();
  });
});
