package rbac

import (
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"pgregory.net/rapid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

// Feature: rbac-permission-overhaul, Property 2: Preservation — System Admin Bypass and Membership Checks
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
//
// These tests capture baseline behavior that MUST be preserved after the fix.
// They should all PASS on the current (unfixed) code.

// --- Generators ---

// genOrgRole draws a random valid org role from the set {owner, admin, member}.
func genOrgRole(t *rapid.T, label string) string {
	return rapid.SampledFrom([]string{OrgOwner, OrgAdmin, OrgMember}).Draw(t, label)
}

// genTeamRole draws a random valid team role from the set {lead, member, viewer}.
func genTeamRole(t *rapid.T, label string) string {
	return rapid.SampledFrom([]string{TeamLead, TeamMember, TeamViewer}).Draw(t, label)
}

// --- Sub-property 2a: System admin bypass ---
// For random (orgID, minRole) pairs, when UserContext.IsSystemAdmin=true,
// RequireOrgRole returns nil. Same for RequireTeamRole.

func TestPreservation_SystemAdminBypass_OrgRole(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		minRole := genOrgRole(t, "minRole")

		// Even with a repo that always errors, system admin should bypass.
		orgRepo := &mockOrgMembershipRepo{err: errors.New("not found")}
		teamRepo := &mockTeamMembershipRepo{err: errors.New("not found")}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID:        uuid.New(),
			IsSystemAdmin: true,
		}
		r := makeRequest(uc)

		err := checker.RequireOrgRole(r, orgID, minRole)
		if err != nil {
			t.Fatalf("system admin should bypass RequireOrgRole(minRole=%q), got: %v", minRole, err)
		}
	})
}

func TestPreservation_SystemAdminBypass_TeamRole(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		teamID := uuid.New()
		minOrgFallback := genOrgRole(t, "minOrgFallback")
		minTeamRole := genTeamRole(t, "minTeamRole")

		orgRepo := &mockOrgMembershipRepo{err: errors.New("not found")}
		teamRepo := &mockTeamMembershipRepo{err: errors.New("not found")}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID:        uuid.New(),
			IsSystemAdmin: true,
		}
		r := makeRequest(uc)

		err := checker.RequireTeamRole(r, orgID, teamID, minOrgFallback, minTeamRole)
		if err != nil {
			t.Fatalf("system admin should bypass RequireTeamRole(minOrgFallback=%q, minTeamRole=%q), got: %v",
				minOrgFallback, minTeamRole, err)
		}
	})
}

// --- Sub-property 2b: Unauthenticated denial ---
// For random org/team IDs, when request has no UserContext (nil),
// both RequireOrgRole and RequireTeamRole return ErrUnauthorized.

func TestPreservation_UnauthenticatedDenial_OrgRole(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		minRole := genOrgRole(t, "minRole")

		orgRepo := &mockOrgMembershipRepo{}
		teamRepo := &mockTeamMembershipRepo{}
		checker := NewChecker(orgRepo, teamRepo, nil)

		// No UserContext in request
		r := makeRequest(nil)

		err := checker.RequireOrgRole(r, orgID, minRole)
		if err != ErrUnauthorized {
			t.Fatalf("unauthenticated request should get ErrUnauthorized from RequireOrgRole, got: %v", err)
		}
	})
}

func TestPreservation_UnauthenticatedDenial_TeamRole(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		teamID := uuid.New()
		minOrgFallback := genOrgRole(t, "minOrgFallback")
		minTeamRole := genTeamRole(t, "minTeamRole")

		orgRepo := &mockOrgMembershipRepo{}
		teamRepo := &mockTeamMembershipRepo{}
		checker := NewChecker(orgRepo, teamRepo, nil)

		r := makeRequest(nil)

		err := checker.RequireTeamRole(r, orgID, teamID, minOrgFallback, minTeamRole)
		if err != ErrUnauthorized {
			t.Fatalf("unauthenticated request should get ErrUnauthorized from RequireTeamRole, got: %v", err)
		}
	})
}

// --- Sub-property 2c: Non-member denial ---
// When GetMembership returns error, RequireOrgRole returns ErrNotOrgMember.
// For team checks where both org fallback and team membership fail,
// RequireTeamRole returns ErrNotTeamMember.

