# Implementation Plan: Auth Lifecycle Management

## Overview

Add per-user auth method locking, admin-driven auth method migration, session binding to auth method, and invite expiry notifications. Changes touch the user domain model, auth service, admin handler, org repo, a new worker, a new email template, the frontend user detail dialog, and wiring in main.go.

## Tasks

- [x] 1. Add `auth_method_lock` to domain model and database layer
  - [x] 1.1 Add `AuthMethodLock *string` field to `domain.User` struct in `internal/domain/user.go`
    - Add the field with JSON tag `json:"auth_method_lock,omitempty"`
    - _Requirements: 1.4_

  - [x] 1.2 Update `internal/repository/postgres/user_repo.go` to include `auth_method_lock` in all queries
    - Update `Create` INSERT to include `auth_method_lock`
    - Update `GetByID` / `GetByEmail` SELECT (via `scanOne`) to include `auth_method_lock`
    - Update `Update` SET to include `auth_method_lock`
    - Update `ListAll` SELECT to include `auth_method_lock`
    - Update `scanOne` to scan `auth_method_lock` into `User.AuthMethodLock`
    - _Requirements: 1.4_

- [x] 2. Implement auth method lock enforcement in AuthService
  - [x] 2.1 Add `checkAuthMethodLock` helper in `internal/service/auth_service.go`
    - Returns error if `user.AuthMethodLock` is non-nil and doesn't match the attempted method
    - Returns nil if lock is nil (any method allowed)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.2 Add lock check to `Login` method
    - After fetching user, before password verification, check `if user.AuthMethodLock == "sso"` → reject
    - _Requirements: 1.1, 1.3_

  - [x] 2.3 Add lock check to `SSOLogin` method
    - For existing users (not new), check `if user.AuthMethodLock == "password"` → reject
    - _Requirements: 1.2, 1.3_

  - [x]* 2.4 Write property test for lock enforcement (Property 1)
    - **Property 1: Lock enforcement is total**
    - For any user with `auth_method_lock = "sso"`, password login always fails; for `"password"`, SSO login always fails; for nil, both succeed
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 3. Implement session binding to auth method on refresh
  - [x] 3.1 Add `checkSessionAuthMethodLock` helper in `internal/service/auth_service.go`
    - Compares `user.AuthMethodLock` against `session.SSOProviderName`
    - Lock "sso" requires `session.SSOProviderName != nil`; lock "password" requires `session.SSOProviderName == nil`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 3.2 Add session binding check to `Refresh` method
    - After loading session and user, call `checkSessionAuthMethodLock`
    - If mismatch, revoke session and return error
    - _Requirements: 3.1, 3.2, 3.3_

  - [x]* 3.3 Write property test for session binding (Property 2)
    - **Property 2: Session binding is consistent**
    - Refresh succeeds iff session auth method matches user lock (or lock is nil)
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement auth method migration
  - [x] 5.1 Add `MigrateToSSO` method to `AuthService`
    - Verify user has linked SSO identity, clear password hash, set `auth_method_lock = "sso"`, revoke all sessions
    - _Requirements: 2.1, 2.2_

  - [x] 5.2 Add `MigrateToPassword` method to `AuthService`
    - Validate password against policy, hash it, set `auth_method_lock = "password"`, update `password_changed_at`, revoke all sessions
    - _Requirements: 2.3, 2.4_

  - [x] 5.3 Add `SetAuthMethodLock` method to `AuthService`
    - Allow admin to set/clear the lock field directly
    - Validate value is nil, "sso", or "password"
    - _Requirements: 1.4_

  - [x]* 5.4 Write property test for migration atomicity (Property 3)
    - **Property 3: Migration atomicity**
    - After MigrateToSSO: password_hash = nil, lock = "sso", sessions revoked. After MigrateToPassword: password_hash != nil, lock = "password", sessions revoked.
    - **Validates: Requirements 2.1, 2.3**

  - [x]* 5.5 Write property test for migration preconditions (Property 4)
    - **Property 4: Migration preconditions**
    - MigrateToSSO fails if no SSO identity. MigrateToPassword fails if password doesn't meet policy.
    - **Validates: Requirements 2.2, 2.4**

- [x] 6. Add admin handler endpoints for migration and lock
  - [x] 6.1 Add `POST /admin/users/{userId}/migrate-auth` endpoint in `internal/handler/admin.go`
    - Parse `{"target": "sso"}` or `{"target": "password", "new_password": "..."}` from body
    - Call `MigrateToSSO` or `MigrateToPassword` on AuthService
    - Record audit log entry
    - Register route in `Routes` and in `cmd/api/main.go`
    - _Requirements: 2.1, 2.3_

  - [x] 6.2 Extend `PATCH /admin/users/{userId}` to accept `auth_method_lock`
    - Add `AuthMethodLock *string` to the UpdateUser input struct
    - Call `SetAuthMethodLock` when provided
    - Record audit log with before/after diff
    - _Requirements: 1.4_

- [x] 7. Implement invite expiry notifications
  - [x] 7.1 Add `FindExpiringInvites` method to `OrgRepo` in `internal/repository/postgres/org_repo.go`
    - Query: `SELECT ... FROM invites WHERE accepted_at IS NULL AND expires_at BETWEEN NOW() AND NOW() + $1`
    - Return list of `domain.Invite` with `InvitedBy` populated
    - _Requirements: 4.1_

  - [x] 7.2 Create `internal/worker/invite_expiry.go` with `InviteExpiryJob`
    - Follow existing worker pattern: return `func(ctx context.Context) error`
    - Call `FindExpiringInvites`, loop through results, look up inviter, send email
    - Skip invites with no inviter, log errors and continue on email failures
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 7.3 Create `internal/mailer/templates/invite_expiry.html` email template
    - Include invitee email, hours remaining, and link to settings page
    - Follow existing template pattern (inline styles, simple HTML)
    - _Requirements: 4.2_

  - [x]* 7.4 Write property test for expiry notification bounds (Property 5)
    - **Property 5: Expiry notifications are bounded**
    - At most one email per expiring invite per run, sent only to inviter, skips invites with no inviter
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x]* 7.5 Write property test for expiry worker error resilience (Property 6)
    - **Property 6: Expiry worker error resilience**
    - Worker continues processing all invites even when some email sends fail
    - **Validates: Requirement 4.4**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Wire everything together and add frontend UI
  - [x] 9.1 Register invite expiry worker in `cmd/api/main.go`
    - Add `wm.Add("invite_expiry", 24*time.Hour, worker.InviteExpiryJob(orgRepo, userRepo, ml, cfg.Server.FrontendURL))`
    - _Requirements: 4.1_

  - [x] 9.2 Register `POST /admin/users/{userId}/migrate-auth` route in `cmd/api/main.go`
    - Add the route with `auth.RequireSystemAdmin` middleware
    - _Requirements: 2.1, 2.3_

  - [x] 9.3 Add auth lock UI to `UserDetailDialog` in `web/src/components/settings/unified-users-tab.tsx`
    - Display `auth_method_lock` as a badge in the Account Information section
    - Add a select/dropdown for admins to set lock to "SSO Only", "Password Only", or "Any Method"
    - Add "Migrate to SSO" and "Migrate to Password" buttons with appropriate guards
    - Wire mutations to `PATCH /admin/users/{userId}` and `POST /admin/users/{userId}/migrate-auth`
    - _Requirements: 1.1, 1.2, 2.1, 2.3_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use `pgregory.net/rapid` (existing project convention)
- The database migration (`ALTER TABLE users ADD COLUMN auth_method_lock`) will be handled as part of task 1.2 query updates — the column addition itself is a schema change applied during deployment
