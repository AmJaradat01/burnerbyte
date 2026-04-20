# Enhanced SSO Tab UI/UX Bugfix Design

## Overview

The SSO tab in the Settings page has nine UI/UX deficiencies that prevent administrators from effectively managing SSO providers. The backend fully supports all SSO operations, but the frontend fails to expose these capabilities with adequate usability, information density, and visual consistency. This design formalizes the bug conditions, defines the expected correct behavior, hypothesizes root causes in the existing React component code, and outlines a targeted fix plan that enhances the `SSOProvidersTab` and `DomainMappingsSection` components in `web/src/app/settings/page.tsx` while preserving all existing CRUD, test connection, and domain mapping functionality.

## Glossary

- **Bug_Condition (C)**: The set of UI states where the SSO tab renders with deficient UX — missing validation, cramped layouts, hidden information, absent confirmation dialogs, or inconsistent visual treatment
- **Property (P)**: The desired rendering and interaction behavior for each deficient UI state — always-visible role selectors, spacious claim editors, inline validation, information-dense cards, confirmation dialogs, accessible domain mappings, styled headers, and summary stats
- **Preservation**: Existing SSO provider CRUD operations, test connection flow, domain mapping CRUD, domain mapping preview, provider-type-specific field rendering, empty state display, and enabled/disabled status indicators that must remain unchanged
- **SSOProvidersTab**: The React component in `web/src/app/settings/page.tsx` that renders the SSO provider list, edit/create form, and tab header
- **DomainMappingsSection**: The React component in `web/src/app/settings/page.tsx` that renders domain mapping CRUD and test email preview within the provider edit card
- **ConfirmDialog**: The reusable confirmation dialog component at `web/src/components/confirm-dialog.tsx` that wraps shadcn/ui AlertDialog

## Bug Details

### Bug Condition

The bug manifests across nine distinct UI states within the SSO tab. The `SSOProvidersTab` component renders with insufficient information density, missing validation, confusing conditional visibility, cramped layouts, no delete safety net, buried sub-features, inconsistent visual treatment, and no summary overview.

**Formal Specification:**
```
FUNCTION isBugCondition(uiState)
  INPUT: uiState of type SSOTabRenderState
  OUTPUT: boolean

  RETURN (uiState.editFormOpen AND roleSelectorsHiddenWhenAutoProvisionOff(uiState))
         OR (uiState.editFormOpen AND claimMappingsUseSingleRowLayout(uiState))
         OR (uiState.editFormOpen AND requiredFieldsLackInlineValidation(uiState))
         OR (uiState.providerListVisible AND cardsLackKeyInfo(uiState))
         OR (uiState.deleteButtonClicked AND noConfirmationDialogShown(uiState))
         OR (uiState.providerListVisible AND domainMappingsNotVisibleOnCards(uiState))
         OR (uiState.providerListVisible AND testEmailPreviewOnlyInEditForm(uiState))
         OR (uiState.tabHeaderVisible AND headerLacksVisualTreatment(uiState))
         OR (uiState.tabVisible AND noSummaryStatsDisplayed(uiState))
END FUNCTION
```

### Examples

