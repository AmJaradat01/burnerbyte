# Audit Metadata Completeness Bugfix Design

## Overview

The audit logging system records events via `auditRecordEnhanced` calls across handler files and `main.go`, but 24 of these calls pass incomplete metadata maps (missing fields like `ip_address`, `display_name`, before/after diffs, related entity names) and 7 security-critical events have no audit call at all. The fix enriches existing `map[string]any` metadata arguments and adds new `auditRecordEnhanced` calls for missing events. No schema changes, no new tables, no new function signatures — only the data passed into existing audit infrastructure changes.

## Glossary

- **Bug_Condition (C)**: An `auditRecordEnhanced` call whose metadata map is missing fields required by the spec, OR a code path that should call `auditRecordEnhanced` but does not
- **Property (P)**: Every audit event's metadata map contains all fields specified in the requirements for that event action
- **Preservation**: All existing audit events that already have correct metadata must continue to produce identical records after the fix
- **`auditRecordEnhanced`**: The convenience wrapper in `internal/handler/rbac.go` that delegates to `audit.Recorder.RecordEnhanced`
- **`RecordEnhanced`**: The method on `audit.Recorder` in `internal/audit/recorder.go` that populates `actor_id`, `actor_display_name`, `user_agent`, `severity`, `category` from the request context and severity/category maps
- **SeverityMap / CategoryMap**: Maps in `internal/audit/recorder.go` that classify event actions into severity levels and categories

## Bug Details

### Bug Condition

The bug manifests when any audit event is recorded with an incomplete metadata map, or when a security-critical action occurs without any audit event being recorded. The defect is purely in the data passed to `auditRecordEnhanced` (or the absence of the call entirely).

**Formal Specification:**
```
FUNCTION isBugCondition(event)
  INPUT: event of type AuditEvent { action: string, metadata: map[string]any, recorded: bool }
  OUTPUT: boolean

  expectedFields := REQUIRED_FIELDS_FOR_ACTION(event.action)

  // Case 1: Event is recorded but metadata is incomplete
  IF event.recorded AND NOT ALL(field IN expectedFields: field IN event.metadata)
    RETURN true

  // Case 2: Event should be recorded but is not
  IF event.action IN [
    "user.login_failed", "user.locked", "user.forgot_password",
    "apikey.disabled", "apikey.enabled", "domain.settings_updated",
    "notification.deleted", "notification.all_deleted"
  ] AND NOT event.recorded
    RETURN true

  RETURN false
END FUNCTION
```

### Examples

- **1.1 user.registered**: Currently records `{"email": "..."}`. Expected: `{"email": "...", "display_name": "...", "ip_address": "..."}`. Missing `display_name` and `ip_address`.
- **1.3 user.password_reset**: Currently records with `resource_id = uuid.Nil` and `{"method": "token"}`. Expected: `resource_id = user.ID`, `{"method": "token", "email": user.Email}`. The handler doesn't have access to the resolved user.
- **1.13 apikey.updated**: Currently records `{"key_id": "..."}`. Expected: `{"key_id": "...", "key_name": "...", "before": {...}, "after": {...}}`. Missing key name and before/after diffs.
- **1.25 user.login_failed**: No audit call exists in the Login handler's error path. Expected: a new `auditRecordEnhanced` call recording the failed attempt with email, IP, and reason.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The `RecordEnhanced` method's automatic population of `actor_id`, `actor_display_name`, `user_agent`, `severity`, and `category` must continue to work identically
- All existing audit events for orgs (create/update/delete), teams (all operations), domains (create/delete/verify), webhooks (create/update), API key creation, inbox (create/extend), admin user updates/deletes, SSO login, and profile updates must continue to produce their current metadata
- The `SeverityMap` and `CategoryMap` must retain all existing entries (new entries are additive only)
- The `AuditEntry` struct and database schema remain unchanged
- Mouse/API interactions that don't involve the 31 defective events must produce identical audit records

