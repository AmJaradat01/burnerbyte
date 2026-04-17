# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Audit Metadata Completeness Defects
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the 31 audit metadata defects exist
  - **Scoped PBT Approach**: For each defective event action, scope the property to concrete failing cases that reproduce the specific metadata omission or missing event
  - Create a test file `internal/handler/audit_metadata_test.go` with a mock `audit.Recorder` that captures `RecordEnhanced` calls (action, resourceID, resourceName, metadata map)
  - Test group 1 — Weak metadata on existing events (requirements 1.1–1.24):
    - Test `user.registered`: invoke Register handler, assert captured metadata contains keys `display_name` AND `ip_address` (currently only has `email`)
    - Test `user.login`: invoke Login handler with valid credentials, assert metadata contains `ip_address` AND `login_method` (currently missing)
    - Test `user.password_reset`: invoke ResetPassword handler, assert `resource_id != uuid.Nil` and metadata contains `email` (currently `uuid.Nil` and no email)
    - Test `user.password_changed`: invoke ChangePassword handler, assert metadata contains `sessions_revoked` key (currently missing)
    - Test `user.account_deleted`: invoke DeleteAccount handler, assert metadata contains `display_name` (currently missing)
    - Test `user.email_verified` (unauthenticated): invoke VerifyEmail handler without auth context, assert `resource_id != uuid.Nil` and metadata contains `email` (currently `uuid.Nil` and empty)
    - Test `session.revoked`: invoke RevokeSession handler, assert metadata contains `session_ip` AND `session_user_agent` (currently missing)
    - Test `session.revoked_all`: invoke RevokeAllSessions handler, assert metadata contains `revoked_count` (currently missing)
    - Test `member.invited`: invoke InviteMember handler, assert metadata contains `org_name` (currently missing)
    - Test `member.removed`: invoke RemoveMember handler, assert `resourceName` is the target user's email, not empty string
    - Test `invite.revoked`: invoke RevokeInvite handler, assert metadata contains `invite_email` (currently missing)
    - Test `invite.accepted`: invoke AcceptInvite handler, assert metadata contains `org_name` AND `org_id` (currently missing)
    - Test `apikey.updated`: invoke Update handler, assert metadata contains `key_name` AND `before` AND `after` diffs (currently only `key_id`)
    - Test `apikey.revoked`: invoke Revoke handler, assert metadata contains `key_name` (currently missing)
    - Test `apikey.rotated`: invoke Rotate handler, assert metadata contains `key_name` (currently only `key_id`)
    - Test `apikey.bulk_revoked`: invoke BulkRevoke handler, assert metadata contains `key_names` list (currently missing)
    - Test `domain.assigned`: invoke AssignDomain handler, assert metadata contains `team_name` (currently missing)
    - Test `admin.platform_settings_updated`: invoke UpdatePlatformSettings handler, assert metadata contains `before` AND `after` diffs (currently missing)
    - Test `admin.sso_config_updated`: invoke UpdateSSOConfig handler, assert metadata contains `before` AND `after` diffs (currently only `provider`)
    - Test `admin.role_updated`: invoke role update endpoint, assert metadata contains `before` AND `after` diffs (currently missing)
    - Test `email.all_read`: invoke MarkAllRead handler, assert metadata contains `inbox_address` (currently missing)
    - Test `email.deleted`: invoke DeleteEmail handler, assert metadata contains `from_address` (currently missing)
    - Test `inbox.deleted`: invoke DeleteInbox handler, assert metadata contains `email_count` (currently missing)
    - Test `webhook.deleted`: invoke Delete handler, assert metadata contains `webhook_url` (currently missing)
  - Test group 2 — Missing events (requirements 1.25–1.31):
    - Test `user.login_failed`: trigger failed login (wrong password), assert a `user.login_failed` event is captured (currently no event)
    - Test `user.locked`: trigger lockout (exceed max attempts), assert a `user.locked` event is captured (currently no event)
    - Test `user.forgot_password`: invoke ForgotPassword handler, assert a `user.forgot_password` event is captured (currently no event)
    - Test `apikey.disabled`/`apikey.enabled`: invoke Update handler toggling `is_active`, assert distinct `apikey.disabled` or `apikey.enabled` event is captured (currently no event)
    - Test `domain.settings_updated`: invoke UpdateDomain handler changing settings, assert a `domain.settings_updated` event is captured (currently no event)
    - Test `notification.deleted`: invoke single notification delete, assert a `notification.deleted` event is captured (currently no event)
    - Test `notification.all_deleted`: invoke delete-all notifications, assert a `notification.all_deleted` event is captured (currently no event)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bugs exist)
  - Document counterexamples found to understand root cause
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21, 1.22, 1.23, 1.24, 1.25, 1.26, 1.27, 1.28, 1.29, 1.30, 1.31_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Unchanged Audit Event Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Create a test file `internal/handler/audit_preservation_test.go` with the same mock recorder approach
  - Observe behavior on UNFIXED code for all non-defective audit events, then write property-based tests asserting observed behavior is preserved:
  - Observe: `org.created` metadata contains `name` key — write property asserting this
  - Observe: `org.updated` metadata contains `before` and `after` diffs with `name` and `logo_url` — write property asserting these keys
  - Observe: `org.deleted` metadata contains `org_id` and `name` — write property asserting these keys
  - Observe: `org.settings.updated` metadata contains `before` and `after` diffs — write property asserting these keys
  - Observe: all team events (`team.created`, `team.updated`, `team.deleted`, `team.archived`, `team.restored`, `team.member_added`, `team.member_removed`, `team.member_role_changed`, `team.member_left`, `team.members_bulk_added`, `team.members_bulk_removed`, `team.transferred`) preserve their existing metadata structure
  - Observe: `domain.created` metadata contains `domain` key — write property asserting this
  - Observe: `domain.deleted` metadata contains `domain_id`, `domain_name`, `force`, `active_inboxes_deleted` — write property asserting these keys
  - Observe: `domain.verified` metadata contains `domain`, `mx_verified`, `txt_verified` — write property asserting these keys
  - Observe: `webhook.created` metadata contains `url` — write property asserting this
  - Observe: `webhook.updated` metadata contains `before` and `after` diffs with `url`, `events`, `active` — write property asserting these keys
  - Observe: `apikey.created` metadata contains `name` — write property asserting this
  - Observe: `inbox.created` metadata contains `address` and `expires_at` — write property asserting these keys
  - Observe: `inbox.extended` metadata contains `address` and `new_expires_at` — write property asserting these keys
  - Observe: `admin.user_updated` metadata contains `before` and `after` diffs — write property asserting these keys
  - Observe: `admin.user_deleted` metadata contains `target_user_id`, `email`, `display_name` — write property asserting these keys
  - Observe: `user.sso_login` metadata contains `email` and `provider` — write property asserting these keys
  - Observe: `user.profile_updated` metadata contains `before` and `after` diffs — write property asserting these keys
  - Observe: `RecordEnhanced` auto-populates `actor_id`, `actor_display_name`, `user_agent`, `severity`, `category` — write property asserting these fields are set
  - Observe: existing `SeverityMap` entries return correct values — write property-based test generating random existing actions and asserting severity matches
  - Observe: existing `CategoryMap` entries return correct values — write property-based test generating random existing actions and asserting category matches
  - Verify all preservation tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_