- **Defect 1**: Admin opens the "Add Provider" form. The auto-provision toggle is visible but the default org role and default team role selectors are hidden. Admin does not understand what roles will be assigned if they enable auto-provision. Expected: role selectors always visible with a hint that they apply when auto-provision is on.
- **Defect 2**: Admin adds a claim mapping with 5 fields. All fields render in a `grid-cols-5` single row, each ~100px wide. Claim name and claim value are truncated. Expected: a stacked 2-row layout with labeled fields.
- **Defect 3**: Admin types an invalid redirect URL like `not-a-url` and clicks Save. No inline feedback — error only surfaces from the API response. Expected: real-time URL format validation and required field indicators.
- **Defect 4**: Admin views the provider list. Cards show name, type, status, linked users, and creation date. No redirect URL, allowed domains, auto-provision indicator, or domain mappings count. Expected: all key config details visible at a glance.
- **Defect 5**: Admin clicks "Delete" on a provider with 47 linked users. The provider is immediately deleted with no confirmation. Expected: a ConfirmDialog showing provider name, linked user count, and impact warning.
- **Defect 6**: Admin wants to check domain mappings for a provider. Must click "Edit" and scroll down to the DomainMappingsSection. No indication on the card of how many mappings exist. Expected: domain mappings count badge on card, with quick-view access.
- **Defect 7**: Admin wants to test an email domain mapping preview. Must open the edit form and scroll to the bottom. Expected: test email preview accessible from the provider card area or a dedicated section.
- **Defect 8**: Admin views the SSO tab. The header is a plain `<h3>` with a subtitle and "Add Provider" button. Other tabs (General, Roles) use gradient accent cards with icon badges. Expected: consistent styled header card.
- **Defect 9**: Admin views the SSO tab. No summary of total enabled providers, total linked users, or total domain mappings. Expected: summary stats displayed prominently.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Creating a new SSO provider via `POST /admin/sso/providers` must continue to work and refresh the provider list
- Updating an existing SSO provider via `PUT /admin/sso/providers/{id}` must continue to work and refresh the provider list
- Testing a provider connection via `POST /admin/sso/test` must continue to display inline test results on the provider card
- Domain mapping CRUD via `/admin/sso/providers/{id}/domain-mappings` endpoints must continue to function
- Domain mapping preview via `POST /admin/sso/domain-mappings/preview` must continue to display matching rules and team assignments
- Provider-type-specific fields (Tenant ID for Azure AD, Issuer URL for Okta/OIDC) must continue to render conditionally based on provider type
- The empty state card ("No SSO providers configured") must continue to display when no providers exist
- The enabled/disabled gradient bar and badge on provider cards must continue to reflect provider status

**Scope:**
All interactions that do NOT involve the nine deficient UI states should be completely unaffected by this fix. This includes:
- All API call payloads and response handling
- TanStack Query cache invalidation patterns
- Provider form field data binding and state management
- Toast notification messages
- Loading skeleton states

## Hypothesized Root Cause

Based on analysis of the `SSOProvidersTab` component in `web/src/app/settings/page.tsx`, the root causes are:

1. **Conditional Rendering of Role Selectors (Defect 1)**: The default org role and default team role `<Select>` components are wrapped in `{editing.auto_provision && (...)}`, making them invisible until auto-provision is toggled on. The auto-provision toggle itself has a description but the role selectors lack context about when they apply.

2. **Single-Row Claim Mapping Layout (Defect 2)**: The claim mappings editor uses `grid grid-cols-5 gap-1` for each mapping row, cramming 5 input fields plus a delete button into a single row. No field labels are rendered within the row.

3. **No Validation Logic (Defect 3)**: The edit form has no client-side validation. Required fields (name, client_id, client_secret, redirect_url) have no required markers. The redirect URL field has no URL format validation. The `handleSave` function submits directly without pre-validation.

4. **Minimal Card Content (Defect 4)**: The provider card only renders `p.name`, `p.enabled` badge, `p.provider_type` badge, `p.linked_user_count`, and `p.created_at`. Fields like `redirect_url`, `allowed_domains`, `auto_provision`, and domain mappings count are not displayed.

5. **Direct Delete Without Confirmation (Defect 5)**: The delete button calls `handleDelete(p)` directly via `onClick`, bypassing the `ConfirmDialog` component that is already used elsewhere in the codebase (e.g., in `DomainMappingsSection` for domain mapping deletion).

6. **Domain Mappings Only in Edit Form (Defect 6)**: The `DomainMappingsSection` component is rendered only inside the `{editing && (...)}` block, making it inaccessible from the provider list view. No domain mappings count is shown on provider cards.

7. **Test Email Preview Buried (Defect 7)**: The test email preview is rendered at the bottom of `DomainMappingsSection`, which itself is at the bottom of the edit form. There is no way to access it without opening the full edit card.

8. **Plain Header (Defect 8)**: The SSO tab header uses a simple `<div>` with `<h3>` and `<p>` elements, unlike other tabs that use `<Card>` with gradient accent bars (`h-2 bg-gradient-to-r`), icon badges (`h-7 w-7 rounded-md`), and `<CardTitle>`/`<CardDescription>`.

