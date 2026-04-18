package rbac

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"pgregory.net/rapid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

// Feature: rbac-permission-overhaul, Property 2: Preservation — System Admin Bypass and Membership Checks
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
//
// These tests capture baseline behavior that MUST be preserved after the permission-based overhaul.
// They test RequireOrgPermission and RequireTeamPermission (the new permission-based methods).

// --- Generators ---

// genPermissionKey draws a random permission key for property-based tests.
func genPermissionKey(t *rapid.T, label string) string {
	return rapid.SampledFrom([]string{
		"org.view", "org.settings.manage", "org.members.view", "org.domains.manage",
		"team.view", "team.webhooks.view", "team.inboxes.view", "team.apikeys.view",
	}).Draw(t, label)
}

// --- Sub-property 2a: System admin bypass ---
// For random (orgID, permissionKey) pairs, when UserContext.IsSystemAdmin=true,
// RequireOrgPermission returns nil. Same for RequireTeamPermission.

func TestPreservation_SystemAdminBypass_OrgPermission(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		permKey := genPermissionKey(t, "permissionKey")

		// Even with a repo that always errors and no cache, system admin should bypass.
		orgRepo := &mockOrgMembershipRepo{err: errors.New("not found")}
		teamRepo := &mockTeamMembershipRepo{err: errors.New("not found")}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID:        uuid.New(),
			IsSystemAdmin: true,
		}
		r := makeRequest(uc)

		err := checker.RequireOrgPermission(r, orgID, permKey)
		if err != nil {
			t.Fatalf("system admin should bypass RequireOrgPermission(permKey=%q), got: %v", permKey, err)
		}
	})
}

func TestPreservation_SystemAdminBypass_TeamPermission(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		teamID := uuid.New()
		permKey := genPermissionKey(t, "permissionKey")

		orgRepo := &mockOrgMembershipRepo{err: errors.New("not found")}
		teamRepo := &mockTeamMembershipRepo{err: errors.New("not found")}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID:        uuid.New(),
			IsSystemAdmin: true,
		}
		r := makeRequest(uc)

		err := checker.RequireTeamPermission(r, orgID, teamID, permKey)
		if err != nil {
			t.Fatalf("system admin should bypass RequireTeamPermission(permKey=%q), got: %v", permKey, err)
		}
	})
}

// --- Sub-property 2b: Unauthenticated denial ---
// For random org/team IDs, when request has no UserContext (nil),
// both RequireOrgPermission and RequireTeamPermission return ErrUnauthorized.

func TestPreservation_UnauthenticatedDenial_OrgPermission(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		permKey := genPermissionKey(t, "permissionKey")

		orgRepo := &mockOrgMembershipRepo{}
		teamRepo := &mockTeamMembershipRepo{}
		checker := NewChecker(orgRepo, teamRepo, nil)

		// No UserContext in request
		r := makeRequest(nil)

		err := checker.RequireOrgPermission(r, orgID, permKey)
		if err != ErrUnauthorized {
			t.Fatalf("unauthenticated request should get ErrUnauthorized from RequireOrgPermission, got: %v", err)
		}
	})
}

func TestPreservation_UnauthenticatedDenial_TeamPermission(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		teamID := uuid.New()
		permKey := genPermissionKey(t, "permissionKey")

		orgRepo := &mockOrgMembershipRepo{}
		teamRepo := &mockTeamMembershipRepo{}
		checker := NewChecker(orgRepo, teamRepo, nil)

		r := makeRequest(nil)

		err := checker.RequireTeamPermission(r, orgID, teamID, permKey)
		if err != ErrUnauthorized {
			t.Fatalf("unauthenticated request should get ErrUnauthorized from RequireTeamPermission, got: %v", err)
		}
	})
}

// --- Sub-property 2c: Non-member denial ---
// When GetMembership returns error, RequireOrgPermission returns ErrNotOrgMember.
// For team checks where both org fallback and team membership fail,
// RequireTeamPermission returns ErrNotTeamMember.

func TestPreservation_NonMemberDenial_OrgPermission(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		permKey := genPermissionKey(t, "permissionKey")

		// Org repo returns error (user not a member)
		orgRepo := &mockOrgMembershipRepo{err: errors.New("not found")}
		teamRepo := &mockTeamMembershipRepo{}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: uuid.New(),
		}
		r := makeRequest(uc)

		err := checker.RequireOrgPermission(r, orgID, permKey)
		if err != ErrNotOrgMember {
			t.Fatalf("non-member should get ErrNotOrgMember from RequireOrgPermission, got: %v", err)
		}
	})
}