**Scope:**
All audit events NOT listed in requirements 2.1–2.31 should be completely unaffected by this fix. This includes:
- `org.created`, `org.updated`, `org.deleted` (already have correct metadata)
- All team events (already have correct metadata)
- `domain.created`, `domain.deleted`, `domain.verified` (already correct)
- `webhook.created`, `webhook.updated` (already have before/after diffs)
- `apikey.created` (already has `name`)
- `inbox.created`, `inbox.extended` (already correct)
- `admin.user_updated`, `admin.user_deleted` (already have before/after diffs)
- `user.sso_login`, `user.profile_updated` (already correct)

## Hypothesized Root Cause

Based on the code analysis, the root causes are straightforward omissions during initial implementation:

1. **Missing metadata fields in existing calls**: When `auditRecordEnhanced` calls were written, developers included only the most obvious fields (e.g., `email` for login) but omitted contextual fields (`ip_address`, `login_method`, `display_name`) that are valuable for forensic analysis. The data is available in scope but simply not included in the metadata map.

2. **Unresolved user context on public endpoints**: For `user.password_reset` (req 1.3) and `user.email_verified` (req 1.6), the handlers operate on public endpoints where `auth.GetUser(r.Context())` returns nil. The user is resolved internally by the service layer but the resolved user ID/email is not returned to the handler for audit purposes. The `ResetPassword` handler in `auth.go` calls `h.svc.ResetPassword()` which internally resolves the user but doesn't return it.

3. **Missing audit calls for error/security paths**: The `Login` handler only audits successful logins. Failed login attempts, account lockouts, and forgot-password requests have no audit calls because the original implementation focused on success paths only.

4. **Missing audit calls for state-change events**: API key enable/disable, domain settings updates, and notification deletions don't emit distinct audit events because the original implementation didn't consider these as separately auditable actions.

5. **Missing before/after diffs**: Several update handlers (platform settings, SSO config, role updates, API key updates) capture the new state but don't fetch the before state for comparison, or fetch it but don't include it in the metadata map.

6. **New event types not registered**: The 7 new events (`user.login_failed`, `user.locked`, `user.forgot_password`, `apikey.disabled`, `apikey.enabled`, `domain.settings_updated`, `notification.deleted`, `notification.all_deleted`) need entries in `SeverityMap` and `CategoryMap`.

## Correctness Properties

Property 1: Bug Condition - Metadata Completeness

_For any_ audit event where the bug condition holds (the event action is one of the 31 defective events listed in requirements 1.1–1.31), the fixed code SHALL produce an audit record whose metadata map contains all fields specified in the corresponding requirement 2.x, and whose `resource_id` and `resource_name` are correctly populated.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22, 2.23, 2.24, 2.25, 2.26, 2.27, 2.28, 2.29, 2.30, 2.31**

Property 2: Preservation - Unchanged Audit Events

_For any_ audit event where the bug condition does NOT hold (the event action is not one of the 31 defective events), the fixed code SHALL produce exactly the same audit record as the original code, preserving all existing metadata fields, severity, category, and resource identification.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `internal/handler/auth.go`

**Changes**:
1. **Register** (req 2.1): Add `display_name` and `ip_address` to metadata map
2. **Login** (req 2.2): Add `ip_address` and `login_method: "password"` to metadata map
3. **Login failed** (req 2.25): Add `auditRecordEnhanced` call in the error path (after `LockedError` check and after invalid password) with `email`, `ip_address`, `reason`
4. **Login locked** (req 2.26): Add `auditRecordEnhanced` call when `LockedError` is returned, with `email`, `ip_address`, `lockout_duration`
5. **ForgotPassword** (req 2.27): Add `auditRecordEnhanced` call with `email`
6. **ResetPassword** (req 2.3): Modify `AuthService.ResetPassword` to return the resolved user ID and email, then use them in the audit call
7. **ChangePassword** (req 2.4): Add `sessions_revoked: true` to metadata
8. **DeleteAccount** (req 2.5): Add `display_name` to metadata
9. **VerifyEmail** (req 2.6): Modify `AuthService.VerifyEmail` to return the resolved user ID and email, then use them in the audit call for the unauthenticated case
10. **RevokeSession** (req 2.7): Fetch session details before revocation and add `session_ip`, `session_user_agent` to metadata
11. **RevokeAllSessions** (req 2.8): Get revoked count from service and add `revoked_count` to metadata

