# Invite Team Assignment Bugfix Design

## Overview

When a user is invited to an organization with a `team_id` and `team_role`, the invite is stored correctly in the database. However, the `AcceptInvite` service method only creates the org membership — it completely ignores the `team_id` and `team_role` fields, so the user is never added to the specified team. Additionally, `InviteMember` does not validate that the team belongs to the target org, does not default `team_role` when omitted, `PreviewInvite` omits team information, `ListPendingInvites` does not include team names, and the `AcceptInvite` handler does not include team metadata in audit logs.

The fix targets three files (`internal/service/org_service.go`, `internal/handler/org.go`, and the team repo dependency) with minimal, scoped changes that add team-aware behavior to the existing invite flow without altering any org-only invite paths.

## Glossary

- **Bug_Condition (C)**: An invite has a non-nil `team_id` — the invite carries team assignment intent that is currently ignored during acceptance, unvalidated during creation, and invisible during preview/listing.
- **Property (P)**: When an invite with `team_id` is accepted, the user gains both org membership and team membership in a single transaction; when created, the team is validated against the org; when previewed or listed, team info is visible.
- **Preservation**: All org-only invite flows (no `team_id`) must remain unchanged — acceptance creates only org membership, preview returns only org fields, creation stores only org-level role info.
- **OrgService.AcceptInvite**: The method in `internal/service/org_service.go` that processes invite acceptance — currently creates org membership but skips team membership.
- **OrgService.InviteMember**: The method in `internal/service/org_service.go` that creates invites — currently does not validate team ownership or default `team_role`.
- **OrgService.PreviewInvite**: The method in `internal/service/org_service.go` that returns invite preview data — currently omits team name and team role.
- **TeamRepo**: `internal/repository/postgres/team_repo.go` — provides `GetByID`, `CreateMembership`, `GetMembership` used for team validation and membership creation.

## Bug Details

### Bug Condition

The bug manifests when an invite has a non-nil `team_id` and the system processes that invite (accept, preview, list). The `AcceptInvite` method reads the invite record including `TeamID` and `TeamRole` but never uses them to create a team membership. The `InviteMember` method accepts `team_id` without verifying it belongs to the org. The `PreviewInvite` method does not look up or return team information. The `ListPendingInvites` handler does not enrich invites with team names. The `AcceptInvite` handler does not include team metadata in audit entries.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type Invite
  OUTPUT: boolean

  RETURN input.TeamID IS NOT NULL
