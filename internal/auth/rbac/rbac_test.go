package rbac

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"pgregory.net/rapid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

// Feature: rbac-permission-overhaul, Property 1: Bug Condition — Rank-Based RBAC Ignores DB Permissions
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.8**
//
// These tests demonstrate that the current rank-based RBAC checker ignores DB permissions.
// They are EXPECTED TO FAIL on unfixed code — failure confirms the bug exists.

// --- Mock implementations ---

// mockOrgMembershipRepo returns a configurable OrgMembership for any (userID, orgID) lookup.
type mockOrgMembershipRepo struct {
	membership *domain.OrgMembership
	err        error
}

func (m *mockOrgMembershipRepo) GetMembership(_ context.Context, _, _ uuid.UUID) (*domain.OrgMembership, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.membership, nil
}

// mockTeamMembershipRepo returns a configurable TeamMembership for any (userID, teamID) lookup.
type mockTeamMembershipRepo struct {
	membership *domain.TeamMembership
	err        error
}

func (m *mockTeamMembershipRepo) GetMembership(_ context.Context, _, _ uuid.UUID) (*domain.TeamMembership, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.membership, nil
}

// makeRequest creates an *http.Request with the given UserContext set in context.
func makeRequest(uc *auth.UserContext) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if uc != nil {
		ctx := context.WithValue(r.Context(), auth.UserContextKey, uc)
		r = r.WithContext(ctx)
	}
	return r
}

// --- Test Case 1: Custom role denied ---
// A user with org role "auditor" (not in orgRank map) is always denied because
// orgRank["auditor"] returns 0 (Go zero-value for missing map key).
// This confirms custom roles are unrecognized by the rank-based checker.
// EXPECTED: This test FAILS on unfixed code because RequireOrgRole returns
// ErrInsufficientOrg for custom roles — the bug is that custom roles should be
// supported via DB permissions, but the rank-based checker always denies them.

func TestBugCondition_CustomRoleDenied(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a random permission key (irrelevant to rank-based checker, but
		// demonstrates that the checker never looks at permissions)
		_ = rapid.StringMatching(`[a-z]+\.[a-z]+\.[a-z]+`).Draw(t, "permissionKey")

		userID := uuid.New()
		orgID := uuid.New()

		// Mock: user has org role "auditor" — a custom role not in orgRank map
		orgRepo := &mockOrgMembershipRepo{
			membership: &domain.OrgMembership{
				UserID: userID,
				OrgID:  orgID,
				Role:   "auditor",
			},
		}
		teamRepo := &mockTeamMembershipRepo{}

		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: userID,
		}
		r := makeRequest(uc)

		// RequireOrgRole with minRole="member" (rank 1).
		// orgRank["auditor"] returns 0 (missing key), so 0 < 1 → ErrInsufficientOrg.
		// The bug: a custom role with proper DB permissions should be allowed,
		// but the rank-based checker always denies it.
		err := checker.RequireOrgRole(r, orgID, OrgMember)

		// We ASSERT that the custom role is NOT denied — i.e., err should be nil.
		// On unfixed code, err == ErrInsufficientOrg, so this assertion FAILS,
		// confirming the bug exists.
		if err != nil {
			t.Fatalf("custom role 'auditor' should not be denied for member-level access, but got: %v", err)
		}
	})
}

// --- Test Case 2: Viewer blocked from reads ---
// A user with team role "viewer" is blocked from all team endpoints requiring
// TeamMember minimum because teamRank["viewer"] (0) < teamRank["member"] (1).
// EXPECTED: This test FAILS on unfixed code because viewers should have read access.

