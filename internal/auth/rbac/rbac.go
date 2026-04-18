package rbac

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/google/uuid"

	"gitlab.com/burnerbyte/burnerbyte/internal/auth"
	"gitlab.com/burnerbyte/burnerbyte/internal/domain"
)

const (
	OrgOwner  = "owner"
	OrgAdmin  = "admin"
	OrgMember = "member"

	TeamLead   = "lead"
	TeamMember = "member"
	TeamViewer = "viewer"
)

var orgRank = map[string]int{OrgOwner: 3, OrgAdmin: 2, OrgMember: 1}
var teamRank = map[string]int{TeamLead: 2, TeamMember: 1, TeamViewer: 0}

// OrgRoles returns the available org roles with descriptions, ordered by rank.
func OrgRoles() []RoleInfo {
	return []RoleInfo{
		{Value: OrgOwner, Label: "Owner", Description: "Full control over the organization", Rank: 3},
		{Value: OrgAdmin, Label: "Admin", Description: "Manage settings, members, and resources", Rank: 2},
		{Value: OrgMember, Label: "Member", Description: "Standard access to assigned resources", Rank: 1},
	}
}

// TeamRoles returns the available team roles with descriptions, ordered by rank.
func TeamRoles() []RoleInfo {
	return []RoleInfo{
		{Value: TeamLead, Label: "Lead", Description: "Manage team settings, webhooks, API keys, and members", Rank: 2},
		{Value: TeamMember, Label: "Member", Description: "Create inboxes, view emails, use team domains", Rank: 1},
		{Value: TeamViewer, Label: "Viewer", Description: "Read-only access to team resources", Rank: 0},
	}
}

// RoleInfo describes a role for API responses and UI rendering.
type RoleInfo struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Rank        int    `json:"rank"`
}

// ValidOrgRole checks if a role string is a valid org role.
func ValidOrgRole(role string) bool {
	_, ok := orgRank[role]
	return ok
}

// ValidTeamRole checks if a role string is a valid team role.
func ValidTeamRole(role string) bool {
	_, ok := teamRank[role]
	return ok
}

// ── Repository interfaces ──

type OrgMembershipRepo interface {
	GetMembership(ctx context.Context, userID, orgID uuid.UUID) (*domain.OrgMembership, error)
}

type TeamMembershipRepo interface {
	GetMembership(ctx context.Context, userID, teamID uuid.UUID) (*domain.TeamMembership, error)
}

// Role is a local representation of a role for the permission cache.
type Role struct {
	Value       string
	Rank        int
	Permissions []string
}

// RolePermissionRepo is the interface the permission cache needs to load roles.
type RolePermissionRepo interface {
	ListRoles(ctx context.Context, scope string) ([]Role, error)
}

// ── Permission Cache ──

// PermissionCache holds an in-memory map of roleValue → permission keys and ranks,
// loaded from the database. Thread-safe via sync.RWMutex.
type PermissionCache struct {
	mu          sync.RWMutex
	permissions map[string]map[string]bool // roleValue → set of permission keys
	ranks       map[string]int             // roleValue → rank
	repo        RolePermissionRepo
}

// NewPermissionCache creates a new cache and loads all org and team roles from the DB.
func NewPermissionCache(ctx context.Context, repo RolePermissionRepo) (*PermissionCache, error) {
	pc := &PermissionCache{
		permissions: make(map[string]map[string]bool),
		ranks:       make(map[string]int),
		repo:        repo,
	}
	if err := pc.load(ctx); err != nil {
		return nil, fmt.Errorf("failed to load permission cache: %w", err)
	}
	return pc, nil
}

func (pc *PermissionCache) load(ctx context.Context) error {
	perms := make(map[string]map[string]bool)
	ranks := make(map[string]int)

	for _, scope := range []string{"org", "team"} {
		roles, err := pc.repo.ListRoles(ctx, scope)
		if err != nil {
			return fmt.Errorf("failed to list %s roles: %w", scope, err)
		}
		for _, role := range roles {
			permSet := make(map[string]bool, len(role.Permissions))
			for _, p := range role.Permissions {
				permSet[p] = true
			}
			perms[role.Value] = permSet
			ranks[role.Value] = role.Rank
		}
	}

	pc.mu.Lock()
	pc.permissions = perms
	pc.ranks = ranks
	pc.mu.Unlock()
	return nil
}

