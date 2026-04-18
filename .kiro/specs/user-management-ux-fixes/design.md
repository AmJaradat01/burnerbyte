# User Management UX Fixes — Bugfix Design

## Overview

This design addresses three related user management bugs in the BurnerByte platform:

1. **Landing page ignores `allow_registration` setting** — The `LandingPage` component in `web/src/app/page.tsx` unconditionally renders "Get Started" and "Create Account" links pointing to `/register`, even when public registration is disabled. The login page already correctly hides its "Create account" link by querying `/auth/sso-status`, but the landing page never fetches this setting.

2. **SSO identity-lookup path skips email verification** — In `AuthService.SSOLogin` (`internal/service/auth_service.go`), when a returning SSO user is resolved via `ssoIdentityRepo.GetByProviderSubject` (the identity lookup path), the code loads the user but does not set `EmailVerified = true`. The email-lookup path and new-user path both correctly mark the user as verified, but the identity-lookup path — which executes first when an identity record exists — leaves `EmailVerified` unchanged.

3. **Admin user table missing auth type column; details dialog too narrow** — The `UnifiedUsersTab` component (`web/src/components/settings/unified-users-tab.tsx`) does not display an "Auth" column in the user list table. The `UserDetailDialog` uses `max-w-lg`, which is too narrow for the information density.

The fix strategy is minimal and targeted: add an SSO status fetch to the landing page, add two lines to the identity-lookup path in `SSOLogin`, add a table column, and widen the dialog.

## Glossary

- **Bug_Condition (C)**: The set of conditions that trigger each bug — (1) unauthenticated visit to landing page when `allow_registration=false`, (2) SSO login resolved via identity lookup when `EmailVerified=false`, (3) admin viewing user list without auth type column
- **Property (P)**: The desired correct behavior — (1) registration CTAs hidden or replaced with sign-in, (2) `EmailVerified` set to `true` on any SSO login, (3) auth type column visible in table
- **Preservation**: Existing behaviors that must remain unchanged — registration CTAs when registration is enabled, password registration setting `EmailVerified=false`, existing table columns, admin edit functionality
- **`AuthService.SSOLogin`**: The function in `internal/service/auth_service.go` that handles SSO authentication, user creation/lookup, and session creation
- **`ssoIdentityRepo.GetByProviderSubject`**: The repository method that looks up an SSO identity by provider name and subject ID — the "identity lookup path"
- **`LandingPage`**: The public-facing component in `web/src/app/page.tsx` rendered for unauthenticated users
- **`UnifiedUsersTab`**: The admin user management component in `web/src/components/settings/unified-users-tab.tsx`
- **`/auth/sso-status`**: Public API endpoint that returns SSO configuration including `allow_registration`

## Bug Details

### Bug Condition

The bugs manifest under three distinct conditions:

**Bug 1 — Landing Page CTAs**: When an unauthenticated user visits the landing page and `allow_registration` is `false`, the page renders "Get Started" and "Create Account" links to `/register`. The `LandingPage` component never fetches `/auth/sso-status` to check the `allow_registration` setting.

**Bug 2 — SSO Email Verification**: When a user with `EmailVerified=false` logs in via SSO and is resolved through the identity lookup path (`ssoIdentityRepo.GetByProviderSubject` succeeds), the code loads the user via `userRepo.GetByID` but does not update `EmailVerified` to `true` or persist the change.

**Bug 3 — Missing Auth Column**: When an admin views the user list, there is no "Auth" column showing the authentication method. The `sso_provider` field exists on the `User` type but is only displayed inside the detail dialog, not in the table. The dialog uses `max-w-lg` which is too narrow.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { action, context }
  OUTPUT: boolean

  // Bug 1: Landing page with registration disabled
  IF input.action == "visit_landing_page"
     AND input.context.allow_registration == false
     AND input.context.user == null
     RETURN true

  // Bug 2: SSO login via identity lookup with unverified email
  IF input.action == "sso_login"
     AND input.context.identity_found == true
     AND input.context.user.email_verified == false
     RETURN true

  // Bug 3: Admin viewing user list without auth column
  IF input.action == "view_user_list"
     AND input.context.is_admin == true
     AND input.context.auth_column_visible == false
     RETURN true

  RETURN false