9. **No Summary Stats (Defect 9)**: The component does not compute or display aggregate statistics. The provider list data contains `linked_user_count` per provider but no totals are calculated. Domain mappings counts per provider are not fetched at the list level.

## Correctness Properties

Property 1: Bug Condition - Auto-Provision UX Always Shows Role Selectors

_For any_ SSO provider edit/create form state (whether auto-provision is enabled or disabled), the fixed component SHALL always render the default org role and default team role selectors with a visual hint indicating they apply when auto-provision is enabled, and SHALL always render the auto-provision toggle with a clear description.

**Validates: Requirements 2.1**

Property 2: Bug Condition - Claim Mappings Use Spacious Layout

_For any_ claim mapping entry in the provider edit form, the fixed component SHALL render the fields in a stacked or multi-row layout with visible labels for each field (claim name, claim value, org role, team ID, team role), rather than cramming all fields into a single narrow row.

**Validates: Requirements 2.2**

Property 3: Bug Condition - Required Fields Show Inline Validation

_For any_ required field (name, client ID, client secret, redirect URL) in the provider edit form, the fixed component SHALL display a required indicator, and for the redirect URL field, SHALL validate URL format in real-time and display an error message for invalid URLs.

**Validates: Requirements 2.3**

Property 4: Bug Condition - Provider Cards Show Key Configuration Details

_For any_ SSO provider in the provider list, the fixed component SHALL display the redirect URL (truncated), allowed domains (as badges), auto-provision status indicator, and domain mappings count badge on the provider card.

**Validates: Requirements 2.4, 2.6**

Property 5: Bug Condition - Delete Requires Confirmation Dialog

_For any_ delete action on an SSO provider, the fixed component SHALL display a ConfirmDialog showing the provider name, linked user count, and an impact warning before executing the deletion.

**Validates: Requirements 2.5**

Property 6: Bug Condition - Test Email Preview Accessible Outside Edit Form

_For any_ SSO provider in the provider list, the fixed component SHALL provide access to the test email domain mapping preview from the provider card area or a dedicated section, without requiring the admin to open the full edit form.

**Validates: Requirements 2.7**

Property 7: Bug Condition - Tab Header Has Consistent Visual Treatment

_For any_ render of the SSO tab, the fixed component SHALL display a styled header card with a gradient accent bar, an icon badge (Shield icon in a colored rounded container), the "SSO Providers" title, a descriptive subtitle, and the "Add Provider" button — consistent with the visual treatment of other settings tabs.

**Validates: Requirements 2.8**

Property 8: Bug Condition - Summary Stats Displayed

_For any_ render of the SSO tab with one or more providers, the fixed component SHALL display summary statistics showing the count of enabled providers, total linked users across all providers, and total domain mappings configured.

**Validates: Requirements 2.9**

Property 9: Preservation - CRUD and API Interactions Unchanged

_For any_ SSO provider create, update, delete, test connection, domain mapping CRUD, or domain mapping preview operation, the fixed component SHALL produce the same API calls, cache invalidation, toast notifications, and state updates as the original component, preserving all existing functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `web/src/app/settings/page.tsx`

**Component**: `SSOProvidersTab`

**Specific Changes**:

1. **Always-Visible Role Selectors (Defect 1)**: Remove the `{editing.auto_provision && (...)}` conditional wrapper around the default org role and default team role selectors. Always render them. Add a muted hint text below the selectors: "These roles are applied when auto-provision is enabled." When auto-provision is off, render the selectors with reduced opacity or a subtle disabled visual cue (but keep them interactive so the admin can pre-configure).

2. **Spacious Claim Mappings Layout (Defect 2)**: Replace the `grid grid-cols-5 gap-1` layout with a stacked card-per-mapping layout. Each mapping renders as a bordered card with two rows: Row 1 has claim name and claim value (grid-cols-2); Row 2 has org role, team ID, and team role (grid-cols-3). Each field has a visible `<Label>`. The delete button is positioned in the top-right corner of the card.

