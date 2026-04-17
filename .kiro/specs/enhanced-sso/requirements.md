# Requirements Document

## Introduction

This document specifies the requirements for enhancing the existing SSO (Single Sign-On) implementation in BurnerByte. The current system supports basic OIDC-based SSO with a single provider, but has significant gaps: no account linking/unlinking UI, broken GitHub provider (uses OIDC against a non-OIDC endpoint), no multi-provider support, no SAML, no IdP group-to-role mapping, no SSO connection testing, no SSO-specific audit trail, and limited claim extraction. This enhancement addresses all identified gaps to deliver a production-grade, enterprise-ready SSO subsystem.

## Glossary

- **SSO_Manager**: The backend component (`internal/auth/sso.go`) responsible for OIDC/OAuth2/SAML provider initialization, redirect URL generation, callback handling, and token verification.
- **Auth_Service**: The backend service (`internal/service/auth_service.go`) responsible for user authentication, SSO login orchestration, account linking, session creation, and enforce-SSO policy enforcement.
- **Auth_Handler**: The HTTP handler (`internal/handler/auth.go`) that exposes SSO-related REST endpoints including redirect, callback, link, unlink, and status routes.
- **Admin_Handler**: The HTTP handler (`internal/handler/admin.go`) that exposes admin-only SSO configuration and testing endpoints.
- **SSO_Config**: The configuration structure (`internal/config/config.go` `SSOConfig`) that stores provider credentials, redirect URLs, provisioning settings, and claim mapping rules.
- **User_Repo**: The database repository (`internal/repository/postgres/user_repo.go`) responsible for persisting and querying user records including SSO identity fields.
- **Profile_Page**: The frontend page (`web/src/app/profile/page.tsx`) where users manage their account, view SSO status, and link/unlink SSO identities.
- **Settings_Page**: The frontend page (`web/src/app/settings/page.tsx`) where system admins configure SSO providers, test connections, and manage IdP group mappings.
- **Login_Page**: The frontend page (`web/src/app/login/page.tsx`) where users authenticate via password or SSO.
- **SSO_Identity**: A record linking a user to an external identity provider, consisting of provider name, subject identifier, and optional metadata (email, display name from IdP).
- **IdP**: Identity Provider — the external authentication service (Google, GitHub, Azure AD, Okta, or a generic OIDC/SAML provider).
- **Claim_Mapping**: A configuration that maps IdP token claims (e.g., `groups`, `roles`, `department`) to BurnerByte organization roles and team memberships.
- **SSO_Connection_Test**: A dry-run validation that verifies SSO configuration (discovery endpoint reachability, client credentials validity) without completing a full user login.
- **Audit_Recorder**: The component (`internal/audit/recorder.go`) that persists structured audit log entries for security-relevant events.

## Requirements

### Requirement 1: Fix GitHub OAuth2 Provider

**User Story:** As a system admin, I want GitHub SSO to work correctly, so that users can authenticate with their GitHub accounts.

#### Acceptance Criteria

1. WHEN the SSO_Config provider is set to "github", THE SSO_Manager SHALL use the GitHub OAuth2 authorization endpoint (`https://github.com/login/oauth/authorize`) instead of the GitHub Actions OIDC token endpoint.
2. WHEN a GitHub OAuth2 callback is received, THE SSO_Manager SHALL exchange the authorization code at `https://github.com/login/oauth/access_token` and retrieve user information from the GitHub User API (`https://api.github.com/user`).
3. WHEN the GitHub User API response does not include a public email, THE SSO_Manager SHALL fetch the user's verified primary email from the GitHub Emails API (`https://api.github.com/user/emails`).
4. WHEN a GitHub OAuth2 callback is processed successfully, THE SSO_Manager SHALL extract the user's email, display name, provider ("github"), and numeric GitHub user ID as the subject identifier.
5. IF the GitHub OAuth2 token exchange fails, THEN THE SSO_Manager SHALL return a descriptive error indicating the token exchange failure reason.
6. IF the GitHub User API returns an error, THEN THE SSO_Manager SHALL return a descriptive error indicating the user info retrieval failure.

### Requirement 2: Multi-Provider SSO Support

**User Story:** As a system admin, I want to configure multiple SSO providers simultaneously, so that users from different identity providers can all authenticate.

#### Acceptance Criteria

