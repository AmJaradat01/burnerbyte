# Bugfix Requirements Document

## Introduction

This document covers three related user management and UX bugs in the BurnerByte platform:

1. **"Get Started" button visible when registration is disabled** — The public landing page (`LandingPage` component in `web/src/app/page.tsx`) always renders "Get Started" and "Create Account" links pointing to `/register`, regardless of the `allow_registration` platform setting. While the register page itself redirects to `/login` when registration is disabled, the landing page still shows misleading CTAs. The login page correctly hides the "Create account" link based on `sso?.allow_registration`, but the landing page does not fetch or check this setting.

2. **SSO users not auto-verified on identity-based login** — When a user originally registers with a password (`EmailVerified = false`), then links an SSO identity, subsequent SSO logins that resolve via the SSO identity lookup path in `AuthService.SSOLogin` do not update `EmailVerified` to `true`. The "found by email" path correctly sets `user.EmailVerified = true`, and new SSO users are created with `EmailVerified: true`, but the SSO identity lookup path (which runs first when an identity record exists) loads the user without updating their verification status.

3. **User details panel missing auth type column and too narrow** — The admin user list in `UnifiedUsersTab` does not display the authentication method (Password vs SSO provider) as a column in the table. The user details dialog uses `max-w-lg` which is too narrow for the amount of information displayed. The auth method is shown inside the detail dialog but not in the list view, making it hard to quickly identify SSO vs password users at a glance.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN public registration is disabled (`allow_registration = false`) AND an unauthenticated user visits the landing page THEN the system displays "Get Started" and "Create Account" links/buttons that point to `/register`

1.2 WHEN public registration is disabled AND an unauthenticated user clicks "Get Started" on the landing page THEN the system navigates to `/register` which immediately redirects to `/login`, creating a confusing user experience

1.3 WHEN a user originally registered with a password (unverified email) AND later linked an SSO identity AND subsequently logs in via SSO (resolved through SSO identity lookup) THEN the system does not update `EmailVerified` to `true` despite the user being authenticated through a trusted identity provider

1.4 WHEN an admin views the user list in the Settings > Users tab THEN the system does not display the authentication method (Password, SSO provider name) as a column in the table, requiring the admin to open each user's detail dialog to see this information

1.5 WHEN an admin opens the user details dialog THEN the system renders the dialog with `max-w-lg` width which is too narrow for the information density, causing content to feel cramped

### Expected Behavior (Correct)

2.1 WHEN public registration is disabled (`allow_registration = false`) AND an unauthenticated user visits the landing page THEN the system SHALL hide the "Get Started" and "Create Account" links/buttons, or replace them with "Sign In" links pointing to `/login`

2.2 WHEN public registration is disabled AND an unauthenticated user visits the landing page THEN the system SHALL only show navigation options that lead to valid destinations (login, SSO)

2.3 WHEN a user logs in via SSO (regardless of whether resolved through SSO identity lookup or email lookup) THEN the system SHALL set `EmailVerified` to `true` and persist the update, since SSO authentication through a trusted identity provider constitutes email verification

2.4 WHEN an admin views the user list in the Settings > Users tab THEN the system SHALL display the authentication method (e.g., "Password", "Google", "GitHub") as a visible column in the user table

2.5 WHEN an admin opens the user details dialog THEN the system SHALL render the dialog with a wider layout (e.g., `max-w-2xl`) to better accommodate the user account information

### Unchanged Behavior (Regression Prevention)

3.1 WHEN public registration is enabled (`allow_registration = true`) AND an unauthenticated user visits the landing page THEN the system SHALL CONTINUE TO display "Get Started" and "Create Account" links pointing to `/register`

3.2 WHEN a user registers with a password THEN the system SHALL CONTINUE TO set `EmailVerified` to `false` and send a verification email when email verification is enabled

3.3 WHEN a new user is created via SSO (no prior account) THEN the system SHALL CONTINUE TO create the user with `EmailVerified = true`

3.4 WHEN an existing user is found by email during SSO login (no prior SSO identity) THEN the system SHALL CONTINUE TO set `EmailVerified = true` and link the SSO identity

3.5 WHEN an admin views the user list THEN the system SHALL CONTINUE TO display all existing columns (User, Org Role, Status, Last Active, Joined, Actions) without removing any

3.6 WHEN an admin edits user details (display name, admin status, email verified toggle) THEN the system SHALL CONTINUE TO save changes correctly via the existing admin API endpoints

3.7 WHEN the login page is rendered with registration disabled THEN the system SHALL CONTINUE TO hide the "Create account" link as it currently does
