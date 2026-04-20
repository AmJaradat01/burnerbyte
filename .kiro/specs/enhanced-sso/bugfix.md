# Bugfix Requirements Document

## Introduction

The SSO tab in the Settings page (`/settings`) has several UI/UX deficiencies that prevent administrators from effectively managing SSO providers. The backend fully supports SSO provider CRUD, domain mappings, claim mappings, connection testing, and domain mapping previews — but the frontend does not adequately expose these capabilities. Key issues include: a confusing provider edit form with missing validation and cramped claim mappings, provider list cards that lack at-a-glance information density, domain mappings buried inside the edit card with no visibility from the provider list, a delete button with no confirmation dialog, and a tab header that lacks the visual treatment (gradient accent, icon badge, summary stats) used by other settings tabs.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an admin views the SSO provider edit/create form THEN the system shows the auto-provision toggle and default role selectors only conditionally (hidden until auto-provision is enabled), with no explanation of what auto-provision does before toggling it, making the UX confusing for first-time configuration.

1.2 WHEN an admin edits claim mappings in the provider form THEN the system renders all 5 fields (claim name, claim value, org role, team ID, team role) as tiny equal-width columns in a single row, making the editor cramped and hard to use on normal screen widths.

1.3 WHEN an admin types a redirect URL, client ID, or other required fields in the provider form THEN the system provides no inline validation feedback (e.g., URL format validation, required field indicators), so errors are only discovered on save.

1.4 WHEN an admin views the SSO provider list cards THEN the system only shows the provider name, type badge, enabled status, linked user count, and creation date — it does not show the redirect URL, allowed domains, auto-provision status, or domain mappings count at a glance.

1.5 WHEN an admin wants to delete an SSO provider THEN the system immediately executes the deletion without a confirmation dialog, risking accidental deletion of providers with linked users.

1.6 WHEN an admin wants to view or manage domain mappings for a provider THEN the system requires clicking "Edit" on the provider card first, because domain mappings are only accessible inside the inline edit card — there is no visual indicator on provider cards showing how many domain mappings exist.

1.7 WHEN an admin wants to test email domain mapping preview THEN the system requires opening the provider edit card and scrolling to the bottom, because the test email preview section is buried inside the edit form.

1.8 WHEN an admin views the SSO tab header area THEN the system shows a plain "SSO Providers" title and "Add Provider" button without the gradient accent card, icon badge, or descriptive subtitle treatment that other settings tabs (Platform Settings, Org Identity, etc.) use.

1.9 WHEN an admin views the SSO tab THEN the system shows no summary or overview of SSO configuration status (total providers enabled, total linked users across all providers, total domain mappings configured).

### Expected Behavior (Correct)

2.1 WHEN an admin views the SSO provider edit/create form THEN the system SHALL always show the auto-provision toggle with a clear description, and SHALL always show the default org role and default team role selectors (not conditionally hidden), with a visual hint that these roles apply when auto-provision is enabled.

2.2 WHEN an admin edits claim mappings in the provider form THEN the system SHALL render each claim mapping row in a more spacious layout (e.g., 2-row or stacked layout per mapping) with labeled fields, so that claim name, claim value, org role, team ID, and team role are all readable and editable without cramping.

2.3 WHEN an admin types in required fields (name, client ID, client secret, redirect URL) in the provider form THEN the system SHALL show inline validation indicators: required fields SHALL show a visual required marker, and the redirect URL field SHALL validate URL format and show an error message for invalid URLs.

2.4 WHEN an admin views the SSO provider list cards THEN the system SHALL display key configuration details at a glance: redirect URL (truncated), allowed domains (as badges), auto-provision status indicator, and domain mappings count badge.

2.5 WHEN an admin clicks the delete button on an SSO provider THEN the system SHALL show a confirmation dialog that displays the provider name, linked user count, and a warning about the impact before proceeding with deletion.

2.6 WHEN an admin views the SSO provider list cards THEN the system SHALL display a domain mappings count badge on each provider card, and SHALL provide a way to quickly view domain mappings without entering the full edit form.

2.7 WHEN an admin wants to test email domain mapping preview THEN the system SHALL make the test email preview accessible from the provider card or a dedicated section, not buried at the bottom of the edit form.

2.8 WHEN an admin views the SSO tab header area THEN the system SHALL display a styled header card with a gradient accent bar, an icon badge (Shield icon in a colored rounded container), the "SSO Providers" title, a descriptive subtitle, and the "Add Provider" button — consistent with the visual treatment of other settings tabs.

2.9 WHEN an admin views the SSO tab THEN the system SHALL display a summary overview showing the count of enabled providers, total linked users across all providers, and total domain mappings configured.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an admin creates a new SSO provider with valid data THEN the system SHALL CONTINUE TO successfully persist the provider via the existing `POST /admin/sso/providers` endpoint and refresh the provider list.

3.2 WHEN an admin updates an existing SSO provider THEN the system SHALL CONTINUE TO successfully persist changes via the existing `PUT /admin/sso/providers/{id}` endpoint and refresh the provider list.

3.3 WHEN an admin clicks "Test Connection" on a provider THEN the system SHALL CONTINUE TO call the `POST /admin/sso/test` endpoint and display the test result (success/failure with diagnostic details) inline on the provider card.

3.4 WHEN an admin creates, edits, or deletes domain mappings THEN the system SHALL CONTINUE TO use the existing domain mapping CRUD endpoints (`/admin/sso/providers/{id}/domain-mappings`) and refresh the mappings list.

3.5 WHEN an admin uses the test email preview THEN the system SHALL CONTINUE TO call the `POST /admin/sso/domain-mappings/preview` endpoint and display matching rules, team assignments, and bypass-invite status.

3.6 WHEN an admin selects provider-type-specific fields (Tenant ID for Azure AD, Issuer URL for Okta/OIDC) THEN the system SHALL CONTINUE TO conditionally show those fields based on the selected provider type.

3.7 WHEN no SSO providers are configured THEN the system SHALL CONTINUE TO display the empty state card with the "No SSO providers configured" message and prompt to add a provider.

3.8 WHEN an admin toggles a provider's enabled/disabled status THEN the system SHALL CONTINUE TO persist the change and visually indicate the provider's status with the colored gradient bar and badge on the provider card.