3. **Inline Validation (Defect 3)**: Add a validation state object tracking errors for required fields. Add a `validateUrl` helper that checks URL format. Render a red asterisk (`*`) next to required field labels (Name, Client ID, Client Secret, Redirect URL). Show inline error messages below the redirect URL field when the format is invalid. Disable the Save button when required fields are empty or validation fails.

4. **Information-Dense Provider Cards (Defect 4)**: Add a details section below the existing card header showing: truncated redirect URL (monospace, max 50 chars with ellipsis), allowed domains as small badges, an auto-provision indicator badge, and a domain mappings count badge. Fetch domain mappings counts by adding a `useQuery` for each provider's domain mappings or by computing from a batch fetch.

5. **Delete Confirmation Dialog (Defect 5)**: Replace the direct `onClick={() => handleDelete(p)}` on the delete button with a `<ConfirmDialog>` wrapper (already imported and used in `DomainMappingsSection`). The dialog title shows "Delete SSO provider?", the description shows the provider name, linked user count, and a warning about the impact on linked users.

6. **Domain Mappings Quick View (Defect 6)**: Add a domain mappings count badge to each provider card (from the batch fetch in change 4). Add an expandable section or a Dialog-based quick view that shows domain mappings for a provider without entering the full edit form. The `DomainMappingsSection` component can be reused in a read-only mode or within a Dialog.

7. **Test Email Preview Promotion (Defect 7)**: Extract the test email preview into a standalone section or make it accessible via a "Test Email" button on the provider card that opens a Dialog. The Dialog contains the email input, preview button, and result display — reusing the existing preview logic from `DomainMappingsSection`.

8. **Styled Tab Header (Defect 8)**: Replace the plain `<div>` header with a `<Card>` component matching the pattern used by other tabs: `<Card className="overflow-hidden">` with a `<div className="h-2 bg-gradient-to-r from-emerald-500/80 to-emerald-500/20" />` gradient bar, a `<CardHeader>` with a `<CardTitle>` containing a Shield icon in a colored rounded container, the "SSO Providers" title, a `<CardDescription>` subtitle, and the "Add Provider" button positioned in the header area.

9. **Summary Stats (Defect 9)**: Compute summary stats from the existing provider list response: count of enabled providers (`providers.filter(p => p.enabled).length`), total linked users (`providers.reduce((sum, p) => sum + (p.linked_user_count ?? 0), 0)`), and total domain mappings (from the batch domain mappings fetch or a new lightweight endpoint). Display these as a row of stat cards below the header, using the same small-card pattern seen in the System/Overview tab.

**File**: `web/src/components/confirm-dialog.tsx` (no changes needed — reuse as-is)

**File**: `internal/handler/admin.go` (optional)

**Optional Backend Change**: Add a `GET /admin/sso/stats` endpoint that returns `{ total_providers, enabled_providers, total_linked_users, total_domain_mappings }` computed via SQL aggregation. This avoids N+1 queries for domain mappings counts. However, this can also be computed client-side from the existing provider list response (which includes `linked_user_count`) plus a single batch query for domain mappings counts.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the deficient UI states on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the UI deficiencies BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write React Testing Library tests that render the `SSOProvidersTab` component with mock provider data and assert the presence/absence of UI elements. Run these tests on the UNFIXED code to observe failures and confirm the deficiencies.

**Test Cases**:
1. **Auto-Provision Role Selectors Test**: Render the edit form with `auto_provision: false` and assert that default org role and default team role selectors are present (will fail on unfixed code — they are conditionally hidden)
2. **Claim Mappings Layout Test**: Render the edit form with claim mappings and assert that field labels are present and layout is not `grid-cols-5` (will fail on unfixed code — uses cramped single-row layout)
3. **Inline Validation Test**: Render the edit form, type an invalid URL in redirect URL field, and assert that an error message appears (will fail on unfixed code — no validation exists)
4. **Provider Card Info Density Test**: Render the provider list with providers that have redirect URLs and allowed domains, and assert these are displayed on the cards (will fail on unfixed code — not rendered)
5. **Delete Confirmation Test**: Click the delete button and assert that a confirmation dialog appears (will fail on unfixed code — deletion is immediate)
6. **Domain Mappings Visibility Test**: Render the provider list and assert that domain mappings count badges are visible on cards (will fail on unfixed code — only visible in edit form)
7. **Tab Header Style Test**: Render the SSO tab and assert that the header contains a gradient accent bar and icon badge (will fail on unfixed code — plain header)
8. **Summary Stats Test**: Render the SSO tab with providers and assert that summary stat values are displayed (will fail on unfixed code — no stats rendered)

