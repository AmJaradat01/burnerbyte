# Bugfix Requirements Document

## Introduction

The enhanced audit logging system records security and operational events across the platform, but many events contain weak or incomplete metadata that undermines their usefulness for security auditing, compliance, and incident investigation. Additionally, several security-critical events (failed logins, account lockouts, password reset requests, API key enable/disable, domain settings changes, notification deletions) are not tracked at all. This bug affects the forensic value of the audit trail and leaves blind spots in security monitoring.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user registers THEN the system records `user.registered` with only `email`, missing `display_name` and `ip_address`
1.2 WHEN a user logs in with password THEN the system records `user.login` with `email` and `user_agent` but missing `ip_address` and `login_method`
1.3 WHEN a password is reset via token THEN the system records `user.password_reset` with `resource_id` as `uuid.Nil` and no user email, because the user is not resolved from the reset token
1.4 WHEN a user changes their password THEN the system records `user.password_changed` with only `email`, missing `sessions_revoked: true` to indicate all sessions were revoked
1.5 WHEN a user deletes their account THEN the system records `user.account_deleted` with only `email`, missing `display_name`
1.6 WHEN an unauthenticated user verifies their email (public endpoint) THEN the system records `user.email_verified` with `resource_id` as `uuid.Nil` and empty metadata, producing a useless audit record
1.7 WHEN a user revokes a single session THEN the system records `session.revoked` with only `session_id`, missing session details like `session_ip` and `session_user_agent`
1.8 WHEN a user revokes all sessions THEN the system records `session.revoked_all` with only `email`, missing the count of revoked sessions
1.9 WHEN an admin invites a member to an org THEN the system records `member.invited` with `email` and `role` but missing `org_name`
1.10 WHEN an admin removes a member from an org THEN the system records `member.removed` with `resourceName` as empty string instead of the target user's email
1.11 WHEN an admin revokes an invite THEN the system records `invite.revoked` with only `invite_id`, missing `invite_email` (who was invited)
1.12 WHEN a user accepts an invite THEN the system records `invite.accepted` with only `email`, missing `org_name` and `org_id`
1.13 WHEN an admin updates an API key THEN the system records `apikey.updated` with only `key_id`, missing before/after diffs of what changed (name, scopes, is_active)
1.14 WHEN an admin revokes an API key THEN the system records `apikey.revoked` with only `key_id`, missing `key_name`
1.15 WHEN an admin rotates an API key THEN the system records `apikey.rotated` with only `key_id`, missing `key_name`
1.16 WHEN an admin bulk-revokes API keys THEN the system records `apikey.bulk_revoked` with counts but no key names
1.17 WHEN an admin assigns a domain to a team THEN the system records `domain.assigned` with `domain_name` but missing `team_name`
1.18 WHEN an admin updates platform settings THEN the system records `admin.platform_settings_updated` with no before/after diffs
1.19 WHEN an admin updates SSO config THEN the system records `admin.sso_config_updated` with only `provider`, missing before/after diffs
1.20 WHEN an admin updates a role THEN the system records `admin.role_updated` with only new values, missing before/after diffs
1.21 WHEN a user marks all emails as read THEN the system records `email.all_read` with `inbox_id` and `count` but missing `inbox_address`
1.22 WHEN a user deletes an email THEN the system records `email.deleted` with `subject` and `inbox_address` but missing `from_address`
1.23 WHEN a user deletes an inbox THEN the system records `inbox.deleted` with only `address`, missing `email_count` (how many emails were in the inbox)
1.24 WHEN a user deletes a webhook THEN the system records `webhook.deleted` with only `webhook_id`, missing `webhook_url`
1.25 WHEN a user login attempt fails THEN the system does not record any audit event for the failed login
1.26 WHEN a user account is locked due to too many failed attempts THEN the system does not record any audit event for the lockout
1.27 WHEN a user requests a password reset (forgot password) THEN the system does not record any audit event for the request
1.28 WHEN an API key is disabled or enabled via the update endpoint THEN the system does not record a distinct `apikey.disabled` or `apikey.enabled` event
1.29 WHEN domain settings are changed via the domain update endpoint THEN the system does not record a distinct `domain.settings_updated` event
1.30 WHEN a user deletes a single notification THEN the system does not record any audit event
1.31 WHEN a user deletes all notifications THEN the system does not record any audit event

### Expected Behavior (Correct)