func TestBugCondition_ViewerBlockedFromReads(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		userID := uuid.New()
		orgID := uuid.New()
		teamID := uuid.New()

		// Mock: user is NOT an org admin (so org fallback won't save them)
		orgRepo := &mockOrgMembershipRepo{
			membership: &domain.OrgMembership{
				UserID: userID,
				OrgID:  orgID,
				Role:   OrgMember, // rank 1, below "member" fallback threshold
			},
		}

		// Mock: user has team role "viewer"
		teamRepo := &mockTeamMembershipRepo{
			membership: &domain.TeamMembership{
				UserID: userID,
				TeamID: teamID,
				Role:   TeamViewer,
			},
		}

		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: userID,
		}
		r := makeRequest(uc)

		// RequireTeamRole with minOrgFallback="member" and minTeamRole="member".
		// Org fallback: orgRank["member"](1) >= orgRank["member"](1) → passes org fallback.
		// BUT we want to test the team-level check specifically.
		// Use minOrgFallback="admin" so org fallback fails for a "member" org role.
		err := checker.RequireTeamRole(r, orgID, teamID, OrgAdmin, TeamMember)

		// We ASSERT that viewer is NOT blocked from read access — err should be nil.
		// On unfixed code, teamRank["viewer"](0) < teamRank["member"](1) → ErrInsufficientTeam.
		// This assertion FAILS, confirming the bug.
		if err != nil {
			t.Fatalf("viewer should have read access to team resources, but got: %v", err)
		}
	})
}

// --- Test Case 3: Peer role change allowed ---
// Two users both with "admin" org role. The current RequireOrgRole only checks
// the actor's rank, not the target's. There is no self-protection check.
// EXPECTED: This test FAILS on unfixed code because peer modifications should be denied.

func TestBugCondition_PeerRoleChangeAllowed(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		actorID := uuid.New()
		_ = uuid.New() // targetID — would be used in a self-protection check
		orgID := uuid.New()

		// Both actor and target are org admins (rank 2)
		orgRepo := &mockOrgMembershipRepo{
			membership: &domain.OrgMembership{
				UserID: actorID,
				OrgID:  orgID,
				Role:   OrgAdmin,
			},
		}
		teamRepo := &mockTeamMembershipRepo{}

		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: actorID,
		}
		r := makeRequest(uc)

		// RequireOrgRole with minRole="admin" — the actor is admin (rank 2 >= 2), so this passes.
		// But there's NO check that the actor's rank > target's rank.
		err := checker.RequireOrgRole(r, orgID, OrgAdmin)

		// The rank check passes (admin can do admin-level things).
		// The bug is that there's no ADDITIONAL self-protection check.
		// We verify the absence of self-protection by asserting that the system
		// SHOULD deny this when actor rank <= target rank, but it doesn't.
		if err != nil {
			// If RequireOrgRole itself fails, that's a different issue
			t.Fatalf("unexpected error from RequireOrgRole: %v", err)
		}

		// Now verify there's no self-protection: the checker has no method to
		// compare actor rank vs target rank. We assert that such a check SHOULD
		// exist but doesn't — the test fails because we expect a denial.
		// On unfixed code, there is no RequireRankAbove method, so we simulate
		// what SHOULD happen: admin (rank 2) trying to modify another admin (rank 2)
		// should be denied because actorRank <= targetRank.
		actorRank := orgRank[OrgAdmin]  // 2
		targetRank := orgRank[OrgAdmin] // 2

		if actorRank <= targetRank {
			// This condition is true (2 <= 2), confirming the bug:
			// the system allows this operation because there's no self-protection check.
			// We FAIL the test to document that peer modification is allowed.
			t.Fatalf("peer role change should be denied: actor rank (%d) <= target rank (%d), "+
				"but no self-protection check exists in the current code", actorRank, targetRank)
		}
	})
}

// --- Test Case 4: Permission edit has no effect ---
// RequireOrgRole and RequireTeamRole never check permission keys from the DB —
// they only compare hardcoded rank integers. This confirms that admin UI
// permission edits have zero effect on enforcement.
// EXPECTED: This test FAILS on unfixed code.

func TestBugCondition_PermissionEditHasNoEffect(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate random permission keys that an admin might edit in the UI
		permKey := rapid.StringMatching(`org\.[a-z]+\.[a-z]+`).Draw(t, "permissionKey")

		userID := uuid.New()
		orgID := uuid.New()

		// Mock: user has "admin" role
		orgRepo := &mockOrgMembershipRepo{
			membership: &domain.OrgMembership{
				UserID: userID,
				OrgID:  orgID,
				Role:   OrgAdmin,
			},
		}
		teamRepo := &mockTeamMembershipRepo{}

		checker := NewChecker(orgRepo, teamRepo, nil)

		uc := &auth.UserContext{
			UserID: userID,
		}
		r := makeRequest(uc)

		// The checker only has RequireOrgRole — there is no RequireOrgPermission
		// method that would check the actual permission key from the DB.
		// We verify that the checker struct has no way to check permission keys.

		// Call RequireOrgRole — it passes based on rank alone, ignoring permissions.
		err := checker.RequireOrgRole(r, orgID, OrgAdmin)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		// The bug: even though we generated a permission key (%s), the checker
		// never looks at it. There is no method on Checker that accepts a
		// permission key string. The admin UI permission edits are saved to DB
		// but never consulted during enforcement.
		//
		// We FAIL the test to document that permission keys are ignored.
		t.Fatalf("permission key %q is never checked by the rank-based RBAC checker — "+
			"RequireOrgRole and RequireTeamRole only compare hardcoded rank integers, "+
			"confirming that admin UI permission edits have zero effect on enforcement", permKey)
	})
}