END FUNCTION
```

### Examples

- **Accept with team**: Invite has `team_id=<team-uuid>`, `team_role="member"`. After `AcceptInvite`, user has org membership but no team membership. Expected: user has both org and team membership.
- **Create cross-org team**: `InviteMember(orgID=A, input.TeamID=<team-in-org-B>)` succeeds. Expected: returns error "team does not belong to this organization".
- **Create without team_role**: `InviteMember(orgID=A, input.TeamID=<valid>, input.TeamRole=nil)` stores invite with nil `team_role`. Expected: `team_role` defaults to `"member"`.
- **Preview with team**: `PreviewInvite(token)` for invite with `team_id` returns `{email, org_name, org_role}`. Expected: also includes `team_name` and `team_role`.
- **Accept with deleted team**: Invite has `team_id` referencing a team that was deleted after invite creation. `AcceptInvite` silently does nothing for team. Expected: org membership created, team assignment skipped with warning log.
- **Accept when already team member**: User is already a member of the team referenced by the invite. Expected: org membership created (or idempotent), team membership creation skipped without error.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Accepting an invite with no `team_id` (org-only invite) creates only the org membership, exactly as before.
- Accepting an invite when already an org member marks the invite accepted without creating a duplicate org membership.
- Accepting an expired invite returns an "invite expired" error.
- Accepting an invite with a mismatched email returns an "email mismatch" error.
- Creating an invite without a `team_id` stores only org-level role information.
- Previewing an org-only invite returns `org_name`, `email`, and `org_role` without team fields.
- Revoking an invite deletes it regardless of whether it has team assignment fields.
- The invite email format and content remain unchanged.

**Scope:**
All inputs where `invite.TeamID IS NULL` should be completely unaffected by this fix. This includes:
- All org-only invite creation, acceptance, preview, and listing flows
- All invite revocation flows
- All invite email sending flows
- All existing error handling (expired, email mismatch, already accepted)

## Hypothesized Root Cause

Based on the code analysis, the root causes are:

1. **AcceptInvite skips team membership creation**: The `AcceptInvite` method in `org_service.go` reads `invite.TeamID` and `invite.TeamRole` from the database but never uses them. After creating the org membership and marking the invite accepted, it returns without checking if team assignment is needed. The transaction only covers org membership + invite marking.

2. **InviteMember lacks team validation**: The `InviteMember` method parses `input.TeamID` into a `uuid.UUID` but does not look up the team to verify `team.OrgID == orgID`. The `OrgService` does not have access to `TeamRepo`, so it cannot perform this validation.

3. **InviteMember does not default team_role**: When `input.TeamID` is provided but `input.TeamRole` is nil, the invite is stored with a nil `team_role`. There is no defaulting logic.

4. **PreviewInvite does not look up team**: The `PreviewInvite` method only looks up the org name. It does not check `invite.TeamID` or look up the team to include `team_name` and `team_role` in the response.

5. **ListPendingInvites returns raw invite data**: The `ListPendingInvites` service method returns invites directly from the repo without enriching them with team names. The handler passes them through as-is.

6. **AcceptInvite handler omits team audit metadata**: The `AcceptInvite` handler in `org.go` records an audit entry with `email`, `org_name`, and `org_id` but does not include `team_id`, `team_name`, or `team_role`.

## Correctness Properties

Property 1: Bug Condition - Team Membership Created on Accept

_For any_ invite where `team_id` is not nil and `team_role` is not nil and the referenced team exists, is not archived, and belongs to the invite's org, the fixed `AcceptInvite` function SHALL create a team membership for the accepting user with the specified `team_role`, in addition to the org membership, within the same database transaction.

**Validates: Requirements 2.1**

Property 2: Bug Condition - Team Ownership Validated on Create

_For any_ invite creation where `team_id` is provided, the fixed `InviteMember` function SHALL verify that the team's `org_id` matches the target `orgID` and return an error if it does not, preventing cross-org team references.

**Validates: Requirements 2.2**

Property 3: Preservation - Org-Only Invite Behavior Unchanged

_For any_ invite where `team_id` is nil (org-only invite), the fixed `AcceptInvite`, `PreviewInvite`, `InviteMember`, and `ListPendingInvites` functions SHALL produce exactly the same results as the original functions, preserving all existing org-only invite behavior including error handling for expired invites, email mismatches, and duplicate memberships.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `internal/service/org_service.go`

**1. Add `teamRepo` dependency to `OrgService`**:
- Add `teamRepo *postgres.TeamRepo` field to the `OrgService` struct.
- Update `NewOrgService` constructor to accept and store `teamRepo`.
- Update the call site in `cmd/api/main.go` to pass `teamRepo`.

**2. Fix `InviteMember` — validate team and default team_role**:
- After parsing `team_id`, look up the team via `teamRepo.GetByID`.
- Verify `team.OrgID == orgID`; return error if not.
- If `input.TeamRole` is nil but `input.TeamID` is provided, default `team_role` to `"member"`.
- Optionally validate `team_role` with `rbac.ValidTeamRole`.

**3. Fix `AcceptInvite` — create team membership in same transaction**:
- After creating org membership (or handling the already-member case), check if `invite.TeamID != nil`.
- Look up the team via `teamRepo.WithTx(tx).GetByID` to verify it still exists.
- If team is not found (deleted), log a warning and skip team assignment.
- If team is archived, log a warning and skip team assignment.
- Create team membership via `teamRepo.WithTx(tx).CreateMembership`.
- If `ErrConflict` (already a team member), skip silently (idempotent).
- All within the existing transaction so org membership + team membership are atomic.

**4. Fix `PreviewInvite` — include team info**:
- If `invite.TeamID != nil`, look up the team via `teamRepo.GetByID`.
- Add `team_name` and `team_role` to the returned map.

**5. Fix `ListPendingInvites` — enrich with team names** (handler-level or service-level):
- After fetching pending invites, collect unique `team_id` values.
- Batch-look up team names and attach `TeamName` to each invite in the response.
- This may require adding a `TeamName` field to the `Invite` domain struct or returning an enriched response type.

**File**: `internal/handler/org.go`

**6. Fix `AcceptInvite` handler — include team metadata in audit**:
- The `AcceptInvite` service method needs to return team info (team_id, team_name, team_role) alongside org info.
- Update the handler to include `team_id`, `team_name`, and `team_role` in the audit metadata map.

**7. Fix `InviteMember` handler — include team info in audit**:
- Include `team_id` and `team_role` in the invite creation audit metadata.

**File**: `cmd/api/main.go`

**8. Update `NewOrgService` call**:
- Pass `teamRepo` to `NewOrgService`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write unit tests that call `AcceptInvite` with invites containing `team_id` and `team_role`, then check whether a team membership was created. Write tests that call `InviteMember` with a `team_id` from a different org. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **AcceptInvite with team_id**: Create invite with `team_id` and `team_role="member"`, accept it, verify team membership exists (will fail on unfixed code — no team membership created).
2. **InviteMember cross-org team**: Create invite with `team_id` belonging to a different org (will succeed on unfixed code — no validation).
3. **InviteMember missing team_role**: Create invite with `team_id` but nil `team_role`, verify it defaults to `"member"` (will fail on unfixed code — stored as nil).
4. **PreviewInvite with team**: Preview invite with `team_id`, verify `team_name` in response (will fail on unfixed code — field missing).

**Expected Counterexamples**:
- `AcceptInvite` returns success but no `team_memberships` row exists for the user+team
- `InviteMember` accepts a cross-org `team_id` without error
- `PreviewInvite` response lacks `team_name` and `team_role` fields

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL invite WHERE isBugCondition(invite) DO
  result := AcceptInvite_fixed(invite.Token, userID, userEmail)
  ASSERT orgMembershipExists(userID, invite.OrgID)
  IF teamExists(invite.TeamID) AND NOT teamArchived(invite.TeamID) THEN
    ASSERT teamMembershipExists(userID, invite.TeamID, invite.TeamRole)
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL invite WHERE NOT isBugCondition(invite) DO
  ASSERT AcceptInvite_original(invite) = AcceptInvite_fixed(invite)
  ASSERT PreviewInvite_original(invite) = PreviewInvite_fixed(invite)
  ASSERT InviteMember_original(input) = InviteMember_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (various org roles, email formats, expiry states)
- It catches edge cases that manual unit tests might miss (e.g., boundary conditions on expiry times)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs (org-only invites)

**Test Plan**: Observe behavior on UNFIXED code first for org-only invites, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Org-Only Accept Preservation**: Verify accepting org-only invites creates only org membership, no team membership — same as before.
2. **Org-Only Preview Preservation**: Verify previewing org-only invites returns `{email, org_name, org_role}` without team fields — same as before.
3. **Error Handling Preservation**: Verify expired invites, email mismatches, and already-accepted invites produce the same errors.
4. **Revoke Preservation**: Verify revoking invites works regardless of team fields.

### Unit Tests

- Test `AcceptInvite` with team_id creates both org and team membership
- Test `AcceptInvite` with team_id when team is deleted — org membership created, team skipped, warning logged
- Test `AcceptInvite` with team_id when team is archived — org membership created, team skipped, warning logged
- Test `AcceptInvite` with team_id when user already a team member — no error, no duplicate
- Test `InviteMember` with cross-org team_id returns error
- Test `InviteMember` with team_id but no team_role defaults to "member"
- Test `PreviewInvite` with team_id includes team_name and team_role
- Test `ListPendingInvites` includes team_name for invites with team_id
- Test `AcceptInvite` handler audit metadata includes team fields

### Property-Based Tests

- Generate random valid invites with team_id and verify AcceptInvite creates team membership with correct role
- Generate random org-only invites (no team_id) and verify AcceptInvite behavior is identical to original (preservation)
- Generate random team_id/orgID combinations and verify InviteMember rejects cross-org teams

### Integration Tests

- Test full invite flow: create invite with team → accept → verify user appears in team member list
- Test full invite flow: create invite with team → team gets deleted → accept → verify user in org but not in team
- Test full invite flow: create invite with team → preview → verify team info visible → accept → verify memberships