2.1 WHEN a user registers THEN the system SHALL record `user.registered` with `email`, `display_name`, and `ip_address` in metadata
2.2 WHEN a user logs in with password THEN the system SHALL record `user.login` with `email`, `user_agent`, `ip_address`, and `login_method: "password"` in metadata
2.3 WHEN a password is reset via token THEN the system SHALL resolve the user from the reset token and record `user.password_reset` with the correct `resource_id` (user ID) and `email` in metadata
2.4 WHEN a user changes their password THEN the system SHALL record `user.password_changed` with `email` and `sessions_revoked: true` in metadata
2.5 WHEN a user deletes their account THEN the system SHALL record `user.account_deleted` with `email` and `display_name` in metadata
2.6 WHEN an unauthenticated user verifies their email THEN the system SHALL resolve the user from the verification token and record `user.email_verified` with the correct `resource_id` (user ID) and `email` in metadata
2.7 WHEN a user revokes a single session THEN the system SHALL record `session.revoked` with `session_id`, `session_ip`, and `session_user_agent` in metadata
2.8 WHEN a user revokes all sessions THEN the system SHALL record `session.revoked_all` with `email` and `revoked_count` in metadata
2.9 WHEN an admin invites a member to an org THEN the system SHALL record `member.invited` with `email`, `role`, and `org_name` in metadata
2.10 WHEN an admin removes a member from an org THEN the system SHALL record `member.removed` with `resourceName` set to the target user's email
2.11 WHEN an admin revokes an invite THEN the system SHALL record `invite.revoked` with `invite_id` and `invite_email` in metadata
2.12 WHEN a user accepts an invite THEN the system SHALL record `invite.accepted` with `email`, `org_name`, and `org_id` in metadata
2.13 WHEN an admin updates an API key THEN the system SHALL record `apikey.updated` with `key_id`, `key_name`, and before/after diffs of changed fields (name, scopes, is_active) in metadata
2.14 WHEN an admin revokes an API key THEN the system SHALL record `apikey.revoked` with `key_id` and `key_name` in metadata
2.15 WHEN an admin rotates an API key THEN the system SHALL record `apikey.rotated` with `key_id` and `key_name` in metadata
2.16 WHEN an admin bulk-revokes API keys THEN the system SHALL record `apikey.bulk_revoked` with counts and the list of key names in metadata
2.17 WHEN an admin assigns a domain to a team THEN the system SHALL record `domain.assigned` with `domain_name` and `team_name` in metadata
2.18 WHEN an admin updates platform settings THEN the system SHALL record `admin.platform_settings_updated` with before/after diffs in metadata
2.19 WHEN an admin updates SSO config THEN the system SHALL record `admin.sso_config_updated` with `provider` and before/after diffs (excluding secrets) in metadata
2.20 WHEN an admin updates a role THEN the system SHALL record `admin.role_updated` with before/after diffs (old label, description, permissions vs new) in metadata
2.21 WHEN a user marks all emails as read THEN the system SHALL record `email.all_read` with `inbox_id`, `count`, and `inbox_address` in metadata
2.22 WHEN a user deletes an email THEN the system SHALL record `email.deleted` with `subject`, `inbox_address`, and `from_address` in metadata
2.23 WHEN a user deletes an inbox THEN the system SHALL record `inbox.deleted` with `address` and `email_count` in metadata
2.24 WHEN a user deletes a webhook THEN the system SHALL record `webhook.deleted` with `webhook_id` and `webhook_url` in metadata
2.25 WHEN a user login attempt fails THEN the system SHALL record a `user.login_failed` event with `email`, `ip_address`, and `reason` in metadata
2.26 WHEN a user account is locked due to too many failed attempts THEN the system SHALL record a `user.locked` event with `email`, `ip_address`, and `lockout_duration` in metadata
2.27 WHEN a user requests a password reset (forgot password) THEN the system SHALL record a `user.forgot_password` event with `email` in metadata
2.28 WHEN an API key is disabled or enabled via the update endpoint THEN the system SHALL record a distinct `apikey.disabled` or `apikey.enabled` event with `key_id` and `key_name` in metadata
2.29 WHEN domain settings are changed via the domain update endpoint THEN the system SHALL record a `domain.settings_updated` event with `domain_name` and before/after diffs in metadata
2.30 WHEN a user deletes a single notification THEN the system SHALL record a `notification.deleted` event with `notification_id` in metadata
2.31 WHEN a user deletes all notifications THEN the system SHALL record a `notification.all_deleted` event in metadata

### Unchanged Behavior (Regression Prevention)

3.1 WHEN any audit event is recorded THEN the system SHALL CONTINUE TO populate `actor_id`, `actor_display_name`, `user_agent`, `severity`, and `category` fields via the existing `RecordEnhanced` mechanism
3.2 WHEN an org is created, updated, or deleted THEN the system SHALL CONTINUE TO record the corresponding audit events with their existing metadata (including before/after diffs for updates)
3.3 WHEN a team is created, updated, deleted, archived, restored, or has member changes THEN the system SHALL CONTINUE TO record the corresponding audit events with their existing metadata
3.4 WHEN a domain is created, deleted, or verified THEN the system SHALL CONTINUE TO record the corresponding audit events with their existing metadata
3.5 WHEN a webhook is created or updated THEN the system SHALL CONTINUE TO record the corresponding audit events with their existing before/after diff metadata
3.6 WHEN an API key is created THEN the system SHALL CONTINUE TO record `apikey.created` with `name` in metadata
3.7 WHEN an inbox is created or extended THEN the system SHALL CONTINUE TO record the corresponding audit events with their existing metadata
3.8 WHEN an admin updates a user or deletes a user THEN the system SHALL CONTINUE TO record the corresponding audit events with their existing before/after diff metadata
3.9 WHEN a user logs in via SSO THEN the system SHALL CONTINUE TO record `user.sso_login` with `email` and `provider` in metadata
3.10 WHEN a user updates their profile THEN the system SHALL CONTINUE TO record `user.profile_updated` with before/after diffs in metadata
