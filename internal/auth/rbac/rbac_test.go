package rbac

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

// ── Mock implementations ──

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
	// teamOrgID is the org GetTeamOrgID reports the team belongs to. Tests set
	// it to the orgID they pass so the team->org binding check is satisfied.
	teamOrgID uuid.UUID
	// teamOrgErr, when set, makes GetTeamOrgID fail (team not found).
	teamOrgErr error
}

func (m *mockTeamMembershipRepo) GetMembership(_ context.Context, _, _ uuid.UUID) (*domain.TeamMembership, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.membership, nil
}

func (m *mockTeamMembershipRepo) GetTeamOrgID(_ context.Context, _ uuid.UUID) (uuid.UUID, error) {
	if m.teamOrgErr != nil {
		return uuid.Nil, m.teamOrgErr
	}
	return m.teamOrgID, nil
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

// --- Test Case: Member can read team resources via RequireTeamPermission ---

func TestFixVerification_MemberCanReadTeamResources(t *testing.T) {
	userID := uuid.New()
	orgID := uuid.New()
	teamID := uuid.New()

	repo := &mockRolePermissionRepo{
		orgRoles: []Role{
			{Value: "member", Rank: 1, Permissions: []string{"org.view"}},
		},
		teamRoles: []Role{
			{Value: "lead", Rank: 2, Permissions: []string{"team.webhooks.view", "team.webhooks.manage"}},
			{Value: "member", Rank: 1, Permissions: []string{"team.webhooks.view", "team.view", "team.inboxes.view"}},
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

	// Team membership: member role with view permissions
	teamRepo := &mockTeamMembershipRepo{
		membership: &domain.TeamMembership{
			UserID: userID,
			TeamID: teamID,
			Role:   "member",
		},
		teamOrgID: orgID, // team belongs to this org (binding check)
	}

	checker := NewChecker(orgRepo, teamRepo, cache)

	uc := &auth.UserContext{UserID: userID}
	r := makeRequest(uc)

	// RequireTeamPermission should grant access because "member" has "team.webhooks.view"
	err = checker.RequireTeamPermission(r, orgID, teamID, "team.webhooks.view")
	if err != nil {
		t.Fatalf("member with team.webhooks.view permission should be granted access, but got: %v", err)
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

// --- Security: team->org binding (cross-tenant IDOR prevention) ---
// An org admin must NOT reach another org's team by pairing their own orgID
// (where they hold admin, which triggers the org-level fallback) with a teamID
// that belongs to a different org. RequireTeamPermission must deny this.
func TestSecurity_TeamOrgBinding_BlocksCrossTenantTeamAccess(t *testing.T) {
	userID := uuid.New()
	attackerOrgID := uuid.New() // org the user administers
	victimOrgID := uuid.New()   // org that actually owns the team
	teamID := uuid.New()        // a team living in the victim org

	repo := &mockRolePermissionRepo{
		orgRoles:  []Role{{Value: "admin", Rank: 2, Permissions: []string{"org.view"}}},
		teamRoles: []Role{{Value: "member", Rank: 1, Permissions: []string{"team.webhooks.view"}}},
	}
	cache, err := NewPermissionCache(context.Background(), repo)
	if err != nil {
		t.Fatalf("failed to create permission cache: %v", err)
	}

	// User is an ADMIN of attackerOrgID — rank 2 would trigger the org fallback.
	orgRepo := &mockOrgMembershipRepo{
		membership: &domain.OrgMembership{UserID: userID, OrgID: attackerOrgID, Role: "admin"},
	}
	// The team belongs to victimOrgID, and the user is not a member of it.
	teamRepo := &mockTeamMembershipRepo{
		err:       errors.New("not a team member"),
		teamOrgID: victimOrgID,
	}
	checker := NewChecker(orgRepo, teamRepo, cache)
	r := makeRequest(&auth.UserContext{UserID: userID})

	// Attack: pair the admin's own orgID with the victim org's teamID.
	err = checker.RequireTeamPermission(r, attackerOrgID, teamID, "team.webhooks.view")
	if err != ErrNotTeamMember {
		t.Fatalf("cross-tenant IDOR: org admin reached another org's team; got %v, want ErrNotTeamMember", err)
	}
}