// ── Fix Verification Tests ──
// These tests verify that the NEW permission-based methods work correctly
// after the fix has been implemented. They use RequireOrgPermission,
// RequireTeamPermission, and RequireRankAbove instead of the old rank-based methods.
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.8**

// --- Mock RolePermissionRepo ---

// mockRolePermissionRepo returns configurable roles for each scope.
type mockRolePermissionRepo struct {
	orgRoles  []Role
	teamRoles []Role
}

func (m *mockRolePermissionRepo) ListRoles(_ context.Context, scope string) ([]Role, error) {
	switch scope {
	case "org":
		return m.orgRoles, nil
	case "team":
		return m.teamRoles, nil
	}
	return nil, errors.New("unknown scope")
}

// mockOrgMembershipRepoByUser returns different memberships based on userID.
type mockOrgMembershipRepoByUser struct {
	memberships map[uuid.UUID]*domain.OrgMembership
	defaultErr  error
}

func (m *mockOrgMembershipRepoByUser) GetMembership(_ context.Context, userID, _ uuid.UUID) (*domain.OrgMembership, error) {
	if mem, ok := m.memberships[userID]; ok {
		return mem, nil
	}
	if m.defaultErr != nil {
		return nil, m.defaultErr
	}
	return nil, errors.New("not found")
}

// --- Test Case: Custom role with permission granted via RequireOrgPermission ---

func TestFixVerification_CustomRoleWithPermission(t *testing.T) {
	userID := uuid.New()
	orgID := uuid.New()

	// Create a mock RolePermissionRepo with a custom "auditor" role that has org.audit.view
	repo := &mockRolePermissionRepo{
		orgRoles: []Role{
			{Value: "owner", Rank: 3, Permissions: []string{"org.view", "org.audit.view", "org.delete"}},
			{Value: "admin", Rank: 2, Permissions: []string{"org.view", "org.audit.view"}},
			{Value: "member", Rank: 1, Permissions: []string{"org.view"}},
			{Value: "auditor", Rank: 0, Permissions: []string{"org.audit.view"}},
		},
		teamRoles: []Role{},
	}

	cache, err := NewPermissionCache(context.Background(), repo)
	if err != nil {
		t.Fatalf("failed to create permission cache: %v", err)
	}

	// Mock: user has org role "auditor"
	orgRepo := &mockOrgMembershipRepo{
		membership: &domain.OrgMembership{
			UserID: userID,
			OrgID:  orgID,
			Role:   "auditor",
		},
	}
	teamRepo := &mockTeamMembershipRepo{}

	checker := NewChecker(orgRepo, teamRepo, cache)

	uc := &auth.UserContext{UserID: userID}
	r := makeRequest(uc)

	// RequireOrgPermission should grant access because "auditor" has "org.audit.view"
	err = checker.RequireOrgPermission(r, orgID, "org.audit.view")
	if err != nil {
		t.Fatalf("custom role 'auditor' with org.audit.view permission should be granted access, but got: %v", err)
	}
}

// --- Test Case: Viewer can read team resources via RequireTeamPermission ---

