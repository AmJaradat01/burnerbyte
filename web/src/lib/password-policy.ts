/** Client-side mirror of the server's password policy check.
 *
 *  The authority is `auth.ValidatePassword` in internal/auth/password.go; the
 *  active policy is served publicly (and pre-setup) by `GET /auth/sso-status`,
 *  so every surface that collects a password can gate on the real rules rather
 *  than assuming the defaults. This is advisory only — the server re-validates.
 *
 *  It lives here rather than inside a component because the setup wizard needs
 *  the boolean to decide whether the "Next" button is enabled, not just to draw
 *  a checklist. Without that, the wizard let you complete every step and only
 *  rejected the password on the final submit, four screens later. */

export interface PasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_number: boolean;
  require_special: boolean;
}

export interface PasswordRequirement {
  met: boolean;
  label: string;
}

/** Requirements for the active policy, in the order the server checks them.
 *  Returns [] when the policy has not loaded yet, which callers treat as
 *  "unknown" rather than "satisfied". */
export function passwordRequirements(
  password: string,
  policy: PasswordPolicy | undefined,
): PasswordRequirement[] {
  if (!policy) return [];
  return [
    { met: password.length >= policy.min_length, label: `At least ${policy.min_length} characters` },
    ...(policy.require_uppercase ? [{ met: /[A-Z]/.test(password), label: "Uppercase letter" }] : []),
    ...(policy.require_lowercase ? [{ met: /[a-z]/.test(password), label: "Lowercase letter" }] : []),
    ...(policy.require_number ? [{ met: /\d/.test(password), label: "Number" }] : []),
    ...(policy.require_special ? [{ met: /[^A-Za-z0-9]/.test(password), label: "Special character" }] : []),
  ];
}

/** Whether the password satisfies every rule in the active policy.
 *
 *  When the policy has not loaded, this falls back to a non-empty check and
 *  lets the server be the judge — blocking the user on a failed metadata
 *  request would be worse than a round-trip rejection. */
export function passwordMeetsPolicy(
  password: string,
  policy: PasswordPolicy | undefined,
): boolean {
  if (!policy) return password.length > 0;
  return passwordRequirements(password, policy).every((r) => r.met);
}

export interface PasswordStrength {
  pct: number;
  label: "Weak" | "Fair" | "Strong";
  colorClass: string;
}

export function passwordStrength(requirements: PasswordRequirement[]): PasswordStrength {
  const total = requirements.length;
  const pct = total > 0 ? (requirements.filter((r) => r.met).length / total) * 100 : 0;
  if (pct <= 33) return { pct, label: "Weak", colorClass: "bg-destructive/50" };
  if (pct <= 66) return { pct, label: "Fair", colorClass: "bg-warning/50" };
  return { pct, label: "Strong", colorClass: "bg-success/50" };
}
