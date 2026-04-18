# Implementation Plan

- [x] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - SSO Identity Lookup Skips EmailVerified, Landing Page Shows Registration When Disabled, Missing Auth Column
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bugs exist
  - **Scoped PBT Approach**: Focus on the three concrete bug conditions:
    - Bug 2 (SSO EmailVerified): Use `pgregory.net/rapid` to generate SSO callback results with varying providers and subjects. For each, simulate the identity-lookup path where `GetByProviderSubject` succeeds and the loaded user has `EmailVerified=false`. Assert that after `SSOLogin`, `user.EmailVerified == true`. On unfixed code this will FAIL because the identity-lookup path does not update `EmailVerified`.
    - Bug 1 (Landing Page): This is a frontend component test — verify that when `allow_registration=false` is returned from `/auth/sso-status`, the `LandingPage` does NOT render any links with `href="/register"`. On unfixed code this will FAIL because `LandingPage` never fetches SSO status.
    - Bug 3 (Auth Column): Verify that the `UnifiedUsersTab` table header includes an "Auth" column and that `UserDetailDialog` uses `max-w-2xl`. On unfixed code this will FAIL because the column is missing and dialog uses `max-w-lg`.
  - Write Go property-based test in `internal/service/auth_service_test.go` for Bug 2 (SSO EmailVerified):
    - Create mock repos that simulate identity-lookup path (GetByProviderSubject returns identity, GetByID returns user with EmailVerified=false)
    - Generate random provider names and subject IDs via rapid
    - Assert `user.EmailVerified == true` after SSOLogin and assert `userRepo.Update` was called
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists)
  - Document counterexamples found (e.g., "SSOLogin via identity lookup returns user with EmailVerified=false")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.3, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - SSO Non-Identity-Lookup Paths, Password Registration, Existing Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - **Observe behavior on UNFIXED code for non-buggy inputs:**
    - Observe: SSOLogin for a NEW user (no identity, no email match) creates user with `EmailVerified=true`
    - Observe: SSOLogin via email-lookup path (no identity, email found) sets `EmailVerified=true` and calls `userRepo.Update`
    - Observe: Register with password sets `EmailVerified=false`
    - Observe: SSOLogin via identity-lookup path where user already has `EmailVerified=true` leaves it `true`
  - Write Go property-based tests in `internal/service/auth_service_test.go` using `pgregory.net/rapid`:
    - **New SSO user preservation**: For all random provider/subject/email combinations where no identity and no email match exist, assert user is created with `EmailVerified=true`
    - **Email-lookup SSO preservation**: For all random provider/subject combinations where no identity exists but email matches an existing user, assert `EmailVerified=true` after SSOLogin
    - **Password registration preservation**: For all random valid email/password/displayName combinations, assert `EmailVerified=false` after Register
    - **Already-verified identity-lookup preservation**: For all random provider/subject combinations where identity exists and user has `EmailVerified=true`, assert `EmailVerified` remains `true` after SSOLogin
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for SSO identity-lookup path not setting EmailVerified

  - [x] 3.1 Add EmailVerified update to SSO identity-lookup path in `auth_service.go`
    - In `SSOLogin`, after `user, err = s.userRepo.GetByID(ctx, identity.UserID)` in the identity-found branch (~line 295)
    - Add check: `if !user.EmailVerified { user.EmailVerified = true; _ = s.userRepo.Update(ctx, user) }`
    - This mirrors the email-lookup path behavior (~line 310) which already sets `user.EmailVerified = true`
    - _Bug_Condition: isBugCondition(input) where input.action == "sso_login" AND input.context.identity_found == true AND input.context.user.email_verified == false_
    - _Expected_Behavior: user.EmailVerified == true after SSOLogin via identity lookup, persisted via userRepo.Update_
    - _Preservation: New SSO users still created with EmailVerified=true; email-lookup path still sets EmailVerified=true; password registration still sets EmailVerified=false_
    - _Requirements: 1.3, 2.3, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes (SSO EmailVerified)
    - **Property 1: Expected Behavior** - SSO Identity Lookup Sets EmailVerified
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (EmailVerified=true after identity-lookup SSOLogin)
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.3_

  - [x] 3.3 Verify preservation tests still pass (SSO paths)
    - **Property 2: Preservation** - SSO Non-Identity-Lookup Paths and Password Registration
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Fix for landing page showing registration links when disabled

  - [x] 4.1 Add SSO status fetch to `LandingPage` component in `web/src/app/page.tsx`
    - Add `useQuery` call to fetch `/auth/sso-status` (same pattern as `LoginPage` in `web/src/app/login/page.tsx`)
    - Extract `allow_registration` from the response
    - Use `sso?.allow_registration ?? true` as default while loading (matches login page behavior)
    - _Bug_Condition: isBugCondition(input) where input.action == "visit_landing_page" AND input.context.allow_registration == false AND input.context.user == null_
    - _Expected_Behavior: No links with href="/register" rendered when allow_registration=false; "Sign In" links to /login shown instead_
    - _Preservation: When allow_registration=true, "Get Started" and "Create Account" links to /register continue to render_
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1_

  - [x] 4.2 Conditionally render registration links in `LandingPage`
    - Header "Get Started" link (`href="/register"`): When `allow_registration=false`, change to "Sign In" pointing to `/login`
    - Hero section "Get Started Free" link (`href="/register"`): When `allow_registration=false`, hide or replace with "Sign In" pointing to `/login`
    - Footer CTA "Create Account" link (`href="/register"`): When `allow_registration=false`, hide or replace with "Sign In" pointing to `/login`
    - Use pattern: `{(sso?.allow_registration ?? true) ? <Link href="/register">...</Link> : <Link href="/login">...</Link>}`
    - _Requirements: 2.1, 2.2, 3.1_

- [x] 5. Fix for missing Auth column and narrow dialog in `UnifiedUsersTab`

  - [x] 5.1 Add "Auth" column to user table in `web/src/components/settings/unified-users-tab.tsx`
    - Add `<th>` for "Auth" between "Org Role" and "Status" columns in the table header, with `hidden md:table-cell` for responsive behavior
    - Add `<td>` in each table row displaying `u.sso_provider ?? "Password"` as a badge
    - Use distinguishing badge styles: outline badge with provider name for SSO users, default style for Password users
    - Only show for admin users (consistent with Status column visibility pattern)
    - _Bug_Condition: isBugCondition(input) where input.action == "view_user_list" AND input.context.is_admin == true AND input.context.auth_column_visible == false_
    - _Expected_Behavior: "Auth" column visible in table showing "Password" or SSO provider name_
    - _Preservation: All existing columns (User, Org Role, Status, Last Active, Joined, Actions) remain present and unchanged_
    - _Requirements: 1.4, 2.4, 3.5_

  - [x] 5.2 Update empty row colSpan
    - Increment the `colSpan` on the empty-state `<td>` from 6 to 7 to account for the new Auth column
    - _Requirements: 2.4, 3.5_

  - [x] 5.3 Widen `UserDetailDialog` from `max-w-lg` to `max-w-2xl`
    - Change `max-w-lg` to `max-w-2xl` on the `<DialogContent>` element in `UserDetailDialog`
    - _Bug_Condition: Dialog too narrow for information density_
    - _Expected_Behavior: Dialog renders at max-w-2xl width_
    - _Requirements: 1.5, 2.5_

- [x] 6. Checkpoint — Ensure all tests pass
  - Run full Go test suite: `go test ./internal/service/... ./internal/auth/...`
  - Verify all property-based tests pass (both bug condition and preservation)
  - Verify no regressions in existing tests
  - Ensure all tests pass, ask the user if questions arise.
