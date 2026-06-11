// Strong signals that a nearby number is a one-time / verification code.
const CODE_KEYWORDS =
  /(verification|verify|one[-\s]?time|passcode|security\s+code|confirm(?:ation)?|otp|\bcode\b|\bpin\b)/i;

/**
 * Best-effort extraction of a one-time / verification code from email text
 * (subject + body). Looks for a 4–8 digit run (optionally a single letter-dash
 * prefix, e.g. "G-123456") that sits within ~32 chars of a verification
 * keyword, preferring 6-digit codes. Returns null when nothing convincing is
 * found. It's a convenience hint for the reader, not an authority — false
 * positives just show an ignorable chip.
 */
export function extractVerificationCode(text: string): string | null {
  if (!text) return null;
  const re = /\b(?:[A-Za-z]-)?(\d{4,8})\b/g;
  let m: RegExpExecArray | null;
  let best: { code: string; score: number } | null = null;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    const window = text.slice(Math.max(0, idx - 32), idx + m[0].length + 32);
    if (!CODE_KEYWORDS.test(window)) continue;
    const code = m[1];
    // Prefer 6-digit (the common OTP length), then 5/7, then 4/8.
    const score = code.length === 6 ? 3 : code.length === 4 || code.length === 8 ? 1 : 2;
    if (!best || score > best.score) best = { code, score };
  }
  return best?.code ?? null;
}