// Refresh reloads the cache from the database.
func (pc *PermissionCache) Refresh(ctx context.Context) error {
	return pc.load(ctx)
}

// HasPermission checks if the given role has the specified permission key.
func (pc *PermissionCache) HasPermission(roleValue, permissionKey string) bool {
	pc.mu.RLock()
	defer pc.mu.RUnlock()
	if permSet, ok := pc.permissions[roleValue]; ok {
		return permSet[permissionKey]
	}
	return false
}

// GetRank returns the rank for the given role value, or 0 if not found.
func (pc *PermissionCache) GetRank(roleValue string) int {
	pc.mu.RLock()
	defer pc.mu.RUnlock()
	return pc.ranks[roleValue]
}

// TeamPermissionKeys returns all permission keys for team-scoped roles.
func (pc *PermissionCache) TeamPermissionKeys() []string {
	pc.mu.RLock()
	defer pc.mu.RUnlock()
	seen := make(map[string]bool)
	for _, permSet := range pc.permissions {
		for key := range permSet {
			if len(key) > 5 && key[:5] == "team." {
				seen[key] = true
			}
		}
	}
	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	return keys
}

// ── Checker ──

var (
	ErrUnauthorized     = fmt.Errorf("unauthorized")
	ErrNotOrgMember     = fmt.Errorf("not a member of this organization")
	ErrNotTeamMember    = fmt.Errorf("not a member of this team")
	ErrInsufficientOrg  = fmt.Errorf("insufficient org permissions")
	ErrInsufficientTeam = fmt.Errorf("insufficient team permissions")
)

type Checker struct {
	org   OrgMembershipRepo
	team  TeamMembershipRepo
	cache *PermissionCache
}

func NewChecker(org OrgMembershipRepo, team TeamMembershipRepo, cache *PermissionCache) *Checker {
	return &Checker{org: org, team: team, cache: cache}
}

// GetOrgRole returns the user's role in the given org, or an error if not a member.
func (c *Checker) GetOrgRole(ctx context.Context, userID, orgID uuid.UUID) (string, error) {
	m, err := c.org.GetMembership(ctx, userID, orgID)
	if err != nil {
		return "", err
	}
	return m.Role, nil
}

// RequireOrgRole checks the user has at least minRole in the org. System admins bypass.
// Kept for backward compatibility — handlers should migrate to RequireOrgPermission.
func (c *Checker) RequireOrgRole(r *http.Request, orgID uuid.UUID, minRole string) error {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		return ErrUnauthorized
	}
	if uc.IsSystemAdmin {
		return nil
	}
	m, err := c.org.GetMembership(r.Context(), uc.UserID, orgID)
	if err != nil {
		return ErrNotOrgMember
	}
	if orgRank[m.Role] < orgRank[minRole] {
		return ErrInsufficientOrg
	}
	return nil
}

// RequireTeamRole checks team role OR org-level fallback. Org owners/admins can manage any team.
// Kept for backward compatibility — handlers should migrate to RequireTeamPermission.
func (c *Checker) RequireTeamRole(r *http.Request, orgID, teamID uuid.UUID, minOrgFallback, minTeamRole string) error {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		return ErrUnauthorized
	}
	if uc.IsSystemAdmin {
		return nil
	}
	// Org-level fallback
	m, err := c.org.GetMembership(r.Context(), uc.UserID, orgID)
	if err == nil && orgRank[m.Role] >= orgRank[minOrgFallback] {
		return nil
	}
	// Team-level check
	tm, err := c.team.GetMembership(r.Context(), uc.UserID, teamID)
	if err != nil {
		return ErrNotTeamMember
	}
	if teamRank[tm.Role] < teamRank[minTeamRole] {
		return ErrInsufficientTeam
	}
	return nil
}

// ── Permission-based methods ──