1. THE SSO_Config SHALL support a list of provider configurations instead of a single provider configuration.
2. WHEN multiple providers are configured, THE Auth_Handler SHALL expose separate redirect and callback endpoints for each configured provider using the existing `/auth/sso/{provider}` URL pattern.
3. WHEN the SSO status endpoint is called, THE Auth_Handler SHALL return a list of all configured providers with their labels and enabled status.
4. WHEN a user authenticates via SSO, THE Auth_Service SHALL identify the correct provider configuration based on the `{provider}` path parameter in the callback URL.
5. THE Login_Page SHALL display a separate SSO button for each configured and enabled provider.
6. THE Register_Page SHALL display a separate SSO button for each configured and enabled provider.
7. THE Settings_Page SHALL allow system admins to add, edit, and remove individual provider configurations from the multi-provider list.
8. IF a provider is removed from the configuration while users have linked identities for that provider, THEN THE Settings_Page SHALL display a warning indicating the number of affected users.

### Requirement 3: SSO Account Linking

**User Story:** As an existing password-based user, I want to link my SSO identity from my profile, so that I can sign in with either method.

#### Acceptance Criteria

1. WHEN an authenticated user initiates SSO linking from the Profile_Page, THE Auth_Handler SHALL redirect the user through the standard SSO authorization flow with a "link" intent parameter stored in the state cookie.
2. WHEN the SSO callback is received with a "link" intent, THE Auth_Service SHALL associate the SSO identity (provider, subject) with the authenticated user's account instead of creating a new session.
3. IF the SSO identity (provider, subject) is already linked to a different user account, THEN THE Auth_Service SHALL return an error indicating the SSO identity is already in use by another account.
4. IF the authenticated user already has an SSO identity linked for the same provider, THEN THE Auth_Service SHALL return an error indicating an identity for that provider is already linked.
5. WHEN SSO linking succeeds, THE Profile_Page SHALL display the linked provider name and a badge indicating the linked status.
6. WHEN SSO linking succeeds, THE Audit_Recorder SHALL record a "user.sso_linked" event with the user ID, provider name, and subject identifier.

### Requirement 4: SSO Account Unlinking

**User Story:** As a user with a linked SSO identity, I want to unlink my SSO provider from my profile, so that I can manage my authentication methods.

#### Acceptance Criteria

1. WHEN an authenticated user requests SSO unlinking, THE Auth_Handler SHALL accept a DELETE request to `/auth/me/sso/{provider}`.
2. IF the user has no password set and SSO is their only authentication method, THEN THE Auth_Service SHALL reject the unlink request with an error indicating the user must set a password first.
3. WHEN SSO unlinking succeeds, THE User_Repo SHALL set the user's sso_provider and sso_subject fields to NULL.
4. WHEN SSO unlinking succeeds, THE Profile_Page SHALL remove the SSO badge and display the option to link an SSO provider again.
5. WHEN SSO unlinking succeeds, THE Audit_Recorder SHALL record a "user.sso_unlinked" event with the user ID and former provider name.
6. WHILE the organization's enforce_sso setting is enabled, THE Auth_Service SHALL reject SSO unlink requests with an error indicating SSO is required by the organization.

### Requirement 5: SSO Connection Testing

**User Story:** As a system admin, I want to test my SSO configuration before going live, so that I can verify the setup works without affecting users.

#### Acceptance Criteria

1. WHEN a system admin triggers an SSO connection test, THE Admin_Handler SHALL accept a POST request to `/admin/sso/test` with the provider configuration payload.
2. WHEN an SSO connection test is initiated for an OIDC provider, THE SSO_Manager SHALL verify that the OIDC discovery endpoint (`/.well-known/openid-configuration`) is reachable and returns a valid configuration document.
3. WHEN an SSO connection test is initiated for a GitHub provider, THE SSO_Manager SHALL verify that the GitHub OAuth2 authorization endpoint is reachable.
4. WHEN an SSO connection test completes, THE Admin_Handler SHALL return a structured result indicating success or failure with specific diagnostic details (endpoint URL tested, HTTP status code, error message).
5. THE Settings_Page SHALL display a "Test Connection" button next to each provider configuration.
6. WHEN a connection test succeeds, THE Settings_Page SHALL display a success indicator with the verified endpoint details.
7. WHEN a connection test fails, THE Settings_Page SHALL display the failure reason and diagnostic details.
8. THE SSO connection test SHALL complete within 10 seconds, and IF the test exceeds 10 seconds, THEN THE Admin_Handler SHALL return a timeout error.

### Requirement 6: IdP Group-to-Role Mapping

**User Story:** As a system admin, I want to map identity provider groups to BurnerByte organization roles and team memberships, so that user permissions are automatically synchronized from the IdP.

#### Acceptance Criteria