func TestFixVerification_ViewerCanReadTeamResources(t *testing.T) {
	userID := uuid.New()
	orgID := uuid.New()
	teamID := uuid.New()

	repo := &mockRolePermissionRepo{
		orgRoles: []Role{
			{Value: "member", Rank: 1, Permissions: []string{"org.view"}},
		},
		teamRoles: []Role{
			{Value: "lead", Rank: 2, Permissions: []string{"team.webhooks.view", "team.webhooks.manage"}},
			{Value: "member", Rank: 1, Permissions: []string{"team.webhooks.view"}},
			{Value: "viewer", Rank: 0, Permissions: []string{"team.webhooks.view", "team.view", "team.inboxes.view"}},
		},
	}

	cache, err := NewPermissionCache(context.Background(), repo)
	if err != nil {
		t.Fatalf("failed to create permission cache: %v", err)
	}

	// Org membership: regular member (rank 1, below admin threshold for fallback)
	orgRepo := &mockOrgMembershipRepo{
		membership: &domain.OrgMembership{
			UserID: userID,
			OrgID:  orgID,
			Role:   "member",
		},
	}

	// Team membership: viewer role
	teamRepo := &mockTeamMembershipRepo{
		membership: &domain.TeamMembership{
			UserID: userID,
			TeamID: teamID,
			Role:   "viewer",
		},
	}

	checker := NewChecker(orgRepo, teamRepo, cache)

	uc := &auth.UserContext{UserID: userID}
	r := makeRequest(uc)

	// RequireTeamPermission should grant access because "viewer" has "team.webhooks.view"
	err = checker.RequireTeamPermission(r, orgID, teamID, "team.webhooks.view")
	if err != nil {
		t.Fatalf("viewer with team.webhooks.view permission should be granted access, but got: %v", err)
	}
}

// --- Test Case: Self-protection denies peer modification ---

func TestFixVerification_SelfProtectionDenies(t *testing.T) {
	actorID := uuid.New()
	targetID := uuid.New()
	orgID := uuid.New()

	repo := &mockRolePermissionRepo{
		orgRoles: []Role{
			{Value: "owner", Rank: 3, Permissions: []string{"org.members.role"}},
			{Value: "admin", Rank: 2, Permissions: []string{"org.members.role"}},
			{Value: "member", Rank: 1, Permissions: []string{"org.view"}},
		},
		teamRoles: []Role{},
	}

	cache, err := NewPermissionCache(context.Background(), repo)
	if err != nil {
		t.Fatalf("failed to create permission cache: %v", err)
	}

	// Both actor and target are admins (rank 2)
	orgRepo := &mockOrgMembershipRepoByUser{
		memberships: map[uuid.UUID]*domain.OrgMembership{
			actorID: {
				UserID: actorID,
				OrgID:  orgID,
				Role:   "admin",
			},
			targetID: {
				UserID: targetID,
				OrgID:  orgID,
				Role:   "admin",
			},
		},
	}
	teamRepo := &mockTeamMembershipRepo{}

	checker := NewChecker(orgRepo, teamRepo, cache)

	uc := &auth.UserContext{UserID: actorID}
	r := makeRequest(uc)

	// RequireRankAbove should deny because actor rank (2) <= target rank (2)
	err = checker.RequireRankAbove(r, orgID, targetID)
	if err == nil {
		t.Fatalf("self-protection should deny admin modifying another admin, but got nil error")
	}
}

// --- Test Case: Permission edit takes effect ---

func TestFixVerification_PermissionEditTakesEffect(t *testing.T) {
	userID := uuid.New()
	orgID := uuid.New()

	// Admin role does NOT have org.domains.manage — simulates an admin UI edit
	// that removed this permission from the admin role.
	repo := &mockRolePermissionRepo{
		orgRoles: []Role{
			{Value: "owner", Rank: 3, Permissions: []string{"org.view", "org.domains.manage"}},
			{Value: "admin", Rank: 2, Permissions: []string{"org.view"}}, // org.domains.manage removed!
			{Value: "member", Rank: 1, Permissions: []string{"org.view"}},
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
			Role:   "admin",
		},
	}
	teamRepo := &mockTeamMembershipRepo{}

	checker := NewChecker(orgRepo, teamRepo, cache)

	uc := &auth.UserContext{UserID: userID}
	r := makeRequest(uc)

	// RequireOrgPermission should deny because admin no longer has org.domains.manage
	err = checker.RequireOrgPermission(r, orgID, "org.domains.manage")
	if err != ErrInsufficientOrg {
		t.Fatalf("admin without org.domains.manage should get ErrInsufficientOrg, but got: %v", err)
	}
}