END FUNCTION
```

### Examples

- **Bug 1**: Admin sets `allow_registration = false` in platform settings. An unauthenticated visitor sees "Get Started" button in the header and "Create your free account" CTA in the hero section, both linking to `/register`. Clicking "Get Started" navigates to `/register` which immediately redirects to `/login`.
- **Bug 2**: User registers with email/password (`EmailVerified = false`). User links their GitHub SSO identity. User logs out and logs back in via GitHub SSO. The `ssoIdentityRepo.GetByProviderSubject` call finds the identity, loads the user, but `EmailVerified` remains `false` despite GitHub having verified the email.
- **Bug 3**: Admin opens Settings → Users tab. The table shows User, Org Role, Status, Last Active, Joined, Actions columns. There is no way to see at a glance which users authenticate via SSO vs password without clicking each row.
- **Bug 3 (dialog)**: Admin clicks a user row. The detail dialog opens with `max-w-lg` (32rem) width, causing the info grid and form fields to feel cramped.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When `allow_registration = true`, the landing page must continue to display "Get Started" and "Create Account" links pointing to `/register`
- Password registration must continue to set `EmailVerified = false` and send a verification email when email verification is enabled
- New SSO users (no prior account) must continue to be created with `EmailVerified = true`
- The email-lookup SSO path must continue to set `EmailVerified = true` and link the SSO identity
- All existing table columns (User, Org Role, Status, Last Active, Joined, Actions) must remain present
- Admin user edit functionality (display name, admin status, email verified toggle) must continue to work
- The login page must continue to hide the "Create account" link when registration is disabled

**Scope:**
All inputs that do NOT involve the three bug conditions should be completely unaffected by this fix. This includes:
- Authenticated user homepage rendering
- Password-based login flow
- SSO login for new users (no prior account)
- SSO login resolved via email lookup (no prior identity record)
- Non-admin user list views
- All other admin panel functionality

## Hypothesized Root Cause

Based on code analysis, the root causes are confirmed:

1. **Landing Page — Missing SSO Status Fetch**: The `LandingPage` component in `web/src/app/page.tsx` (line ~430) is a pure presentational component that never calls `/auth/sso-status`. The `LoginPage` in `web/src/app/login/page.tsx` correctly uses `useQuery` to fetch SSO status and conditionally renders the "Create account" link with `{(sso?.allow_registration ?? true) && ...}`. The `LandingPage` has no equivalent logic — all three registration links (header "Get Started", hero "Get Started Free", footer "Create Account") are unconditionally rendered.

2. **SSO Identity Lookup — Missing EmailVerified Update**: In `AuthService.SSOLogin` (`internal/service/auth_service.go`, around line 290), when `ssoIdentityRepo.GetByProviderSubject` succeeds, the code only calls `UpdateLastUsed` on the identity and `GetByID` on the user. It does not check or update `user.EmailVerified`. Compare with the email-lookup path (around line 310) which explicitly sets `user.EmailVerified = true` and calls `userRepo.Update`. The identity-lookup path is missing these two operations.

3. **Missing Auth Column — Omitted from Table Markup**: The `UnifiedUsersTab` table header in `unified-users-tab.tsx` defines columns: User, Org Role, Status, Last Active, Joined, Actions. There is no "Auth" column. The `sso_provider` field is available on the `User` type (from the API response) and is displayed inside `UserDetailDialog` in the info grid, but not in the table rows. The dialog width `max-w-lg` is a simple CSS class that needs to be changed to `max-w-2xl`.

## Correctness Properties

Property 1: Bug Condition — Landing Page Hides Registration CTAs When Disabled

_For any_ unauthenticated visit to the landing page where `allow_registration` is `false`, the rendered page SHALL NOT contain any links pointing to `/register`. Instead, the page SHALL show "Sign In" links pointing to `/login`.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition — SSO Identity Lookup Sets EmailVerified

_For any_ SSO login where the user is resolved via the identity lookup path (`ssoIdentityRepo.GetByProviderSubject` succeeds) and the user's `EmailVerified` is `false`, the `SSOLogin` function SHALL set `EmailVerified = true` and persist the update via `userRepo.Update` before creating the session.

**Validates: Requirements 2.3**

Property 3: Preservation — Landing Page Shows Registration CTAs When Enabled

_For any_ unauthenticated visit to the landing page where `allow_registration` is `true`, the rendered page SHALL continue to display "Get Started" and "Create Account" links pointing to `/register`, preserving the existing behavior.

**Validates: Requirements 3.1**

Property 4: Preservation — SSO Login Preserves Non-Identity-Lookup Paths

_For any_ SSO login that does NOT resolve via the identity lookup path (new user creation or email-lookup path), the `SSOLogin` function SHALL produce the same result as the original function, preserving `EmailVerified = true` for new users and email-lookup users.

**Validates: Requirements 3.3, 3.4**

Property 5: Preservation — Password Registration Unchanged

_For any_ password-based registration, the `Register` function SHALL continue to set `EmailVerified = false` and the registration flow SHALL remain unchanged by the SSO fix.

**Validates: Requirements 3.2**

## Fix Implementation

### Changes Required

**File**: `internal/service/auth_service.go`

**Function**: `SSOLogin`

**Specific Changes**:
1. **Add EmailVerified update to identity lookup path**: After loading the user via `userRepo.GetByID` in the identity-found branch (around line 295), add a check: if `!user.EmailVerified`, set `user.EmailVerified = true` and call `s.userRepo.Update(ctx, user)`. This mirrors the behavior in the email-lookup path.

```go
// After: user, err = s.userRepo.GetByID(ctx, identity.UserID)
if !user.EmailVerified {
    user.EmailVerified = true
    _ = s.userRepo.Update(ctx, user)
}
```

---

**File**: `web/src/app/page.tsx`

**Function**: `LandingPage`

**Specific Changes**:
2. **Fetch SSO status in LandingPage**: Add a `useQuery` call to fetch `/auth/sso-status` (same pattern as `LoginPage`). Extract `allow_registration` from the response.
3. **Conditionally render registration links**: Wrap the three `/register` links in the header, hero section, and footer CTA with a condition on `allow_registration`. When `false`, either hide the links or replace them with `/login` links.
4. **Default to showing links while loading**: Use `sso?.allow_registration ?? true` as the default so links are visible during the initial fetch, matching the login page's behavior.

---

**File**: `web/src/components/settings/unified-users-tab.tsx`

**Function**: `UnifiedUsersTab` (table section) and `UserDetailDialog`

**Specific Changes**:
5. **Add Auth column to table header**: Add a new `<th>` for "Auth" between "Org Role" and "Status" columns, visible only for admin users. Use `hidden md:table-cell` for responsive behavior.
6. **Add Auth cell to table rows**: Add a `<td>` that displays `u.sso_provider ?? "Password"` as a badge. Use a distinguishing style (e.g., outline badge with provider name for SSO, default for Password).
7. **Widen UserDetailDialog**: Change `max-w-lg` to `max-w-2xl` on the `<DialogContent>` element.
8. **Update empty row colSpan**: Increment the `colSpan` on the empty-state `<td>` from 6 to 7 to account for the new column.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that exercise each bug condition on the unfixed code to observe failures and confirm root causes.

**Test Cases**:
1. **Landing Page Registration Links Test**: Render `LandingPage` and assert that `/register` links are present regardless of `allow_registration` setting (will confirm bug on unfixed code)
2. **SSO Identity Lookup EmailVerified Test**: Call `SSOLogin` with a mock identity that resolves via `GetByProviderSubject` where user has `EmailVerified=false`. Assert `EmailVerified` remains `false` after login (will confirm bug on unfixed code)
3. **Auth Column Absence Test**: Render `UnifiedUsersTab` as admin and assert no "Auth" column header exists (will confirm bug on unfixed code)
4. **Dialog Width Test**: Render `UserDetailDialog` and assert `max-w-lg` class is present (will confirm bug on unfixed code)

**Expected Counterexamples**:
- Landing page renders `/register` links even when `allow_registration=false`
- `SSOLogin` returns user with `EmailVerified=false` when resolved via identity lookup
- Table header does not contain "Auth" column text

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

Specifically:
- For Bug 1: Assert no `/register` links when `allow_registration=false`
- For Bug 2: Assert `user.EmailVerified == true` after `SSOLogin` via identity lookup
- For Bug 3: Assert "Auth" column present and `max-w-2xl` class on dialog

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-bug inputs, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Landing Page with Registration Enabled**: Observe that `/register` links appear when `allow_registration=true` on unfixed code, then verify this continues after fix
2. **SSO New User Path Preservation**: Observe that new SSO users are created with `EmailVerified=true` on unfixed code, then verify this continues after fix
3. **SSO Email Lookup Path Preservation**: Observe that email-lookup SSO users get `EmailVerified=true` on unfixed code, then verify this continues after fix
4. **Password Registration Preservation**: Observe that password registration sets `EmailVerified=false` on unfixed code, then verify this continues after fix
5. **Existing Table Columns Preservation**: Observe that all existing columns render on unfixed code, then verify they still render after fix

### Unit Tests

- Test `SSOLogin` identity-lookup path sets `EmailVerified=true` for previously unverified users
- Test `SSOLogin` identity-lookup path leaves `EmailVerified=true` unchanged for already-verified users
- Test `SSOLogin` email-lookup path still sets `EmailVerified=true` (regression)
- Test `SSOLogin` new-user path still creates with `EmailVerified=true` (regression)
- Test `LandingPage` renders no `/register` links when `allow_registration=false`
- Test `LandingPage` renders `/register` links when `allow_registration=true`
- Test `UnifiedUsersTab` renders "Auth" column header for admin users
- Test `UserDetailDialog` uses `max-w-2xl` class

### Property-Based Tests

- Generate random SSO callback results with varying identity-found/email-found states and verify `EmailVerified` is always `true` after `SSOLogin`
- Generate random `allow_registration` boolean values and verify landing page link visibility matches the setting
- Generate random user lists with varying `sso_provider` values and verify the Auth column correctly displays "Password" or the provider name

### Integration Tests

- Test full SSO login flow: register with password → link SSO → logout → SSO login → verify `EmailVerified=true`
- Test landing page end-to-end: toggle `allow_registration` via admin API → visit landing page → verify correct CTAs
- Test admin user list: create mix of password and SSO users → view user list → verify Auth column shows correct values