func TestPreservation_NonMemberDenial_OrgRole(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		minRole := genOrgRole(t, "minRole")

		// Org repo returns error (user not a member)
		orgRepo := &mockOrgMembershipRepo{err: errors.New("not found")}
		teamRepo := &mockTeamMembershipRepo{}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: uuid.New(),
		}
		r := makeRequest(uc)

		err := checker.RequireOrgRole(r, orgID, minRole)
		if err != ErrNotOrgMember {
			t.Fatalf("non-member should get ErrNotOrgMember from RequireOrgRole, got: %v", err)
		}
	})
}

func TestPreservation_NonMemberDenial_TeamRole(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		teamID := uuid.New()
		minOrgFallback := genOrgRole(t, "minOrgFallback")
		minTeamRole := genTeamRole(t, "minTeamRole")

		// Both org and team repos return errors (user not a member of either)
		orgRepo := &mockOrgMembershipRepo{err: errors.New("not found")}
		teamRepo := &mockTeamMembershipRepo{err: errors.New("not found")}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: uuid.New(),
		}
		r := makeRequest(uc)

		err := checker.RequireTeamRole(r, orgID, teamID, minOrgFallback, minTeamRole)
		if err != ErrNotTeamMember {
			t.Fatalf("non-member should get ErrNotTeamMember from RequireTeamRole, got: %v", err)
		}
	})
}

// --- Sub-property 2d: Org-level fallback for teams ---
// When user is NOT a team member but IS an org admin/owner
// (rank >= minOrgFallback rank), RequireTeamRole returns nil.

func TestPreservation_OrgFallbackForTeams(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		userID := uuid.New()
		orgID := uuid.New()
		teamID := uuid.New()

		// Pick an org role and a minOrgFallback such that the user's org rank >= fallback rank.
		// We draw the user's org role, then pick a fallback role with rank <= user's rank.
		userOrgRole := genOrgRole(t, "userOrgRole")
		userRank := orgRank[userOrgRole]

		// Build list of valid fallback roles (those with rank <= userRank)
		var validFallbacks []string
		for role, rank := range orgRank {
			if rank <= userRank {
				validFallbacks = append(validFallbacks, role)
			}
		}
		// Sort for determinism in rapid
		if len(validFallbacks) == 0 {
			// Should not happen since userRank >= 1 and OrgMember has rank 1
			t.Skip("no valid fallback roles")
		}
		minOrgFallback := rapid.SampledFrom(validFallbacks).Draw(t, "minOrgFallback")

		// Any team role for minTeamRole (doesn't matter since org fallback should kick in)
		minTeamRole := genTeamRole(t, "minTeamRole")

		// Org repo: user IS an org member with the drawn role
		orgRepo := &mockOrgMembershipRepo{
			membership: &domain.OrgMembership{
				UserID: userID,
				OrgID:  orgID,
				Role:   userOrgRole,
			},
		}
		// Team repo: user is NOT a team member
		teamRepo := &mockTeamMembershipRepo{err: errors.New("not found")}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: userID,
		}
		r := makeRequest(uc)

		err := checker.RequireTeamRole(r, orgID, teamID, minOrgFallback, minTeamRole)
		if err != nil {
			t.Fatalf("org fallback should grant access: userOrgRole=%q (rank %d) >= minOrgFallback=%q (rank %d), but got: %v",
				userOrgRole, userRank, minOrgFallback, orgRank[minOrgFallback], err)
		}
	})
}

// --- Sub-property 2e: Owner full access ---
// For all minRole values {owner, admin, member}, when user has org role "owner",
// RequireOrgRole returns nil.

func TestPreservation_OwnerFullAccess(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		userID := uuid.New()
		orgID := uuid.New()
		minRole := genOrgRole(t, "minRole")

		orgRepo := &mockOrgMembershipRepo{
			membership: &domain.OrgMembership{
				UserID: userID,
				OrgID:  orgID,
				Role:   OrgOwner,
			},
		}
		teamRepo := &mockTeamMembershipRepo{}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: userID,
		}
		r := makeRequest(uc)

		err := checker.RequireOrgRole(r, orgID, minRole)
		if err != nil {
			t.Fatalf("owner should have full access for minRole=%q, but got: %v", minRole, err)
		}
	})
}

// makeRequestWithUser is a helper that creates a request with a non-admin UserContext.
// (Kept here for clarity; the main makeRequest from rbac_test.go is reused above.)
func makeRequestWithUser(userID uuid.UUID) *http.Request {
	uc := &auth.UserContext{
		UserID: userID,
	}
	return makeRequest(uc)
}