**Expected Counterexamples**:
- Role selectors not found in DOM when auto-provision is off
- No field labels in claim mapping rows
- No validation error messages rendered for invalid inputs
- Provider cards missing redirect URL, allowed domains, auto-provision badge
- No AlertDialog rendered after clicking delete
- No domain mappings count on provider cards
- No gradient bar or icon badge in tab header
- No summary statistics rendered

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed component produces the expected behavior.

**Pseudocode:**
```
FOR ALL uiState WHERE isBugCondition(uiState) DO
  result := renderSSOTab_fixed(uiState)
  ASSERT expectedBehavior(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed component produces the same result as the original component.

**Pseudocode:**
```
FOR ALL uiState WHERE NOT isBugCondition(uiState) DO
  ASSERT renderSSOTab_original(uiState).apiCalls = renderSSOTab_fixed(uiState).apiCalls
  ASSERT renderSSOTab_original(uiState).stateUpdates = renderSSOTab_fixed(uiState).stateUpdates
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of provider configurations, form states, and user interactions
- It catches edge cases in API call payloads that manual unit tests might miss
- It provides strong guarantees that CRUD behavior is unchanged across all non-buggy input combinations

**Test Plan**: Observe behavior on UNFIXED code first for all CRUD operations and interactions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Provider Create Preservation**: Observe that creating a provider with valid data calls `POST /admin/sso/providers` with the correct payload on unfixed code, then verify this continues after fix
2. **Provider Update Preservation**: Observe that updating a provider calls `PUT /admin/sso/providers/{id}` with the correct payload on unfixed code, then verify this continues after fix
3. **Test Connection Preservation**: Observe that testing a connection calls `POST /admin/sso/test` and displays results inline on unfixed code, then verify this continues after fix
4. **Domain Mapping CRUD Preservation**: Observe that domain mapping create/update/delete calls the correct endpoints on unfixed code, then verify this continues after fix
5. **Provider-Type Fields Preservation**: Observe that Azure shows Tenant ID and Okta/OIDC shows Issuer URL on unfixed code, then verify this continues after fix
6. **Empty State Preservation**: Observe that the empty state card renders when no providers exist on unfixed code, then verify this continues after fix
7. **Enabled/Disabled Status Preservation**: Observe that the gradient bar and badge reflect provider status on unfixed code, then verify this continues after fix

### Unit Tests

- Test that role selectors render regardless of auto-provision state
- Test that claim mapping fields have labels and use multi-row layout
- Test inline validation for required fields (empty name, empty client ID, invalid URL)
- Test that provider cards render redirect URL, allowed domains, auto-provision badge, domain mappings count
- Test that delete button triggers ConfirmDialog with correct provider name and linked user count
- Test that domain mappings count badge renders on provider cards
- Test that test email preview is accessible outside the edit form
- Test that tab header renders with gradient bar, icon badge, title, and subtitle
- Test that summary stats compute correctly from provider data

### Property-Based Tests

- Generate random provider configurations (varying enabled/disabled, auto-provision on/off, 0-10 claim mappings, 0-5 allowed domains) and verify all card details render correctly
- Generate random form states (valid/invalid URLs, empty/filled required fields) and verify validation messages appear correctly
- Generate random provider lists (0-20 providers with varying linked user counts) and verify summary stats compute correctly
- Generate random CRUD operations and verify API call payloads match the original component behavior

### Integration Tests

- Test full provider creation flow: fill form → validate → save → verify card appears with all details
- Test full provider deletion flow: click delete → confirm dialog → confirm → verify card removed
- Test domain mappings quick view: click domain mappings badge → view mappings → close
- Test email preview from provider card: click test email → enter email → preview → verify results
- Test tab header and summary stats update after adding/removing providers
