# Bugfix Requirements Document

## Introduction

When a user is invited to an organization with a `team_id` and `team_role` specified, the invite is stored correctly in the database with those fields. However, when the invited user accepts the invite via `AcceptInvite`, the service only creates the org membership — it completely ignores `invite.TeamID` and `invite.TeamRole`, so the user is never added to the specified team. Additionally, the invite creation flow does not validate that the specified team belongs to the target org, does not default `team_role` to `"member"` when `team_id` is provided without a `team_role`, the invite preview does not show team information, the pending invites list does not include team names, and there is no handling for edge cases such as the team being deleted or archived between invite creation and acceptance, or the user already being a team member.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user accepts an invite that has a non-nil `team_id` and `team_role` THEN the system creates only the org membership and does not create a team membership, leaving the user outside the specified team.

1.2 WHEN an admin creates an invite with a `team_id` that belongs to a different organization THEN the system stores the invite without error, creating a cross-org team reference.

1.3 WHEN an admin creates an invite with a `team_id` but no `team_role` THEN the system stores the invite with a nil `team_role`, leaving the intended team role undefined.

1.4 WHEN a user previews an invite that has a `team_id` THEN the system returns only `org_name`, `email`, and `org_role` — the team name and team role are omitted from the preview response.

1.5 WHEN a user accepts an invite whose `team_id` references a team that has been deleted since the invite was created THEN the system silently ignores the team assignment with no error or indication to the user.

1.6 WHEN a user accepts an invite whose `team_id` references a team that has been archived since the invite was created THEN the system silently ignores the team assignment with no error or indication to the user.

1.7 WHEN a user accepts an invite with a `team_id` and the user is already a member of that team THEN the system has no handling for this case and may produce an error or duplicate.

1.8 WHEN the `AcceptInvite` handler records an audit log for an invite with team assignment THEN the system does not include team-related metadata (team_id, team_name, team_role) in the audit entry.

1.9 WHEN an admin views the pending invites list for an org THEN the system returns invites with `team_id` but does not include the team name, making it hard to identify which team the invite targets.

### Expected Behavior (Correct)

2.1 WHEN a user accepts an invite that has a non-nil `team_id` and `team_role` THEN the system SHALL create both the org membership and a team membership with the specified `team_role`, within the same transaction.

2.2 WHEN an admin creates an invite with a `team_id` THEN the system SHALL validate that the team belongs to the specified org and return an error if it does not.

2.3 WHEN an admin creates an invite with a `team_id` but no `team_role` THEN the system SHALL default the `team_role` to `"member"`.

2.4 WHEN a user previews an invite that has a `team_id` THEN the system SHALL include the `team_name` and `team_role` in the preview response.

2.5 WHEN a user accepts an invite whose `team_id` references a team that has been deleted THEN the system SHALL skip the team assignment, still complete the org membership, and log a warning.

2.6 WHEN a user accepts an invite whose `team_id` references a team that has been archived THEN the system SHALL skip the team assignment, still complete the org membership, and log a warning.

2.7 WHEN a user accepts an invite with a `team_id` and the user is already a member of that team THEN the system SHALL skip the team membership creation without error (idempotent behavior).

2.8 WHEN the `AcceptInvite` handler records an audit log for an invite with team assignment THEN the system SHALL include `team_id`, `team_name`, and `team_role` in the audit metadata.

2.9 WHEN an admin views the pending invites list for an org THEN the system SHALL include the `team_name` for each invite that has a `team_id`.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user accepts an invite that has no `team_id` (org-only invite) THEN the system SHALL CONTINUE TO create only the org membership as before.

3.2 WHEN a user accepts an invite and is already an org member THEN the system SHALL CONTINUE TO mark the invite as accepted without creating a duplicate org membership.

3.3 WHEN a user accepts an expired invite THEN the system SHALL CONTINUE TO return an "invite expired" error.

3.4 WHEN a user accepts an invite with a mismatched email THEN the system SHALL CONTINUE TO return an "email mismatch" error.

3.5 WHEN an admin creates an invite without a `team_id` THEN the system SHALL CONTINUE TO create the invite with only org-level role information.

3.6 WHEN a user previews an org-only invite (no `team_id`) THEN the system SHALL CONTINUE TO return `org_name`, `email`, and `org_role` without team fields.

3.7 WHEN an admin revokes an invite THEN the system SHALL CONTINUE TO delete the invite regardless of whether it has team assignment fields.

3.8 WHEN the invite email is sent THEN the system SHALL CONTINUE TO send the invite email with the same format and content as before.