**File**: `internal/service/auth_service.go`

**Changes**:
1. **ResetPassword**: Change return type from `error` to `(uuid.UUID, string, error)` to return the resolved user's ID and email
2. **VerifyEmail**: Change return type from `error` to `(uuid.UUID, string, error)` to return the resolved user's ID and email
3. **RevokeAllSessions**: Change return type from `error` to `(int, error)` to return the count of revoked sessions
4. **RevokeSession**: Add a method or modify to return session details (IP, user agent) before revocation

**File**: `internal/handler/org.go`

**Changes**:
1. **InviteMember** (req 2.9): Fetch org name and add `org_name` to metadata
2. **RemoveMember** (req 2.10): Set `resourceName` to target user's email (currently empty string)
3. **RevokeInvite** (req 2.11): Fetch invite details before revocation and add `invite_email` to metadata
4. **AcceptInvite** (req 2.12): Resolve org info from the accepted invite and add `org_name`, `org_id` to metadata

**File**: `internal/handler/email.go`

**Changes**:
1. **MarkAllRead** (req 2.21): Fetch inbox details and add `inbox_address` to metadata
2. **DeleteEmail** (req 2.22): Add `from_address` (from `email.FromAddress`) to metadata

**File**: `internal/handler/inbox.go`

**Changes**:
1. **DeleteInbox** (req 2.23): Count emails in inbox before deletion and add `email_count` to metadata

**File**: `internal/handler/webhook.go`

**Changes**:
1. **Delete** (req 2.24): Fetch webhook before deletion and add `webhook_url` to metadata

**File**: `internal/handler/apikey.go`

**Changes**:
1. **Update** (req 2.13): Fetch key before update, add `key_name` and before/after diffs to metadata
2. **Update** (req 2.28): When `is_active` changes, emit additional `apikey.disabled` or `apikey.enabled` event
3. **Revoke** (req 2.14): Fetch key before revocation and add `key_name` to metadata
4. **Rotate** (req 2.15): Already has `key_name` from `key.Name` — verify it's included
5. **BulkRevoke** (req 2.16): Collect key names from the result and add `key_names` to metadata

**File**: `internal/handler/domain_assignment.go`

**Changes**:
1. **AssignDomain** (req 2.17): Fetch team name and add `team_name` to metadata

**File**: `internal/handler/domain.go`

**Changes**:
1. **UpdateDomain** (req 2.29): When settings change, emit additional `domain.settings_updated` event with `domain_name` and before/after diffs

**File**: `internal/handler/admin.go`

**Changes**:
1. **UpdatePlatformSettings** (req 2.18): Fetch current settings before update and add before/after diffs to metadata
2. **UpdateSSOConfig** (req 2.19): Fetch current config before update and add before/after diffs (excluding `client_secret`) to metadata

**File**: `cmd/api/main.go`

**Changes**:
1. **Role update** (req 2.20): Fetch role before update and add before/after diffs to metadata
2. **Notification delete** (req 2.30): Add `auditRecordEnhanced` call for single notification deletion
3. **Notification delete all** (req 2.31): Add `auditRecordEnhanced` call for bulk notification deletion

**File**: `internal/audit/recorder.go`