1. THE SSO_Config SHALL support a list of claim mapping rules, where each rule maps an IdP claim value to a BurnerByte organization role or team membership.
2. WHEN a user authenticates via SSO, THE Auth_Service SHALL extract the configured group/role claims from the IdP token.
3. WHEN IdP group claims are present and mapping rules are configured, THE Auth_Service SHALL assign the user to the corresponding organization roles based on the mapping rules.
4. WHEN IdP group claims are present and mapping rules include team assignments, THE Auth_Service SHALL assign the user to the corresponding teams with the mapped role.
5. IF an IdP group claim does not match any configured mapping rule, THEN THE Auth_Service SHALL apply the default organization role from the SSO_Config.
6. THE Settings_Page SHALL provide a UI for system admins to create, edit, and delete claim mapping rules.
7. WHEN a claim mapping rule is created, THE Settings_Page SHALL allow the admin to specify the IdP claim name, claim value pattern, target organization role, and optional target team with role.
8. WHEN a user's IdP group claims change between SSO logins, THE Auth_Service SHALL update the user's organization roles and team memberships to reflect the current IdP claims.

### Requirement 7: Enhanced Claim Extraction

**User Story:** As a system admin, I want to extract additional claims from IdP tokens beyond email and name, so that user profiles are enriched with IdP-provided data.

#### Acceptance Criteria

1. WHEN processing an SSO callback, THE SSO_Manager SHALL extract the following standard claims when present: email, name, given_name, family_name, picture, and locale.
2. WHEN the IdP token contains a "picture" claim, THE Auth_Service SHALL set the user's avatar_url to the picture claim value if the user has no existing avatar.
3. WHEN the IdP token contains "given_name" and "family_name" claims but no "name" claim, THE SSO_Manager SHALL construct the display name by concatenating given_name and family_name.
4. THE SSO_Config SHALL support a custom claims list that specifies additional claim names to extract from the IdP token.
5. WHEN custom claims are configured, THE SSO_Manager SHALL extract the specified claims and include them in the callback result for downstream processing.

### Requirement 8: SSO Login Audit Trail

**User Story:** As a system admin, I want detailed audit logs for all SSO-related events, so that I can monitor SSO usage and troubleshoot authentication issues.

#### Acceptance Criteria

1. WHEN a user authenticates via SSO, THE Audit_Recorder SHALL record a "user.sso_login" event with the user ID, provider name, subject identifier, IP address, and user agent.
2. WHEN SSO authentication fails, THE Audit_Recorder SHALL record a "user.sso_login_failed" event with the provider name, failure reason, IP address, and email address when available.
3. WHEN a user links an SSO identity, THE Audit_Recorder SHALL record a "user.sso_linked" event with the user ID, provider name, and subject identifier.
4. WHEN a user unlinks an SSO identity, THE Audit_Recorder SHALL record a "user.sso_unlinked" event with the user ID and former provider name.
5. WHEN an admin updates SSO configuration, THE Audit_Recorder SHALL record an "admin.sso_config_updated" event with the changed fields (excluding secrets).
6. WHEN an admin runs an SSO connection test, THE Audit_Recorder SHALL record an "admin.sso_test" event with the provider name and test result.
7. WHEN a user is denied password login due to enforce_sso policy, THE Audit_Recorder SHALL record a "user.sso_enforced" event with the user's email and IP address.

### Requirement 9: SSO Session Binding

**User Story:** As a system admin, I want application sessions to be aware of the SSO provider session, so that session metadata reflects the authentication method used.

#### Acceptance Criteria

1. WHEN a session is created via SSO login, THE Auth_Service SHALL store the SSO provider name as metadata on the session record.
2. WHEN listing sessions, THE Auth_Handler SHALL include the SSO provider name in the session response for SSO-authenticated sessions.
3. THE Profile_Page SHALL display the authentication method (password or SSO provider name) for each active session in the sessions list.
4. WHEN a session was created via SSO, THE Profile_Page SHALL display the provider icon or label next to the session entry.

### Requirement 10: Database Schema for Multi-Provider SSO

**User Story:** As a developer, I want the database schema to support multiple SSO identities per user, so that users can link identities from different providers.

#### Acceptance Criteria

1. THE database migration SHALL create a new `user_sso_identities` table with columns: id (UUID, primary key), user_id (UUID, foreign key to users), provider (VARCHAR(50)), subject (VARCHAR(255)), email (VARCHAR(255)), display_name (VARCHAR(255)), metadata (JSONB), linked_at (TIMESTAMPTZ), last_used_at (TIMESTAMPTZ).
2. THE `user_sso_identities` table SHALL have a UNIQUE constraint on (provider, subject) to prevent duplicate identity links.
3. THE `user_sso_identities` table SHALL have an index on user_id for efficient lookup of a user's linked identities.
4. THE database migration SHALL migrate existing SSO data from the users table (sso_provider, sso_subject) into the new `user_sso_identities` table for all users with non-null sso_provider.
5. THE database migration SHALL retain the sso_provider and sso_subject columns on the users table for backward compatibility, marking them as deprecated.
6. THE User_Repo SHALL query the `user_sso_identities` table for SSO lookups instead of the users table sso_provider/sso_subject columns.