func TestPreservation_NonMemberDenial_TeamPermission(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		orgID := uuid.New()
		teamID := uuid.New()
		permKey := genPermissionKey(t, "permissionKey")

		// Both org and team repos return errors (user not a member of either)
		orgRepo := &mockOrgMembershipRepo{err: errors.New("not found")}
		teamRepo := &mockTeamMembershipRepo{err: errors.New("not found")}
		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: uuid.New(),
		}
		r := makeRequest(uc)

		err := checker.RequireTeamPermission(r, orgID, teamID, permKey)
		if err != ErrNotTeamMember {
			t.Fatalf("non-member should get ErrNotTeamMember from RequireTeamPermission, got: %v", err)
		}
	})
}

// --- Sub-property 2d: Org-level fallback for teams ---
// When user is NOT a team member but IS an org admin/owner (rank >= 2),
// RequireTeamPermission returns nil (implicit access to all team operations).

func TestPreservation_OrgFallbackForTeams(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		userID := uuid.New()
		orgID := uuid.New()
		teamID := uuid.New()

		// Pick an org role with rank >= 2 (admin or owner) for fallback
		userOrgRole := rapid.SampledFrom([]string{OrgOwner, OrgAdmin}).Draw(t, "userOrgRole")
		permKey := genPermissionKey(t, "permissionKey")

		repo := &mockRolePermissionRepo{
			orgRoles: []Role{
				{Value: OrgOwner, Rank: 3, Permissions: []string{"org.view", "org.settings.manage"}},
				{Value: OrgAdmin, Rank: 2, Permissions: []string{"org.view"}},
				{Value: OrgMember, Rank: 1, Permissions: []string{"org.view"}},
			},
			teamRoles: []Role{
				{Value: TeamLead, Rank: 2, Permissions: []string{"team.view", "team.webhooks.view"}},
				{Value: TeamMember, Rank: 1, Permissions: []string{"team.view"}},
			},
		}

		cache, err := NewPermissionCache(context.Background(), repo)
		if err != nil {
			t.Fatalf("failed to create permission cache: %v", err)
		}

		// Org repo: user IS an org member with admin or owner role
		orgRepo := &mockOrgMembershipRepo{
			membership: &domain.OrgMembership{
				UserID: userID,
				OrgID:  orgID,
				Role:   userOrgRole,
			},
		}
		// Team repo: user is NOT a team member
		teamRepo := &mockTeamMembershipRepo{err: errors.New("not found")}
		checker := NewChecker(orgRepo, teamRepo, cache)

		uc := &auth.UserContext{
			UserID: userID,
		}
		r := makeRequest(uc)

		err = checker.RequireTeamPermission(r, orgID, teamID, permKey)
		if err != nil {
			t.Fatalf("org fallback should grant access: userOrgRole=%q (rank >= 2) for permKey=%q, but got: %v",
				userOrgRole, permKey, err)
		}
	})
}

// --- Sub-property 2e: Owner full access ---
// For all permission keys, when user has org role "owner" with all permissions,
// RequireOrgPermission returns nil.

func TestPreservation_OwnerFullAccess(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		userID := uuid.New()
		orgID := uuid.New()
		permKey := genPermissionKey(t, "permissionKey")

		repo := &mockRolePermissionRepo{
			orgRoles: []Role{
				{Value: OrgOwner, Rank: 3, Permissions: []string{
					"org.view", "org.settings.manage", "org.members.view", "org.domains.manage",
					"team.view", "team.webhooks.view", "team.inboxes.view", "team.apikeys.view",
				}},
				{Value: OrgAdmin, Rank: 2, Permissions: []string{"org.view"}},
				{Value: OrgMember, Rank: 1, Permissions: []string{"org.view"}},
			},
			teamRoles: []Role{},
		}

		cache, err := NewPermissionCache(context.Background(), repo)
		if err != nil {
			t.Fatalf("failed to create permission cache: %v", err)
		}

		orgRepo := &mockOrgMembershipRepo{
			membership: &domain.OrgMembership{
				UserID: userID,
				OrgID:  orgID,
				Role:   OrgOwner,
			},
		}
		teamRepo := &mockTeamMembershipRepo{}
		checker := NewChecker(orgRepo, teamRepo, cache)

		uc := &auth.UserContext{
			UserID: userID,
		}
		r := makeRequest(uc)

		err = checker.RequireOrgPermission(r, orgID, permKey)
		if err != nil {
			t.Fatalf("owner should have full access for permKey=%q, but got: %v", permKey, err)
		}
	})
}

