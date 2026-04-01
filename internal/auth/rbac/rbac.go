package rbac

import (
	"context"
	"fmt"
	"net/http"

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
)

var orgRank = map[string]int{OrgOwner: 3, OrgAdmin: 2, OrgMember: 1}
var teamRank = map[string]int{TeamLead: 2, TeamMember: 1}

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

type OrgMembershipRepo interface {
	GetMembership(ctx context.Context, userID, orgID uuid.UUID) (*domain.OrgMembership, error)
}

type TeamMembershipRepo interface {
	GetMembership(ctx context.Context, userID, teamID uuid.UUID) (*domain.TeamMembership, error)
}

type Checker struct {
	org  OrgMembershipRepo
	team TeamMembershipRepo
}

func NewChecker(org OrgMembershipRepo, team TeamMembershipRepo) *Checker {
	return &Checker{org: org, team: team}
}

var (
	ErrUnauthorized   = fmt.Errorf("unauthorized")
	ErrNotOrgMember   = fmt.Errorf("not a member of this organization")
	ErrNotTeamMember  = fmt.Errorf("not a member of this team")
	ErrInsufficientOrg  = fmt.Errorf("insufficient org permissions")
	ErrInsufficientTeam = fmt.Errorf("insufficient team permissions")
)

// RequireOrgRole checks the user has at least minRole in the org. System admins bypass.
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