### Requirement 11: SSO Configuration Persistence

**User Story:** As a system admin, I want SSO provider configurations stored in the database, so that multi-provider configurations survive restarts and can be managed via the admin UI.

#### Acceptance Criteria

1. THE database migration SHALL create an `sso_providers` table with columns: id (UUID, primary key), name (VARCHAR(50), unique), provider_type (VARCHAR(20)), client_id (VARCHAR(255)), client_secret_encrypted (TEXT), redirect_url (TEXT), issuer_url (TEXT), tenant_id (VARCHAR(255)), auto_provision (BOOLEAN), default_org_role (VARCHAR(50)), default_team_role (VARCHAR(50)), allowed_domains (TEXT), claim_mappings (JSONB), enabled (BOOLEAN), created_at (TIMESTAMPTZ), updated_at (TIMESTAMPTZ).
2. WHEN the application starts, THE SSO_Manager SHALL load provider configurations from the `sso_providers` table and merge them with any file-based configuration.
3. WHEN an admin saves a provider configuration via the Settings_Page, THE Admin_Handler SHALL persist the configuration to the `sso_providers` table with the client_secret encrypted using the configured encryption key.
4. WHEN an admin retrieves provider configurations, THE Admin_Handler SHALL return the configurations with client_secret masked as "••••••••".
5. IF both file-based and database provider configurations exist for the same provider name, THEN THE SSO_Manager SHALL use the database configuration as the authoritative source.

### Requirement 12: Enforce SSO Policy Enhancement

**User Story:** As a system admin, I want granular control over SSO enforcement, so that I can require SSO for all users or allow mixed authentication.

#### Acceptance Criteria

1. WHILE the organization's enforce_sso setting is enabled, THE Auth_Service SHALL reject password-based login attempts for users who have a linked SSO identity with an error message directing the user to sign in via SSO.
2. WHILE the organization's enforce_sso setting is enabled, THE Auth_Service SHALL allow password-based login for users who do not have any linked SSO identity.
3. WHILE the organization's enforce_sso setting is enabled, THE Login_Page SHALL display a notice informing users that SSO is required by the organization.
4. WHEN enforce_sso is enabled and a user attempts password login, THE Audit_Recorder SHALL record the enforcement event before rejecting the request.
5. WHILE the organization's enforce_sso setting is enabled, THE Auth_Handler SHALL reject password registration attempts with an error directing users to authenticate via SSO.

### Requirement 13: Frontend SSO Profile Management

**User Story:** As a user, I want to see and manage my SSO connections from my profile page, so that I have full visibility into my authentication methods.

#### Acceptance Criteria

1. THE Profile_Page SHALL display a "Connected Accounts" section showing all linked SSO identities with provider name, linked email, and linked date.
2. WHEN no SSO identities are linked, THE Profile_Page SHALL display a prompt to connect an SSO provider with available provider options.
3. THE Profile_Page SHALL display a "Link Account" button for each configured but unlinked SSO provider.
4. THE Profile_Page SHALL display an "Unlink" button for each linked SSO identity, disabled when unlinking is not allowed (no password set or enforce_sso enabled).
5. WHEN the user clicks "Link Account", THE Profile_Page SHALL redirect the user through the SSO authorization flow with the link intent.
6. WHEN the user clicks "Unlink" and confirms, THE Profile_Page SHALL call the unlink endpoint and refresh the connected accounts list.
7. THE Profile_Page SHALL hide the password change section for users whose only authentication method is SSO (no password hash set).

### Requirement 14: Admin SSO Dashboard

**User Story:** As a system admin, I want a comprehensive SSO management interface, so that I can configure, monitor, and troubleshoot SSO from one place.

#### Acceptance Criteria

1. THE Settings_Page SHALL display an "SSO Providers" section with a card for each configured provider showing its status (enabled/disabled), provider type, and number of linked users.
2. THE Settings_Page SHALL provide an "Add Provider" button that opens a form for configuring a new SSO provider.
3. WHEN adding or editing a provider, THE Settings_Page SHALL display provider-specific fields: Tenant ID for Azure AD, Issuer URL for Okta and generic OIDC, and no extra fields for Google and GitHub.
4. THE Settings_Page SHALL display the claim mapping configuration UI within each provider's card, allowing admins to define group-to-role mappings.
5. THE Settings_Page SHALL display a "Test Connection" button for each provider that triggers the SSO connection test endpoint.
6. WHEN a provider is disabled, THE Settings_Page SHALL visually indicate the disabled state and hide the provider from login pages.