- [x] 3. Fix auth service return types to expose resolved user data

  - [x] 3.1 Modify `AuthService.ResetPassword` to return user ID and email
    - Change return type from `error` to `(uuid.UUID, string, error)`
    - After resolving the user from the reset token, return `user.ID` and `user.Email` alongside the error
    - The resolved user is already fetched internally (`user, err := s.userRepo.GetByID(ctx, resetToken.UserID)`) — just return the values
    - Update the final `return` statements to include `user.ID, user.Email` on success and `uuid.Nil, ""` on error paths
    - _Bug_Condition: isBugCondition(event) where event.action = "user.password_reset" and resource_id = uuid.Nil_
    - _Expected_Behavior: ResetPassword returns (userID, userEmail, error) so handler can set resource_id and email in audit metadata_
    - _Preservation: All callers of ResetPassword must be updated to accept the new return values_
    - _Requirements: 2.3_

  - [x] 3.2 Modify `AuthService.VerifyEmail` to return user ID and email
    - Change return type from `error` to `(uuid.UUID, string, error)`
    - After resolving the user from the verification token, return `user.ID` and `user.Email`
    - The resolved user is already fetched internally (`user, err := userRepoTx.GetByID(ctx, vt.UserID)`) — just return the values
    - Update the final `return` statements to include `user.ID, user.Email` on success and `uuid.Nil, ""` on error paths
    - _Bug_Condition: isBugCondition(event) where event.action = "user.email_verified" and resource_id = uuid.Nil for unauthenticated users_
    - _Expected_Behavior: VerifyEmail returns (userID, userEmail, error) so handler can set resource_id and email in audit metadata_
    - _Preservation: All callers of VerifyEmail must be updated to accept the new return values_
    - _Requirements: 2.6_

  - [x] 3.3 Modify `AuthService.RevokeAllSessions` to return revoked count
    - Change return type from `error` to `(int, error)`
    - The underlying `sessionRepo.RevokeAll` needs to return the count of revoked sessions
    - If `RevokeAll` already returns a count, propagate it; otherwise modify the repo method to return `(int, error)` using `DELETE ... RETURNING` or `RowsAffected()`
    - _Bug_Condition: isBugCondition(event) where event.action = "session.revoked_all" and metadata missing revoked_count_
    - _Expected_Behavior: RevokeAllSessions returns (count, error) so handler can include revoked_count in audit metadata_
    - _Preservation: All callers of RevokeAllSessions must be updated to accept the new return values_
    - _Requirements: 2.8_

  - [x] 3.4 Add method or modify `AuthService.RevokeSession` to return session details before revocation
    - Before revoking, fetch the session by ID to get its `IPAddress` and `UserAgent` fields
    - Either change `RevokeSession` to return `(*domain.Session, error)` or add a `GetSession` method
    - The handler needs `session_ip` and `session_user_agent` for the audit metadata
    - _Bug_Condition: isBugCondition(event) where event.action = "session.revoked" and metadata missing session_ip, session_user_agent_
    - _Expected_Behavior: Handler can access session IP and user agent before revocation for audit metadata_
    - _Preservation: Existing RevokeSession behavior (actual revocation) must remain unchanged_
    - _Requirements: 2.7_