**Changes**:
1. Add new event entries to `SeverityMap`: `user.login_failed` → warning, `user.locked` → critical, `user.forgot_password` → info, `apikey.disabled` → warning, `apikey.enabled` → info, `domain.settings_updated` → info, `notification.deleted` → info, `notification.all_deleted` → info
2. Add new event entries to `CategoryMap`: `user.login_failed` → auth, `user.locked` → auth, `user.forgot_password` → auth, `apikey.disabled` → apikey, `apikey.enabled` → apikey, `domain.settings_updated` → domain, `notification.deleted` → notification, `notification.all_deleted` → notification

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that invoke each handler endpoint with a mock `audit.Recorder` that captures the metadata map passed to `RecordEnhanced`. Assert that the captured metadata contains the required fields. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Register metadata test**: Call Register handler, capture audit metadata, assert `display_name` and `ip_address` present (will fail on unfixed code)
2. **Login metadata test**: Call Login handler, capture audit metadata, assert `ip_address` and `login_method` present (will fail on unfixed code)
3. **Password reset resource_id test**: Call ResetPassword handler, capture audit call, assert `resource_id != uuid.Nil` and `email` in metadata (will fail on unfixed code)
4. **Login failed event test**: Trigger failed login, assert `user.login_failed` event is recorded (will fail on unfixed code — no event exists)
5. **API key update diff test**: Call Update handler, capture audit metadata, assert `before` and `after` diffs present (will fail on unfixed code)
6. **Webhook delete URL test**: Call Delete handler, capture audit metadata, assert `webhook_url` present (will fail on unfixed code)
7. **Notification delete event test**: Call notification delete endpoint, assert audit event is recorded (will fail on unfixed code)

**Expected Counterexamples**:
- Metadata maps missing expected fields (e.g., `display_name` not in `user.registered` metadata)
- `resource_id` set to `uuid.Nil` when it should be the user's ID
- No audit event recorded for failed logins, lockouts, forgot-password, notification deletes
- Possible causes: fields not included in map literal, service methods not returning resolved user info, no audit call in error paths

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL event WHERE isBugCondition(event) DO
  result := invokeHandler_fixed(event.trigger)
  capturedAudit := mockRecorder.lastCall()
  expectedFields := REQUIRED_FIELDS_FOR_ACTION(event.action)
  ASSERT ALL(field IN expectedFields: field IN capturedAudit.metadata)
  ASSERT capturedAudit.resourceID != uuid.Nil (where applicable)
  ASSERT capturedAudit.recorded == true (for new events)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL event WHERE NOT isBugCondition(event) DO
  ASSERT invokeHandler_original(event.trigger).auditRecord
      == invokeHandler_fixed(event.trigger).auditRecord
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for all non-defective audit events (org CRUD, team operations, domain create/delete/verify, webhook create/update, API key create, inbox create/extend, admin user operations, SSO login, profile update), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Org event preservation**: Verify org.created, org.updated, org.deleted metadata is unchanged after fix
2. **Team event preservation**: Verify all team.* event metadata is unchanged after fix
3. **Domain create/delete preservation**: Verify domain.created, domain.deleted, domain.verified metadata is unchanged
4. **Webhook create/update preservation**: Verify webhook.created, webhook.updated metadata (including before/after diffs) is unchanged
5. **API key create preservation**: Verify apikey.created metadata is unchanged
6. **Inbox create/extend preservation**: Verify inbox.created, inbox.extended metadata is unchanged

### Unit Tests

- Test each of the 24 enriched metadata maps contains all required fields
- Test each of the 7 new audit events is emitted with correct action, resource type, and metadata
- Test that `ResetPassword` and `VerifyEmail` service methods return user ID and email
- Test that `RevokeAllSessions` returns the revoked count
- Test that new `SeverityMap` and `CategoryMap` entries return correct values
- Test edge cases: unauthenticated verify-email, login with non-existent email, bulk revoke with empty list

### Property-Based Tests

- Generate random audit event actions and verify that non-defective events produce identical metadata before and after the fix
- Generate random handler inputs for the 31 defective events and verify all required metadata fields are present
- Generate random `SeverityMap`/`CategoryMap` lookups and verify new entries don't affect existing ones

### Integration Tests

- Test full login flow (success + failure + lockout) and verify all three audit events are recorded with correct metadata
- Test full API key lifecycle (create → update → disable → enable → rotate → revoke) and verify all audit events
- Test password reset flow end-to-end and verify `resource_id` is correctly resolved
- Test notification delete endpoints and verify audit events are recorded
