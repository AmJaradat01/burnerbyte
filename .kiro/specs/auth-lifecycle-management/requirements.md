# Requirements Document

## Introduction

Auth Lifecycle Management adds four capabilities to the existing auth system: per-user auth method locking, admin-driven auth method migration, session binding to auth method, and invite expiry notifications. These features give admins control over how users authenticate and ensure sessions respect auth policy changes.

## Glossary

- **Auth_Service**: The backend service responsible for authentication (login, SSO, refresh, migration)
- **Admin_Handler**: The HTTP handler exposing admin-only endpoints for user management
- **Expiry_Worker**: A daily background job that checks for expiring invites and sends reminder emails
- **Auth_Method_Lock**: A per-user field restricting login to a specific auth method ("sso", "password", or null for any)
- **Session**: A refresh token record that tracks how the user authenticated (password or SSO)

## Requirements

### Requirement 1: Auth Method Lock Enforcement

**User Story:** As an admin, I want to lock a user's auth method to SSO-only or password-only, so that I can enforce organizational security policies.

#### Acceptance Criteria

1. WHEN a user with auth_method_lock="sso" attempts password login, THE Auth_Service SHALL reject the login with an error indicating SSO is required
2. WHEN a user with auth_method_lock="password" attempts SSO login as an existing user, THE Auth_Service SHALL reject the login with an error indicating password is required
3. WHILE auth_method_lock is null, THE Auth_Service SHALL allow both password and SSO login (existing behavior preserved)
4. THE Auth_Service SHALL only accept "sso", "password", or null as valid auth_method_lock values

### Requirement 2: Auth Method Migration

**User Story:** As an admin, I want to migrate a user between auth methods, so that I can transition users to SSO or back to password as organizational needs change.

#### Acceptance Criteria

1. WHEN an admin triggers MigrateToSSO for a user with a linked SSO identity, THE Auth_Service SHALL clear the password hash, set auth_method_lock to "sso", and revoke all sessions
2. IF an admin triggers MigrateToSSO for a user with no linked SSO identity, THEN THE Auth_Service SHALL reject the request with a descriptive error
3. WHEN an admin triggers MigrateToPassword with a valid password, THE Auth_Service SHALL set the password hash, set auth_method_lock to "password", and revoke all sessions
4. IF an admin triggers MigrateToPassword with a password that fails policy validation, THEN THE Auth_Service SHALL reject the request with the policy error

### Requirement 3: Session Binding to Auth Method

**User Story:** As a security engineer, I want sessions to be invalidated when they no longer match the user's auth method lock, so that policy changes take effect without waiting for session expiry.

#### Acceptance Criteria

1. WHEN a session is refreshed and the user's auth_method_lock is "sso" but the session has no SSO provider, THE Auth_Service SHALL revoke the session and return an error
2. WHEN a session is refreshed and the user's auth_method_lock is "password" but the session was created via SSO, THE Auth_Service SHALL revoke the session and return an error
3. WHILE auth_method_lock is null, THE Auth_Service SHALL allow refresh for sessions regardless of their auth method

### Requirement 4: Invite Expiry Notifications

**User Story:** As an admin who sent invites, I want to be notified when my invites are about to expire, so that I can resend them before they become invalid.

#### Acceptance Criteria

1. THE Expiry_Worker SHALL run daily and find all pending invites expiring within 24 hours
2. WHEN an expiring invite has an inviter, THE Expiry_Worker SHALL send a reminder email to the inviter
3. WHEN an expiring invite has no inviter, THE Expiry_Worker SHALL skip it without error
4. IF sending a reminder email fails, THEN THE Expiry_Worker SHALL log the error and continue processing remaining invites