- [x] 4. Fix auth handler audit metadata enrichment

  - [x] 4.1 Enrich `Register` handler audit metadata
    - In `internal/handler/auth.go`, `Register` method
    - Add `"display_name": user.DisplayName` to the metadata map
    - Add `"ip_address": r.RemoteAddr` to the metadata map (use the request's remote address)
    - Current: `map[string]any{"email": user.Email}`
    - Expected: `map[string]any{"email": user.Email, "display_name": user.DisplayName, "ip_address": r.RemoteAddr}`
    - _Bug_Condition: isBugCondition(event) where event.action = "user.registered" and metadata missing display_name, ip_address_
    - _Expected_Behavior: metadata contains email, display_name, ip_address_
    - _Requirements: 2.1_

  - [x] 4.2 Enrich `Login` handler audit metadata
    - In `internal/handler/auth.go`, `Login` method
    - Add `"ip_address": r.RemoteAddr` and `"login_method": "password"` to the metadata map
    - Current: `map[string]any{"email": user.Email, "user_agent": r.Header.Get("User-Agent")}`
    - Expected: `map[string]any{"email": user.Email, "user_agent": r.Header.Get("User-Agent"), "ip_address": r.RemoteAddr, "login_method": "password"}`
    - _Bug_Condition: isBugCondition(event) where event.action = "user.login" and metadata missing ip_address, login_method_
    - _Expected_Behavior: metadata contains email, user_agent, ip_address, login_method_
    - _Requirements: 2.2_

  - [x] 4.3 Add `user.login_failed` audit event
    - In `internal/handler/auth.go`, `Login` method
    - After the `LockedError` check (before returning 423), add: `auditRecordEnhanced(r, uuid.Nil, "user.login_failed", "user", uuid.Nil, input.Email, map[string]any{"email": input.Email, "ip_address": r.RemoteAddr, "reason": "account_locked"})`
    - After the generic "invalid email or password" error return (401), add: `auditRecordEnhanced(r, uuid.Nil, "user.login_failed", "user", uuid.Nil, input.Email, map[string]any{"email": input.Email, "ip_address": r.RemoteAddr, "reason": "invalid_credentials"})`
    - _Bug_Condition: isBugCondition(event) where event.action = "user.login_failed" and event.recorded = false_
    - _Expected_Behavior: user.login_failed event recorded with email, ip_address, reason_
    - _Requirements: 2.25_

  - [x] 4.4 Add `user.locked` audit event
    - In `internal/handler/auth.go`, `Login` method
    - When `LockedError` is detected, add: `auditRecordEnhanced(r, uuid.Nil, "user.locked", "user", uuid.Nil, input.Email, map[string]any{"email": input.Email, "ip_address": r.RemoteAddr, "lockout_duration": lockedErr.RetryAfter.String()})`
    - This should fire BEFORE the `user.login_failed` event for the locked case
    - _Bug_Condition: isBugCondition(event) where event.action = "user.locked" and event.recorded = false_
    - _Expected_Behavior: user.locked event recorded with email, ip_address, lockout_duration_
    - _Requirements: 2.26_

  - [x] 4.5 Add `user.forgot_password` audit event
    - In `internal/handler/auth.go`, `ForgotPassword` method
    - After calling `h.svc.ForgotPassword`, add: `auditRecordEnhanced(r, uuid.Nil, "user.forgot_password", "user", uuid.Nil, input.Email, map[string]any{"email": input.Email})`
    - _Bug_Condition: isBugCondition(event) where event.action = "user.forgot_password" and event.recorded = false_
    - _Expected_Behavior: user.forgot_password event recorded with email_
    - _Requirements: 2.27_

  - [x] 4.6 Fix `ResetPassword` handler to use resolved user data
    - In `internal/handler/auth.go`, `ResetPassword` method
    - Update the call to `h.svc.ResetPassword` to capture the returned user ID and email: `userID, userEmail, err := h.svc.ResetPassword(r.Context(), input)`
    - Update the audit call: `auditRecordEnhanced(r, uuid.Nil, "user.password_reset", "user", userID, userEmail, map[string]any{"method": "token", "email": userEmail})`
    - _Bug_Condition: isBugCondition(event) where event.action = "user.password_reset" and resource_id = uuid.Nil_
    - _Expected_Behavior: resource_id = user.ID, metadata contains email_
    - _Requirements: 2.3_

  - [x] 4.7 Enrich `ChangePassword` handler audit metadata
    - In `internal/handler/auth.go`, `ChangePassword` method
    - Add `"sessions_revoked": true` to the metadata map
    - Current: `map[string]any{"email": uc.Email}`
    - Expected: `map[string]any{"email": uc.Email, "sessions_revoked": true}`
    - _Bug_Condition: isBugCondition(event) where event.action = "user.password_changed" and metadata missing sessions_revoked_
    - _Expected_Behavior: metadata contains email, sessions_revoked_
    - _Requirements: 2.4_

  - [x] 4.8 Enrich `DeleteAccount` handler audit metadata
    - In `internal/handler/auth.go`, `DeleteAccount` method
    - Fetch user before deletion to get display name: `user, _ := h.svc.GetMe(r.Context(), uc.UserID)`
    - Add `"display_name": user.DisplayName` to the metadata map (with nil check)
    - Current: `map[string]any{"email": uc.Email}`
    - Expected: `map[string]any{"email": uc.Email, "display_name": displayName}`
    - _Bug_Condition: isBugCondition(event) where event.action = "user.account_deleted" and metadata missing display_name_
    - _Expected_Behavior: metadata contains email, display_name_
    - _Requirements: 2.5_

  - [x] 4.9 Fix `VerifyEmail` handler to use resolved user data
    - In `internal/handler/auth.go`, `VerifyEmail` method
    - Update the call to `h.svc.VerifyEmail` to capture the returned user ID and email: `userID, userEmail, err := h.svc.VerifyEmail(r.Context(), token)`
    - Replace the existing conditional audit logic with a single call that always uses the resolved data: `auditRecordEnhanced(r, uuid.Nil, "user.email_verified", "user", userID, userEmail, map[string]any{"email": userEmail})`
    - _Bug_Condition: isBugCondition(event) where event.action = "user.email_verified" and resource_id = uuid.Nil for unauthenticated users_
    - _Expected_Behavior: resource_id = user.ID, metadata contains email regardless of auth state_
    - _Requirements: 2.6_

  - [x] 4.10 Enrich `RevokeSession` handler audit metadata
    - In `internal/handler/auth.go`, `RevokeSession` method
    - Before revoking, fetch session details using the new method from task 3.4
    - Add `"session_ip"` and `"session_user_agent"` to the metadata map from the fetched session
    - Current: `map[string]any{"session_id": sessionID.String()}`
    - Expected: `map[string]any{"session_id": sessionID.String(), "session_ip": sessionIP, "session_user_agent": sessionUA}`
    - _Bug_Condition: isBugCondition(event) where event.action = "session.revoked" and metadata missing session_ip, session_user_agent_
    - _Expected_Behavior: metadata contains session_id, session_ip, session_user_agent_
    - _Requirements: 2.7_

  - [x] 4.11 Enrich `RevokeAllSessions` handler audit metadata
    - In `internal/handler/auth.go`, `RevokeAllSessions` method
    - Update the call to `h.svc.RevokeAllSessions` to capture the returned count: `count, err := h.svc.RevokeAllSessions(r.Context(), uc.UserID)`
    - Add `"revoked_count": count` to the metadata map
    - Current: `map[string]any{"email": uc.Email}`
    - Expected: `map[string]any{"email": uc.Email, "revoked_count": count}`
    - _Bug_Condition: isBugCondition(event) where event.action = "session.revoked_all" and metadata missing revoked_count_
    - _Expected_Behavior: metadata contains email, revoked_count_
    - _Requirements: 2.8_


- [x] 5. Fix org handler audit metadata enrichment

  - [x] 5.1 Enrich `InviteMember` handler audit metadata with org_name
    - In `internal/handler/org.go`, `InviteMember` method
    - Fetch org before recording audit: `org, _ := h.svc.GetOrg(r.Context(), orgID)`
    - Add `"org_name": org.Name` to the metadata map (with nil check)
    - Current: `map[string]any{"email": input.Email, "role": input.OrgRole}`
    - Expected: `map[string]any{"email": input.Email, "role": input.OrgRole, "org_name": orgName}`
    - _Bug_Condition: isBugCondition(event) where event.action = "member.invited" and metadata missing org_name_
    - _Expected_Behavior: metadata contains email, role, org_name_
    - _Requirements: 2.9_

  - [x] 5.2 Fix `RemoveMember` handler resourceName
    - In `internal/handler/org.go`, `RemoveMember` method
    - Change the `resourceName` argument in `auditRecordEnhanced` from empty string `""` to the target user's email
    - The target user's email is already fetched via `h.svc.GetMembership` and stored in `meta["target_user_email"]`
    - Extract the email before the audit call and use it as resourceName
    - Current: `auditRecordEnhanced(r, orgID, "member.removed", "org", userID, "", meta)`
    - Expected: `auditRecordEnhanced(r, orgID, "member.removed", "org", userID, targetEmail, meta)` where targetEmail comes from the membership lookup
    - Also add `"org_name"` to metadata by fetching org
    - _Bug_Condition: isBugCondition(event) where event.action = "member.removed" and resourceName = ""_
    - _Expected_Behavior: resourceName = target user's email_
    - _Requirements: 2.10_

  - [x] 5.3 Enrich `RevokeInvite` handler audit metadata with invite_email
    - In `internal/handler/org.go`, `RevokeInvite` method
    - Fetch invite details before revocation to get the invited email address
    - This requires either a new service method to get invite by ID, or fetching from the pending invites list
    - Add `"invite_email"` to the metadata map
    - Current: `map[string]any{"invite_id": inviteID.String()}`
    - Expected: `map[string]any{"invite_id": inviteID.String(), "invite_email": inviteEmail}`
    - _Bug_Condition: isBugCondition(event) where event.action = "invite.revoked" and metadata missing invite_email_
    - _Expected_Behavior: metadata contains invite_id, invite_email_
    - _Requirements: 2.11_

  - [x] 5.4 Enrich `AcceptInvite` handler audit metadata with org info
    - In `internal/handler/org.go`, `AcceptInvite` method
    - After accepting the invite, resolve the org info (org_name, org_id) from the accepted invite
    - This may require modifying `OrgService.AcceptInvite` to return the org info, or fetching it separately
    - Add `"org_name"` and `"org_id"` to the metadata map
    - Current: `map[string]any{"email": uc.Email}`
    - Expected: `map[string]any{"email": uc.Email, "org_name": orgName, "org_id": orgID.String()}`
    - _Bug_Condition: isBugCondition(event) where event.action = "invite.accepted" and metadata missing org_name, org_id_
    - _Expected_Behavior: metadata contains email, org_name, org_id_
    - _Requirements: 2.12_

- [x] 6. Fix email handler audit metadata enrichment

  - [x] 6.1 Enrich `MarkAllRead` handler audit metadata with inbox_address
    - In `internal/handler/email.go`, `MarkAllRead` method
    - Fetch inbox details to get the full address: use `h.svc` or add an inbox lookup
    - The inbox service or a direct repo call can provide the inbox's `FullAddress`
    - Add `"inbox_address"` to the metadata map
    - Current: `map[string]any{"inbox_id": inboxID.String(), "count": count}`
    - Expected: `map[string]any{"inbox_id": inboxID.String(), "count": count, "inbox_address": inboxAddress}`
    - Note: The `EmailHandler` doesn't currently have access to the inbox service — may need to add it as a dependency or use a direct query
    - _Bug_Condition: isBugCondition(event) where event.action = "email.all_read" and metadata missing inbox_address_
    - _Expected_Behavior: metadata contains inbox_id, count, inbox_address_
    - _Requirements: 2.21_

  - [x] 6.2 Enrich `DeleteEmail` handler audit metadata with from_address
    - In `internal/handler/email.go`, `DeleteEmail` method
    - The email object is already fetched before deletion and has `FromAddress` field
    - Add `"from_address": email.FromAddress` to the metadata map
    - Current: `map[string]any{"subject": subject, "inbox_address": email.ToAddress}`
    - Expected: `map[string]any{"subject": subject, "inbox_address": email.ToAddress, "from_address": email.FromAddress}`
    - _Bug_Condition: isBugCondition(event) where event.action = "email.deleted" and metadata missing from_address_
    - _Expected_Behavior: metadata contains subject, inbox_address, from_address_
    - _Requirements: 2.22_

- [x] 7. Fix inbox handler audit metadata enrichment

  - [x] 7.1 Enrich `DeleteInbox` handler audit metadata with email_count
    - In `internal/handler/inbox.go`, `DeleteInbox` method
    - Before deletion, count the emails in the inbox using the email service or a direct repo query
    - The inbox service or email repo should have a method to count emails by inbox ID
    - Add `"email_count"` to the metadata map
    - Current: `map[string]any{"address": inbox.FullAddress}`
    - Expected: `map[string]any{"address": inbox.FullAddress, "email_count": emailCount}`
    - May need to add `emailRepo` or `emailSvc` as a dependency to `InboxHandler`, or add a count method to the inbox service
    - _Bug_Condition: isBugCondition(event) where event.action = "inbox.deleted" and metadata missing email_count_
    - _Expected_Behavior: metadata contains address, email_count_
    - _Requirements: 2.23_

- [x] 8. Fix webhook handler audit metadata enrichment

  - [x] 8.1 Enrich `Delete` handler audit metadata with webhook_url
    - In `internal/handler/webhook.go`, `Delete` method
    - Fetch webhook before deletion to get its URL: `wh, _ := h.svc.GetByID(r.Context(), teamID, id)`
    - Add `"webhook_url"` to the metadata map and use the URL as resourceName
    - Current: `map[string]any{"webhook_id": id.String()}`
    - Expected: `map[string]any{"webhook_id": id.String(), "webhook_url": webhookURL}`
    - Also update `resourceName` from `id.String()` to the webhook URL
    - _Bug_Condition: isBugCondition(event) where event.action = "webhook.deleted" and metadata missing webhook_url_
    - _Expected_Behavior: metadata contains webhook_id, webhook_url_
    - _Requirements: 2.24_

- [x] 9. Fix API key handler audit metadata enrichment

  - [x] 9.1 Enrich `Update` handler with key_name and before/after diffs
    - In `internal/handler/apikey.go`, `Update` method
    - Fetch key before update: `beforeKey, _ := h.svc.Get(r.Context(), teamID, keyID)`
    - Add `"key_name"` and before/after diffs to the metadata map
    - Current: `map[string]any{"key_id": keyID.String()}`
    - Expected: `map[string]any{"key_id": keyID.String(), "key_name": key.Name, "before": map[string]any{"name": beforeKey.Name, "scopes": beforeKey.Scopes, "is_active": beforeKey.IsActive}, "after": map[string]any{"name": key.Name, "scopes": key.Scopes, "is_active": key.IsActive}}`
    - _Bug_Condition: isBugCondition(event) where event.action = "apikey.updated" and metadata missing key_name, before, after_
    - _Expected_Behavior: metadata contains key_id, key_name, before, after diffs_
    - _Requirements: 2.13_

  - [x] 9.2 Add `apikey.disabled` / `apikey.enabled` events on is_active toggle
    - In `internal/handler/apikey.go`, `Update` method
    - After the update, compare `beforeKey.IsActive` with `key.IsActive`
    - If `is_active` changed from true to false, emit: `auditRecordEnhanced(r, orgID, "apikey.disabled", "api_key", keyID, key.Name, map[string]any{"key_id": keyID.String(), "key_name": key.Name})`
    - If `is_active` changed from false to true, emit: `auditRecordEnhanced(r, orgID, "apikey.enabled", "api_key", keyID, key.Name, map[string]any{"key_id": keyID.String(), "key_name": key.Name})`
    - _Bug_Condition: isBugCondition(event) where event.action IN ["apikey.disabled", "apikey.enabled"] and event.recorded = false_
    - _Expected_Behavior: distinct apikey.disabled or apikey.enabled event recorded with key_id, key_name_
    - _Requirements: 2.28_

  - [x] 9.3 Enrich `Revoke` handler with key_name
    - In `internal/handler/apikey.go`, `Revoke` method
    - Fetch key before revocation: `key, _ := h.svc.Get(r.Context(), teamID, id)`
    - Add `"key_name"` to the metadata map and use key name as resourceName
    - Current: `map[string]any{"key_id": id.String()}` with resourceName `id.String()`
    - Expected: `map[string]any{"key_id": id.String(), "key_name": keyName}` with resourceName `keyName`
    - _Bug_Condition: isBugCondition(event) where event.action = "apikey.revoked" and metadata missing key_name_
    - _Expected_Behavior: metadata contains key_id, key_name_
    - _Requirements: 2.14_

  - [x] 9.4 Enrich `Rotate` handler with key_name
    - In `internal/handler/apikey.go`, `Rotate` method
    - The key is already returned from `h.svc.Rotate` with `key.Name`
    - Add `"key_name": key.Name` to the metadata map
    - Current: `map[string]any{"key_id": keyID.String()}`
    - Expected: `map[string]any{"key_id": keyID.String(), "key_name": key.Name}`
    - _Bug_Condition: isBugCondition(event) where event.action = "apikey.rotated" and metadata missing key_name_
    - _Expected_Behavior: metadata contains key_id, key_name_
    - _Requirements: 2.15_

  - [x] 9.5 Enrich `BulkRevoke` handler with key_names
    - In `internal/handler/apikey.go`, `BulkRevoke` method
    - Collect key names from the bulk revoke result or fetch them before revocation
    - Add `"key_names"` list to the metadata map
    - May need to modify `BulkRevoke` service method to return key names, or fetch keys before revoking
    - Current: `map[string]any{"revoked": result.Revoked, "skipped": result.Skipped}`
    - Expected: `map[string]any{"revoked": result.Revoked, "skipped": result.Skipped, "key_names": keyNames}`
    - _Bug_Condition: isBugCondition(event) where event.action = "apikey.bulk_revoked" and metadata missing key_names_
    - _Expected_Behavior: metadata contains revoked, skipped, key_names_
    - _Requirements: 2.16_


- [x] 10. Fix domain and domain assignment handler audit metadata

  - [x] 10.1 Add `domain.settings_updated` event to `UpdateDomain` handler
    - In `internal/handler/domain.go`, `UpdateDomain` method
    - After the existing `domain.updated` audit call, check if settings changed between `beforeDomain.Settings` and `d.Settings`
    - If settings changed, emit additional event: `auditRecordEnhanced(r, orgID, "domain.settings_updated", "domain", id, domainName, map[string]any{"domain_name": domainName, "before": map[string]any{"settings": beforeDomain.Settings}, "after": map[string]any{"settings": d.Settings}})`
    - _Bug_Condition: isBugCondition(event) where event.action = "domain.settings_updated" and event.recorded = false_
    - _Expected_Behavior: domain.settings_updated event recorded with domain_name, before/after diffs_
    - _Requirements: 2.29_

  - [x] 10.2 Enrich `AssignDomain` handler with team_name
    - In `internal/handler/domain_assignment.go`, `AssignDomain` method
    - Fetch team name — the `DomainAssignmentService` or a team lookup can provide this
    - The assignment result `a` may already have team info, or fetch via team service
    - Add `"team_name"` to the metadata map
    - Current: `map[string]any{"domain_id": a.DomainID.String(), "team_id": teamID.String(), "domain_name": domainName}`
    - Expected: `map[string]any{"domain_id": a.DomainID.String(), "team_id": teamID.String(), "domain_name": domainName, "team_name": teamName}`
    - May need to add team service/repo as a dependency to `DomainAssignmentHandler` or use the assignment service to resolve team name
    - _Bug_Condition: isBugCondition(event) where event.action = "domain.assigned" and metadata missing team_name_
    - _Expected_Behavior: metadata contains domain_id, team_id, domain_name, team_name_
    - _Requirements: 2.17_

- [x] 11. Fix admin handler audit metadata enrichment

  - [x] 11.1 Enrich `UpdatePlatformSettings` handler with before/after diffs
    - In `internal/handler/admin.go`, `UpdatePlatformSettings` method
    - Fetch current platform settings BEFORE applying the update by reading from `h.cfg` under `h.cfgMu.RLock()`
    - Build a `before` map from the current config values
    - Build an `after` map from the input values
    - Add `"before"` and `"after"` to the metadata map
    - Current metadata: `map[string]any{"allow_registration": ..., "email_verification": ..., "password_min_length": ..., "lockout_max_attempts": ..., "lockout_duration_mins": ...}`
    - Expected: same fields PLUS `"before": map[string]any{...}` and `"after": map[string]any{...}`
    - _Bug_Condition: isBugCondition(event) where event.action = "admin.platform_settings_updated" and metadata missing before, after_
    - _Expected_Behavior: metadata contains before/after diffs of all platform settings_
    - _Requirements: 2.18_

  - [x] 11.2 Enrich `UpdateSSOConfig` handler with before/after diffs
    - In `internal/handler/admin.go`, `UpdateSSOConfig` method
    - Fetch current SSO config BEFORE applying the update by reading from `h.cfg.SSO` under `h.cfgMu.RLock()`
    - Build a `before` map excluding `client_secret` (security: never log secrets)
    - Build an `after` map excluding `client_secret`
    - Add `"before"` and `"after"` to the metadata map
    - Current metadata: `map[string]any{"provider": input.Provider}`
    - Expected: `map[string]any{"provider": input.Provider, "before": map[string]any{...}, "after": map[string]any{...}}`
    - _Bug_Condition: isBugCondition(event) where event.action = "admin.sso_config_updated" and metadata missing before, after_
    - _Expected_Behavior: metadata contains provider, before/after diffs (excluding client_secret)_
    - _Requirements: 2.19_

- [x] 12. Fix main.go audit metadata enrichment

  - [x] 12.1 Enrich role update endpoint with before/after diffs
    - In `cmd/api/main.go`, the `PATCH /admin/roles/{roleId}` inline handler
    - Fetch role before update: use `roleRepo.GetRole(r.Context(), roleID)` or similar to get current label, description, permissions
    - Build `before` and `after` maps
    - Add `"before"` and `"after"` to the metadata map
    - Current metadata: `map[string]any{"role_id": ..., "label": ..., "description": ..., "permissions": ...}`
    - Expected: same fields PLUS `"before": map[string]any{"label": oldLabel, "description": oldDesc, "permissions": oldPerms}` and `"after": map[string]any{"label": newLabel, "description": newDesc, "permissions": newPerms}`
    - May need to add a `GetRole` method to `roleRepo` if one doesn't exist, or fetch from `ListRoles` and filter
    - _Bug_Condition: isBugCondition(event) where event.action = "admin.role_updated" and metadata missing before, after_
    - _Expected_Behavior: metadata contains before/after diffs of role label, description, permissions_
    - _Requirements: 2.20_

  - [x] 12.2 Add `notification.deleted` audit event for single notification delete
    - In `cmd/api/main.go`, the `DELETE /notifications/{notifId}` inline handler
    - After successful deletion, add: `handler.Audit.RecordEnhanced(r, uuid.Nil, "notification.deleted", "notification", id, "", map[string]any{"notification_id": id.String()})`
    - _Bug_Condition: isBugCondition(event) where event.action = "notification.deleted" and event.recorded = false_
    - _Expected_Behavior: notification.deleted event recorded with notification_id_
    - _Requirements: 2.30_

  - [x] 12.3 Add `notification.all_deleted` audit event for bulk notification delete
    - In `cmd/api/main.go`, the `DELETE /notifications` inline handler
    - After successful deletion, add: `handler.Audit.RecordEnhanced(r, uuid.Nil, "notification.all_deleted", "notification", uuid.Nil, "", map[string]any{})`
    - _Bug_Condition: isBugCondition(event) where event.action = "notification.all_deleted" and event.recorded = false_
    - _Expected_Behavior: notification.all_deleted event recorded_
    - _Requirements: 2.31_

- [x] 13. Update audit recorder severity and category maps

  - [x] 13.1 Add new event entries to SeverityMap
    - In `internal/audit/recorder.go`, add to `SeverityMap`:
    - `"user.login_failed": "warning"` — failed login is a security warning
    - `"user.locked": "critical"` — account lockout is critical security event
    - `"user.forgot_password": "info"` — password reset request is informational
    - `"apikey.disabled": "warning"` — disabling a key is a warning-level change
    - `"apikey.enabled": "info"` — enabling a key is informational
    - `"apikey.updated": "warning"` — updating key config is warning-level
    - `"apikey.rotated": "warning"` — rotating a key is warning-level
    - `"apikey.bulk_revoked": "warning"` — bulk revocation is warning-level
    - `"domain.settings_updated": "info"` — domain settings change is informational
    - `"notification.deleted": "info"` — notification deletion is informational
    - `"notification.all_deleted": "info"` — bulk notification deletion is informational
    - _Bug_Condition: New events have no SeverityMap entry, defaulting to "info" for all_
    - _Expected_Behavior: Each new event has an explicit severity classification_
    - _Preservation: All existing SeverityMap entries must remain unchanged_
    - _Requirements: 2.25, 2.26, 2.27, 2.28, 2.29, 2.30, 2.31_

  - [x] 13.2 Add new event entries to CategoryMap
    - In `internal/audit/recorder.go`, add to `CategoryMap`:
    - `"user.login_failed": "auth"` — failed login is an auth event
    - `"user.locked": "auth"` — account lockout is an auth event
    - `"user.forgot_password": "auth"` — password reset request is an auth event
    - `"apikey.disabled": "apikey"` — key disable is an apikey event
    - `"apikey.enabled": "apikey"` — key enable is an apikey event
    - `"apikey.updated": "apikey"` — key update is an apikey event
    - `"apikey.rotated": "apikey"` — key rotation is an apikey event
    - `"apikey.bulk_revoked": "apikey"` — bulk revocation is an apikey event
    - `"domain.settings_updated": "domain"` — domain settings is a domain event
    - `"notification.deleted": "notification"` — notification deletion is a notification event
    - `"notification.all_deleted": "notification"` — bulk notification deletion is a notification event
    - _Bug_Condition: New events have no CategoryMap entry, defaulting to "" for all_
    - _Expected_Behavior: Each new event has an explicit category classification_
    - _Preservation: All existing CategoryMap entries must remain unchanged_
    - _Requirements: 2.25, 2.26, 2.27, 2.28, 2.29, 2.30, 2.31_

- [ ] 14. Verify bug condition exploration test now passes

  - [ ] 14.1 Re-run bug condition exploration tests
    - **Property 1: Expected Behavior** - Audit Metadata Completeness Fixed
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior for all 31 defective events
    - When these tests pass, it confirms the expected behavior is satisfied for all requirements
    - Run bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms all 31 bugs are fixed)
    - All 24 weak metadata events now contain all required fields
    - All 7 missing events are now recorded with correct metadata
    - All new SeverityMap and CategoryMap entries return correct values
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22, 2.23, 2.24, 2.25, 2.26, 2.27, 2.28, 2.29, 2.30, 2.31_

  - [ ] 14.2 Re-run preservation property tests
    - **Property 2: Preservation** - Unchanged Audit Event Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - All existing audit events produce identical metadata as before the fix
    - All existing SeverityMap and CategoryMap entries return unchanged values
    - RecordEnhanced auto-population of actor_id, actor_display_name, user_agent, severity, category is unchanged
    - Confirm all tests still pass after fix (no regressions)

- [x] 15. Checkpoint - Ensure all tests pass
  - Run the full test suite to ensure no compilation errors or test failures
  - Verify all bug condition tests pass (31 defects fixed)
  - Verify all preservation tests pass (no regressions)
  - Verify the project compiles cleanly with `go build ./...`
  - Ensure all tests pass, ask the user if questions arise