// RequireOrgPermission checks if the user's org role has the specified permission key.
// System admins bypass. Returns ErrNotOrgMember if not a member, ErrInsufficientOrg if lacking permission.
func (c *Checker) RequireOrgPermission(r *http.Request, orgID uuid.UUID, permissionKey string) error {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		return ErrUnauthorized
	}
	if uc.IsSystemAdmin {
		return nil
	}
	m, err := c.org.GetMembership(r.Context(), uc.UserID, orgID)
	if err != nil {
		return ErrNotOrgMember
	}
	if c.cache != nil && c.cache.HasPermission(m.Role, permissionKey) {
		return nil
	}
	return ErrInsufficientOrg
}

// RequireTeamPermission checks if the user's team role (or org-level fallback) has the specified permission key.
// System admins bypass. Org admins/owners get implicit team access via org-level fallback.
func (c *Checker) RequireTeamPermission(r *http.Request, orgID, teamID uuid.UUID, permissionKey string) error {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		return ErrUnauthorized
	}
	if uc.IsSystemAdmin {
		return nil
	}

	// Org-level fallback: if the user's org role rank >= admin rank (2), grant access.
	// Also check if the org role explicitly has the team permission key.
	m, err := c.org.GetMembership(r.Context(), uc.UserID, orgID)
	if err == nil && c.cache != nil {
		orgRoleRank := c.cache.GetRank(m.Role)
		if orgRoleRank >= 2 {
			// Org admin or higher — implicit access to all team operations
			return nil
		}
		// Check if the org role has the team permission key explicitly
		if c.cache.HasPermission(m.Role, permissionKey) {
			return nil
		}
	}

	// Team-level check
	tm, err := c.team.GetMembership(r.Context(), uc.UserID, teamID)
	if err != nil {
		return ErrNotTeamMember
	}
	if c.cache != nil && c.cache.HasPermission(tm.Role, permissionKey) {
		return nil
	}
	return ErrInsufficientTeam
}

// RequireRankAbove checks that the acting user's org role rank is strictly higher than the target user's.
// Used for self-protection on role change operations.
func (c *Checker) RequireRankAbove(r *http.Request, orgID, targetUserID uuid.UUID) error {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		return ErrUnauthorized
	}
	if uc.IsSystemAdmin {
		return nil
	}
	actorMembership, err := c.org.GetMembership(r.Context(), uc.UserID, orgID)
	if err != nil {
		return ErrNotOrgMember
	}
	targetMembership, err := c.org.GetMembership(r.Context(), targetUserID, orgID)
	if err != nil {
		return ErrNotOrgMember
	}
	actorRank := c.cache.GetRank(actorMembership.Role)
	targetRank := c.cache.GetRank(targetMembership.Role)
	if actorRank <= targetRank {
		return fmt.Errorf("cannot modify users at the same or higher rank")
	}
	return nil
}

// RequireTeamRankAbove checks that the acting user's team role rank is strictly higher than the target user's.
// Used for self-protection on team role change operations.
func (c *Checker) RequireTeamRankAbove(r *http.Request, teamID, targetUserID uuid.UUID) error {
	uc := auth.GetUser(r.Context())
	if uc == nil {
		return ErrUnauthorized
	}
	if uc.IsSystemAdmin {
		return nil
	}
	actorMembership, err := c.team.GetMembership(r.Context(), uc.UserID, teamID)
	if err != nil {
		return ErrNotTeamMember
	}
	targetMembership, err := c.team.GetMembership(r.Context(), targetUserID, teamID)
	if err != nil {
		return ErrNotTeamMember
	}
	actorRank := c.cache.GetRank(actorMembership.Role)
	targetRank := c.cache.GetRank(targetMembership.Role)
	if actorRank <= targetRank {
		return fmt.Errorf("cannot modify users at the same or higher rank")
	}
	return nil
}

// RefreshCache is a convenience method to refresh the permission cache.
func (c *Checker) RefreshCache(ctx context.Context) error {
	if c.cache == nil {
		return nil
	}
	return c.cache.Refresh(ctx)
}

// Cache returns the permission cache for external use (e.g., API key scope validation).
func (c *Checker) Cache() *PermissionCache {
	return c.cache
}
